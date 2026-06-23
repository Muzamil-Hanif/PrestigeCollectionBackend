import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Safepay } from '@sfpy/node-sdk';

/**
 * SafePay "Fetch Tracker" response shape.
 * Endpoint: GET /reporter/api/v1/payments/{tracker_token} — no auth header needed.
 * The response wraps tracker data in { data: { tracker: {...} } }.
 * Confirmed from SafePay sandbox docs (https://safepay-docs.netlify.app/concepts/fetch-tracker).
 *
 * Key fields:
 *   tracker.state       — "TRACKER_ENDED" means the session is complete
 *   tracker.attempts[]  — charge attempts; the last successful one has status "captured"
 *   tracker.net         — net amount received (in paisa, i.e. PKR * 100)
 */
interface TrackerEnvelope {
  ok?: boolean;
  data?: { tracker?: TrackerPayload } | TrackerPayload;
  tracker?: TrackerPayload;
}

interface TrackerAttempt {
  id?: string;
  amount?: number;
  net?: number;
  status?: string;
}

interface TrackerPayload {
  token?: string;
  state?: string;
  net?: number;
  attempts?: TrackerAttempt[];
  // Legacy field names kept for backwards-compat with older SDK responses
  charges?: TrackerAttempt[];
  payment_method?: { charges?: TrackerAttempt[] };
}

@Injectable()
export class SafepayService {
  private readonly logger = new Logger(SafepayService.name);
  private readonly environment: 'sandbox' | 'production';
  private readonly apiKey: string;
  private readonly v1Secret: string;
  private readonly redirectBaseUrl: string;
  private readonly trackerBaseUrl: string;
  private readonly client: Safepay;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.environment =
      this.configService.get<string>('SAFEPAY_ENVIRONMENT') === 'production'
        ? 'production'
        : 'sandbox';
    this.apiKey = this.configService.get<string>('SAFEPAY_API_KEY') || '';
    this.v1Secret = this.configService.get<string>('SAFEPAY_V1_SECRET') || '';
    const webhookSecret =
      this.configService.get<string>('SAFEPAY_WEBHOOK_SECRET') || '';
    this.redirectBaseUrl = (
      this.configService.get<string>('SAFEPAY_REDIRECT_BASE_URL') || ''
    ).replace(/\/+$/, '');
    this.trackerBaseUrl =
      this.environment === 'production'
        ? 'https://api.getsafepay.com'
        : 'https://sandbox.api.getsafepay.com';

    if (!this.isConfigured) {
      this.logger.warn(
        'SafePay is not fully configured (SAFEPAY_API_KEY / SAFEPAY_V1_SECRET / SAFEPAY_REDIRECT_BASE_URL) ' +
          '— card payments will report as unavailable instead of attempting a doomed API call.',
      );
    }

    // The SDK's `environment` type is a `declare enum` it doesn't export
    // from the package root, so a plain 'sandbox' | 'production' string
    // literal can't be assigned without this cast — the enum's underlying
    // values are identical strings, so this is safe at runtime.
    this.client = new Safepay({
      environment: this.environment,
      apiKey: this.apiKey,
      v1Secret: this.v1Secret,
      webhookSecret,
    } as ConstructorParameters<typeof Safepay>[0]);
  }

  /**
   * Whether enough credentials exist to attempt a real SafePay call.
   * `PaymentsController` uses this to disable Card/Debit at the source
   * instead of letting the user pick a payment method that's guaranteed
   * to fail at submit time.
   */
  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.v1Secret && this.redirectBaseUrl);
  }

  /**
   * Create a SafePay payment session and build the hosted checkout link.
   * Maps to: POST /order/v1/init (session) -> GET {checkout}/pay (redirect).
   * See node_modules/@sfpy/node-sdk for the exact request shape this issues.
   */
  async initiatePayment(paymentData: {
    orderId: string;
    amount: number;
    email: string;
    phoneNumber: string;
    customerName: string;
    description: string;
  }): Promise<{ requestId: string; redirectUrl: string }> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'Card payments are temporarily unavailable. Please choose another payment method.',
      );
    }

    try {
      const { token } = await this.client.payments.create({
        amount: Math.round(paymentData.amount * 100), // SafePay expects the smallest currency unit (paisa)
        currency: 'PKR',
      });

      // SafePay's SDK appends its own `?order_id=...&tracker=...` to whatever
      // URL we hand it here, blindly using `?` rather than `&` — giving it a
      // redirect/cancel URL that already has a query string (e.g.
      // `...?status=success`) produces a broken `?status=success?order_id=...`
      // double-`?` URL. Encode success/failure in the path instead so the
      // URL we provide is always query-string-free.
      const redirectUrl = this.client.checkout.create({
        token,
        orderId: paymentData.orderId,
        redirectUrl: `${this.redirectBaseUrl}/api/payments/callback/success`,
        cancelUrl: `${this.redirectBaseUrl}/api/payments/callback/cancelled`,
        source: 'custom',
        webhooks: true,
      });

      return { requestId: token, redirectUrl };
    } catch (error) {
      this.logger.error(
        'SafePay initiation error:',
        error instanceof Error ? error.stack : error,
      );
      throw new BadRequestException(
        'Failed to initiate payment. Please try again.',
      );
    }
  }

  /**
   * Confirm payment status by querying SafePay's Fetch Tracker endpoint.
   * Note: The `/reporter/api/v1/payments/{tracker}` endpoint is undocumented
   * and may not work reliably. The authoritative source is the webhook
   * callback which is handled in PaymentsController.handleWebhook().
   *
   * This method returns a TRI-STATE result so the caller can tell apart a
   * payment that genuinely failed from one that simply isn't confirmable yet:
   *   - 'captured' — tracker ended with a captured charge attempt
   *   - 'failed'   — tracker reached a terminal non-captured state
   *   - 'pending'  — not confirmable yet (timeout / unreachable / still in flight)
   *
   * It never throws for an unreachable/slow API; it returns 'pending' instead so
   * the client keeps polling rather than showing a false "Payment Failed". The
   * webhook flow remains the authoritative confirmation.
   */
  async verifyPayment(
    requestId: string,
  ): Promise<{ transactionId: string; status: string; amount: number }> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'Card payments are temporarily unavailable.',
      );
    }

    try {
      this.logger.debug(
        `Attempting to verify payment with tracker: ${requestId}`,
      );

      // Wrap with timeout to prevent indefinite hangs if SafePay API is unreachable
      const verifyWithTimeout = async () => {
        // Attempt 1: Try without authentication header (as per SafePay docs comment)
        // The /reporter/api/v1/payments endpoint may not require auth
        const response = await firstValueFrom(
          this.httpService.get<TrackerEnvelope>(
            `${this.trackerBaseUrl}/reporter/api/v1/payments/${requestId}`,
            { timeout: 4000 }, // 4s timeout per request
          ),
        ).catch(async () => {
          // If that fails, try with auth header as fallback
          this.logger.debug(
            'First attempt (no auth) failed, trying with auth header',
          );
          return firstValueFrom(
            this.httpService.get<TrackerEnvelope>(
              `${this.trackerBaseUrl}/reporter/api/v1/payments/${requestId}`,
              {
                headers: { 'X-SFPY-MERCHANT-SECRET': this.v1Secret },
                timeout: 4000, // 4s timeout per request
              },
            ),
          );
        });

        return response;
      };

      // Overall 8-second timeout wrapper (covers both attempts + overhead)
      const response = await Promise.race([
        verifyWithTimeout(),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new Error('Payment verification timeout after 8 seconds')),
            8000,
          ),
        ),
      ]);

      this.logger.debug(
        `Tracker response for ${requestId}: ${JSON.stringify((response as any)?.data)}`,
      );

      const tracker = this.extractTracker((response as any)?.data);
      if (!tracker) {
        // Tracker not present yet — treat as not-confirmable-yet, not a failure.
        this.logger.debug(
          `Tracker not found in response for ${requestId}; reporting pending`,
        );
        return { transactionId: requestId, status: 'pending', amount: 0 };
      }

      // SafePay uses `attempts[]` (not `charges[]`). We still fall back to
      // the legacy field names in case an older SDK response uses them.
      const attempt =
        tracker.attempts?.[0] ??
        tracker.charges?.[0] ??
        tracker.payment_method?.charges?.[0];

      const attemptStatus = (attempt?.status || '').toLowerCase();
      const trackerEnded = tracker.state === 'TRACKER_ENDED';

      const captured = trackerEnded && attemptStatus === 'captured';

      // Terminal failure: the session ended without a capture, or the attempt
      // reached an explicit terminal-failure status. Everything else (still in
      // flight, no attempt yet) is reported as pending so the client keeps polling.
      const terminalFailureStatuses = [
        'failed',
        'declined',
        'rejected',
        'cancelled',
        'canceled',
        'error',
        'expired',
        'void',
        'voided',
      ];
      const failed =
        !captured &&
        ((trackerEnded && Boolean(attempt)) ||
          terminalFailureStatuses.includes(attemptStatus));

      const status = captured ? 'captured' : failed ? 'failed' : 'pending';

      // Amount resolution priority: attempt.net (post-fee) → attempt.amount → tracker.net
      // All values are in paisa (PKR × 100); divide by 100 to get PKR.
      const rawAmount = attempt?.net ?? attempt?.amount ?? tracker.net ?? 0;

      return {
        transactionId: attempt?.id ?? tracker.token ?? requestId,
        status,
        amount: rawAmount / 100,
      };
    } catch (error) {
      // Log detailed error information to aid debugging
      if (error instanceof Error && 'response' in error) {
        const axiosError = error as any;
        this.logger.error('SafePay verification API error:', {
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data,
          message: axiosError.message,
        });
      } else {
        this.logger.error(
          'SafePay verification error:',
          error instanceof Error ? error.stack : error,
        );
      }
      // The tracker API is unreliable/undocumented. A timeout or transport error
      // does NOT mean the payment failed — report 'pending' so the client keeps
      // polling and the webhook can confirm authoritatively.
      return { transactionId: requestId, status: 'pending', amount: 0 };
    }
  }

  private extractTracker(
    envelope: TrackerEnvelope,
  ): TrackerPayload | undefined {
    const dataField = envelope?.data;
    if (dataField && 'tracker' in dataField && dataField.tracker)
      return dataField.tracker;
    if (dataField && 'state' in dataField) return dataField;
    if (envelope?.tracker) return envelope.tracker;
    // Some SafePay responses embed tracker fields at the root alongside `ok`
    if (envelope && 'state' in envelope)
      return envelope as unknown as TrackerPayload;
    return undefined;
  }

  /**
   * Validate the signature SafePay sends on the redirect back to our app
   * (query params `sig` + `tracker`).
   */
  validateRedirectSignature(sig: string, tracker: string): boolean {
    return this.client.verify.signature({ body: { sig, tracker } });
  }

  /** Validate the `X-SFPY-Signature` header on incoming webhook calls. */
  validateWebhookSignature(
    body: Record<string, any>,
    headers: Record<string, any>,
  ): boolean {
    try {
      return this.client.verify.webhook({ body, headers });
    } catch (error) {
      this.logger.warn(
        'Webhook signature validation error:',
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }
}
