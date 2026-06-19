import { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless Function: SafePay redirect handler
 *
 * SafePay redirects here after payment completion.
 * This function immediately redirects back to the Flutter app via deep link.
 * No web page shown to user — just redirect.
 *
 * Query params from SafePay:
 *   - order_id: MongoDB order ID
 *   - tracker: SafePay transaction tracker token
 *   - status: 'success' or 'cancelled' (from the URL path)
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const { order_id, tracker, status } = req.query;

  // Build deep link back to Flutter app
  const deepLinkParams = new URLSearchParams({
    status: (status as string) === 'success' ? 'success' : 'cancelled',
    ...(order_id ? { order_id: order_id as string } : {}),
    ...(tracker ? { tracker: tracker as string } : {}),
  });

  const deepLink = `prestigecollection://payment-callback?${deepLinkParams.toString()}`;

  // Return minimal HTML that redirects to deep link
  const html = `<!DOCTYPE html><html><head><script>
    window.location.href = ${JSON.stringify(deepLink)};
    setTimeout(() => {
      window.location.href = 'https://prestige-men.web.app/orders';
    }, 2000);
  </script></head><body>Redirecting...</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}
