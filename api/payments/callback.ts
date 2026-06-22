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
export default function handler(req: any, res: any) {
  try {
    const { order_id, tracker, status } = req.query;

    // Build deep link back to Flutter app
    const deepLinkParams = new URLSearchParams({
      status: status === 'success' ? 'success' : 'cancelled',
      ...(order_id ? { order_id } : {}),
      ...(tracker ? { tracker } : {}),
    });

    const deepLink = `prestigecollection://payment-callback?${deepLinkParams.toString()}`;

    // Return minimal HTML that redirects to deep link
    const html = `<!DOCTYPE html><html><head><script>
      window.location.href = '${deepLink}';
      setTimeout(() => {
        window.location.href = 'https://prestige-men.web.app/orders';
      }, 2000);
    </script></head><body>Redirecting...</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Redirect failed', message: errorMsg });
  }
}
