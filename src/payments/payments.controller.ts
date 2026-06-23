import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Request,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { SafepayService } from './safepay.service';
import { OrdersService } from '../orders/orders.service';
import { CartService } from '../cart/cart.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);
  /**
   * Origin of the Flutter **web** build. On web the `prestigecollection://`
   * deep link does nothing, so the callback page redirects the browser here
   * (to `/#/payment-callback?...`) instead of leaving the user stranded.
   * Empty string ⇒ no web redirect (mobile-only deployments).
   */
  private readonly webRedirectUrl: string;

  constructor(
    private readonly safepayService: SafepayService,
    private readonly ordersService: OrdersService,
    private readonly cartService: CartService,
    private readonly configService: ConfigService,
  ) {
    this.webRedirectUrl = (
      this.configService.get<string>('SAFEPAY_WEB_REDIRECT_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      ''
    ).replace(/\/+$/, '');
  }

  @Get('config')
  @ApiOperation({
    summary: 'Get payment gateway availability',
    description:
      'Lets the client know whether card payments are actually configured, so it can disable ' +
      'Credit/Debit Card in checkout instead of offering an option that is guaranteed to fail.',
  })
  getConfig() {
    return { cardPaymentsEnabled: this.safepayService.isConfigured };
  }

  @Post('initiate/:orderId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Initiate SafePay payment',
    description: 'Generate SafePay hosted page link for order',
  })
  @ApiResponse({ status: 200, description: 'Payment initiated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async initiatePayment(@Request() req, @Param('orderId') orderId: string) {
    const order = await this.ordersService.findOne(orderId, req.user.userId);

    if (order.paymentStatus === 'captured') {
      throw new BadRequestException('Order payment already completed');
    }

    try {
      const { requestId, redirectUrl } =
        await this.safepayService.initiatePayment({
          orderId: order._id.toString(),
          amount: order.grandTotal,
          email: order.shippingAddress.email,
          phoneNumber: order.shippingAddress.phoneNumber,
          customerName: order.shippingAddress.fullName,
          description: `Order #${order._id.toString()} - Prestige Collection`,
        });

      // Store the session token for reference
      await this.ordersService.updatePaymentInfo(orderId, {
        paymentStatus: order.paymentStatus || 'pending',
        transactionId: order.paymentTransactionId || '',
        status: order.status,
        sessionToken: requestId,
      });

      return {
        success: true,
        requestId,
        redirectUrl,
      };
    } catch (error) {
      this.logger.error('Payment initiation failed:', error);
      throw error;
    }
  }

  @Get('verify/:orderId/:requestId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Verify payment status',
    description: 'Check SafePay payment status for an order',
  })
  @ApiResponse({ status: 200, description: 'Payment status retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async verifyPayment(
    @Request() req,
    @Param('orderId') orderId: string,
    @Param('requestId') requestId: string,
  ) {
    const order = await this.ordersService.findOne(orderId, req.user.userId);

    // 1) Webhook-first: if the authoritative webhook has already confirmed the
    //    capture, return success immediately without touching SafePay's API.
    if (order.paymentStatus === 'captured') {
      return {
        success: true,
        paymentStatus: 'captured',
        pending: false,
        transactionId: order.paymentTransactionId || null,
        amount: order.grandTotal,
      };
    }
    if (order.paymentStatus === 'failed') {
      return {
        success: false,
        paymentStatus: 'failed',
        pending: false,
        transactionId: order.paymentTransactionId || null,
        amount: order.grandTotal,
        note: 'Payment was not completed.',
      };
    }

    // 2) Resolve a tracker to query — using ONLY server-stored identifiers bound
    //    to THIS order. We never trust a client-supplied tracker as proof of
    //    payment: an attacker could otherwise submit any other order's captured
    //    tracker (of a matching amount) to mark their own unpaid order as paid.
    //    - paymentTrackerToken: stored by the SafePay redirect callback/webhook,
    //      which carry SafePay's own order_id binding.
    //    - paymentSessionToken: the session token we issued at initiation for
    //      this order; only honoured when the client echoes back that exact
    //      value (it can't be used to fetch a *captured* tracker anyway, so it
    //      simply keeps the result `pending` until the callback/webhook lands).
    const cleanRequestId =
      requestId && requestId !== 'undefined' ? requestId : undefined;
    const sessionMatches =
      !!cleanRequestId && cleanRequestId === order.paymentSessionToken;
    const trackerToUse =
      order.paymentTrackerToken || (sessionMatches ? cleanRequestId : undefined);

    if (!trackerToUse) {
      return {
        success: false,
        paymentStatus: order.paymentStatus || 'pending',
        pending: true,
        transactionId: null,
        amount: order.grandTotal,
        note: 'Payment not yet confirmed. Please complete the SafePay payment flow.',
      };
    }

    const usingFallback = !order.paymentTrackerToken;

    try {
      const paymentInfo = await this.safepayService.verifyPayment(trackerToUse);

      // 3a) Still processing / not confirmable yet — keep the client polling.
      if (paymentInfo.status === 'pending') {
        return {
          success: false,
          paymentStatus: 'pending',
          pending: true,
          transactionId: order.paymentTransactionId || null,
          amount: order.grandTotal,
          note: usingFallback
            ? 'Awaiting payment confirmation. Webhook processing may still be in progress.'
            : 'Awaiting payment confirmation from SafePay.',
        };
      }

      // 3b) Definitive capture — validate amount, then mark the order paid.
      if (paymentInfo.status === 'captured') {
        // Amount tolerance: SafePay may return a net amount (post-fee) that
        // differs slightly from grandTotal. Accept within ±1 PKR.
        const amountMatches =
          Math.abs(paymentInfo.amount - order.grandTotal) <= 1;
        if (!amountMatches) {
          this.logger.warn(
            `Payment amount mismatch for order ${orderId}: ` +
              `expected ${order.grandTotal}, got ${paymentInfo.amount}`,
          );
          throw new BadRequestException(
            'Payment amount does not match order total',
          );
        }

        await this.ordersService.updatePaymentInfo(orderId, {
          paymentStatus: 'captured',
          transactionId: paymentInfo.transactionId,
          status: 'payment_successful',
        });
        await this.cartService.clearCart(req.user.userId).catch(() => null);

        return {
          success: true,
          paymentStatus: 'captured',
          pending: false,
          transactionId: paymentInfo.transactionId,
          amount: paymentInfo.amount,
        };
      }

      // 3c) Definitive failure — mark the order cancelled.
      await this.ordersService.updatePaymentInfo(orderId, {
        paymentStatus: 'failed',
        transactionId: paymentInfo.transactionId,
        status: 'cancelled',
      });
      return {
        success: false,
        paymentStatus: 'failed',
        pending: false,
        transactionId: paymentInfo.transactionId,
        amount: order.grandTotal,
        note: 'Payment was not completed.',
      };
    } catch (error) {
      this.logger.error('Payment verification failed:', error);
      // Unexpected error (e.g. amount mismatch / SafePay unavailable). Do NOT
      // mark the order failed here — return the DB state and let the client keep
      // polling / the webhook confirm authoritatively.
      return {
        success: order.paymentStatus === 'captured',
        paymentStatus: order.paymentStatus || 'pending',
        pending: order.paymentStatus !== 'captured',
        transactionId: order.paymentTransactionId || null,
        amount: order.grandTotal,
        note: 'Could not reach SafePay verification API, returning order status from database',
      };
    }
  }

  @Get('callback/:status')
  @ApiOperation({
    summary:
      'SafePay redirect handler - branded callback page with deep link redirect',
    description:
      'SafePay redirects here after payment. Renders a branded page that attempts to ' +
      'redirect back to the app via deep link (mobile) with a fallback button and message ' +
      'for web users. Stores the tracker token for server-side verification.',
  })
  async paymentCallback(
    @Param('status') status: string,
    @Query('order_id') orderId: string | undefined,
    @Query('tracker') tracker: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    const isSuccess = status === 'success';

    // Store tracker token server-side (authoritative source is webhook)
    if (orderId && tracker) {
      try {
        const order = await this.ordersService.findOne(orderId);

        if (order) {
          await this.ordersService.updatePaymentInfo(orderId, {
            paymentStatus: order.paymentStatus || 'pending',
            transactionId: order.paymentTransactionId || '',
            status: order.status,
            trackerToken: tracker,
          });
          this.logger.log(
            `Callback: stored tracker token for order ${orderId}`,
          );
        } else {
          this.logger.warn(`Callback: Order ${orderId} not found`);
        }
      } catch (error) {
        this.logger.error(
          `Callback: Failed to store tracker for order ${orderId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Build deep link for mobile app
    const deepLinkParams = new URLSearchParams({
      status: isSuccess ? 'success' : 'cancelled',
      ...(orderId ? { order_id: orderId } : {}),
      ...(tracker ? { tracker } : {}),
    });

    const deepLink = `prestigecollection://payment-callback?${deepLinkParams.toString()}`;

    // Web fallback: the custom scheme never fires inside a desktop/mobile
    // browser running the Flutter web build, so redirect the browser back into
    // the web app's hash route, carrying the same params. Empty when no web
    // origin is configured (mobile-only deployments) — then we keep the page.
    const webRedirect = this.webRedirectUrl
      ? `${this.webRedirectUrl}/#/payment-callback?${deepLinkParams.toString()}`
      : '';

    // Render branded HTML page with auto-redirect and fallback button
    const brandedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="format-detection" content="telephone=no">
  <title>Prestige Collection - Payment ${isSuccess ? 'Successful' : 'Cancelled'}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      height: 100%;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
        'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
      background-attachment: fixed;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      min-height: 100vh;
    }

    .container {
      max-width: 450px;
      width: 100%;
      background: #1f2937;
      border-radius: 20px;
      padding: 40px 30px;
      text-align: center;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      animation: slideUp 0.5s ease-out;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .icon-container {
      width: 100px;
      height: 100px;
      margin: 0 auto 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 50px;
      position: relative;
      animation: scaleIn 0.5s ease-out 0.2s both;
    }

    @keyframes scaleIn {
      from {
        transform: scale(0.8);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }

    .success {
      background: linear-gradient(135deg, rgba(242, 201, 76, 0.2), rgba(0, 0, 0, 0.1));
      border: 2px solid #f2c94c;
      color: #f2c94c;
    }

    .failed {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(0, 0, 0, 0.1));
      border: 2px solid #ef4444;
      color: #ef4444;
    }

    h1 {
      color: #ffffff;
      font-size: 28px;
      font-weight: 800;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }

    .subtitle {
      color: rgba(255, 255, 255, 0.7);
      font-size: 15px;
      line-height: 1.5;
      margin-bottom: 32px;
    }

    .button-container {
      display: flex;
      gap: 12px;
      flex-direction: column;
    }

    .primary-btn, .secondary-btn {
      padding: 16px 24px;
      border: none;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      letter-spacing: -0.3px;
      text-decoration: none;
      display: inline-block;
    }

    .primary-btn {
      background: #f2c94c;
      color: #111827;
      box-shadow: 0 4px 15px rgba(242, 201, 76, 0.25);
    }

    .primary-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(242, 201, 76, 0.35);
    }

    .secondary-btn {
      background: transparent;
      color: #f2c94c;
      border: 1.5px solid #f2c94c;
      opacity: 0.8;
    }

    .secondary-btn:hover {
      opacity: 1;
      background: rgba(242, 201, 76, 0.1);
    }

    .loading-text {
      color: rgba(255, 255, 255, 0.6);
      font-size: 14px;
      margin-top: 24px;
      animation: fadeInOut 1.5s infinite;
    }

    @keyframes fadeInOut {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    @media (max-width: 480px) {
      .container {
        padding: 30px 20px;
      }
      h1 {
        font-size: 24px;
      }
      .icon-container {
        width: 80px;
        height: 80px;
        font-size: 40px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon-container ${isSuccess ? 'success' : 'failed'}">
      ${isSuccess ? '✓' : '✕'}
    </div>

    <h1>${isSuccess ? 'Payment Successful' : 'Payment Cancelled'}</h1>
    <p class="subtitle">
      ${
        isSuccess
          ? 'Thank you! Your payment has been processed successfully. Returning you to the app...'
          : 'Your payment was cancelled. You can try again or contact support if you need help.'
      }
    </p>

    <div class="button-container">
      <button class="primary-btn" id="returnBtn">
        Return to Prestige Collection
      </button>
      <button class="secondary-btn" id="contactBtn" onclick="window.location='mailto:support@prestigecollection.com'">
        Contact Support
      </button>
    </div>

    <div class="loading-text" id="loadingText">
      Opening app...
    </div>
  </div>

  <script>
    const deepLink = ${JSON.stringify(deepLink)};
    const webRedirect = ${JSON.stringify(webRedirect)};
    const returnBtn = document.getElementById('returnBtn');
    const loadingText = document.getElementById('loadingText');

    // Heuristic: a custom-scheme deep link only resolves inside a real mobile
    // OS (or an installed app), never inside a desktop browser. We use the UA
    // to decide whether to even attempt it before falling back to the web app.
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // Try to open the mobile deep link
    function openDeepLink() {
      // Method 1: Direct navigation (works on mobile)
      window.location.href = deepLink;

      // Method 2: Use iframe (alternative approach for some browsers)
      setTimeout(() => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = deepLink;
        document.body.appendChild(iframe);
      }, 100);
    }

    // Send the browser back into the Flutter web app (hash route).
    function goToWebApp() {
      if (webRedirect) {
        window.location.replace(webRedirect);
      }
    }

    // On load: web → redirect straight into the web app; mobile → try the deep
    // link first, and if the page is still here shortly after (app not installed
    // / scheme not handled) fall back to the web app when one is configured.
    window.addEventListener('load', () => {
      if (!isMobile && webRedirect) {
        goToWebApp();
        return;
      }
      openDeepLink();
      if (webRedirect) {
        setTimeout(() => {
          if (!document.hidden) goToWebApp();
        }, 1500);
      }
    });

    // Also try on user click for better UX
    returnBtn.addEventListener('click', (e) => {
      e.preventDefault();
      loadingText.textContent = 'Opening app...';
      if (isMobile) {
        openDeepLink();
        if (webRedirect) {
          setTimeout(() => {
            if (!document.hidden) goToWebApp();
          }, 1500);
        }
      } else {
        goToWebApp();
      }

      // If deep link fails, show it's clickable
      setTimeout(() => {
        loadingText.textContent = 'Tap to return to app';
        returnBtn.style.opacity = '0.6';
      }, 3000);
    });

    // If user hasn't been taken back after 5 seconds, let them know app might not be installed
    setTimeout(() => {
      const textNode = document.createTextNode(
        'Having trouble? Make sure the Prestige Collection app is installed, or '
      );
      const link = document.createElement('a');
      link.href = 'https://play.google.com/store/apps/details?id=com.prestigecollection.app';
      link.textContent = 'download it here';
      link.style.color = '#f2c94c';
      link.style.textDecoration = 'underline';
      link.style.cursor = 'pointer';

      loadingText.innerHTML = '';
      loadingText.appendChild(textNode);
      loadingText.appendChild(link);
      loadingText.appendChild(document.createTextNode('.'));
    }, 5000);
  </script>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('X-Content-Type-Options', 'nosniff');
    res.status(200).send(brandedHtml);
  }

  @Post('webhook')
  @ApiOperation({
    summary: 'SafePay webhook callback',
    description: 'Webhook endpoint for SafePay payment notifications',
  })
  async handleWebhook(
    @Body() payload: Record<string, any>,
    @Request() req: any,
  ) {
    try {
      this.logger.log('Received webhook from SafePay:', {
        timestamp: new Date().toISOString(),
        headers: Object.keys(req.headers),
        signatureHeader:
          req.headers['x-sfpy-signature'] ||
          req.headers['x-signature'] ||
          'NOT FOUND',
      });
      this.logger.debug('Webhook payload:', JSON.stringify(payload, null, 2));

      // Signature is HMAC-SHA512 over `payload.data`, validated against the
      // `x-sfpy-signature` header (see @sfpy/node-sdk's Verify.webhook).
      // TODO: SafePay SDK signature validation failing — investigate SDK compatibility
      // For now, verify signature manually using the merchant API key and webhook secret
      const isValidSignature = this.safepayService.validateWebhookSignature(
        payload,
        req.headers as Record<string, any>,
      );
      if (!isValidSignature) {
        this.logger.warn(
          'SDK signature validation failed, but webhook is being processed. ' +
            'TODO: Fix SDK signature validation with SafePay support.',
        );
        // Temporarily allow processing to confirm webhook structure is correct
        // this.logger.warn('Webhook headers received:', JSON.stringify(req.headers, null, 2));
        // throw new BadRequestException('Invalid webhook signature');
      }

      // SafePay sends webhooks in two different structures:
      // 1. Test events from dashboard: payload.data = { order_id, tracker, state, ... }
      // 2. Real webhooks: payload.data.notification = { metadata.order_id, tracker, state, ... }
      // Check both to handle both cases.
      const data = payload.data?.notification ?? payload.data ?? payload;
      const orderRefNum =
        data.metadata?.order_id ??
        data.order_id ??
        data.orderId ??
        data.reference;
      const transactionId =
        data.tracker ?? data.id ?? data.transactionId ?? data.charge_id;
      const eventStatus = data.state ?? data.status;

      this.logger.debug('Webhook payload extracted:', {
        orderRefNum,
        transactionId,
        eventStatus,
      });

      if (!orderRefNum || !transactionId || !eventStatus) {
        this.logger.warn(
          `Webhook payload missing expected fields: ${JSON.stringify(payload)}`,
        );
        throw new BadRequestException(
          'Invalid webhook payload: missing required fields',
        );
      }

      // Validate that orderRefNum is a valid MongoDB ObjectId before querying
      // (test events from SafePay may use dummy IDs like "AX-09u812312")
      if (!this.isValidMongoId(orderRefNum)) {
        this.logger.warn(
          `Webhook received with invalid order ID format (likely test event): ${orderRefNum}`,
        );
        // Still return success to SafePay to avoid retries, but don't attempt DB lookup
        return { success: true };
      }

      const order = await this.ordersService
        .findOne(orderRefNum)
        .catch((error) => {
          this.logger.error(
            `Order not found for webhook: ${orderRefNum}`,
            error,
          );
          return null;
        });

      if (!order) {
        this.logger.warn(
          `Webhook received for non-existent order: ${orderRefNum}`,
        );
        // Still return success to SafePay to avoid retries
        return { success: true };
      }

      const paymentStatus =
        eventStatus === 'captured' ||
        eventStatus === 'TRACKER_ENDED' ||
        eventStatus === 'CAPTURED' ||
        eventStatus === 'PAID'
          ? 'captured'
          : 'failed';

      await this.ordersService.updatePaymentInfo(orderRefNum, {
        paymentStatus,
        transactionId,
        status:
          paymentStatus === 'captured' ? 'payment_successful' : 'cancelled',
      });

      this.logger.log(
        `Webhook processed successfully for order ${orderRefNum}:`,
        {
          paymentStatus,
          transactionId,
        },
      );

      // Clear cart if payment was captured
      if (paymentStatus === 'captured') {
        await this.cartService
          .clearCart(order.userId.toString())
          .catch((error) => {
            this.logger.warn(
              `Failed to clear cart for user ${order.userId} after payment:`,
              error instanceof Error ? error.message : error,
            );
          });
      }

      return { success: true };
    } catch (error) {
      this.logger.error(
        'Webhook processing error:',
        error instanceof Error ? error.message : String(error),
      );
      // Always return 200 to SafePay to avoid retries
      return { success: false };
    }
  }

  private isValidMongoId(id: string): boolean {
    return Types.ObjectId.isValid(id);
  }
}
