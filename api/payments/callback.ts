/**
 * Vercel Serverless Function: SafePay redirect handler
 *
 * SafePay redirects here after payment completion.
 * This function:
 * 1. Stores the tracker token on the backend (crucial for payment verification)
 * 2. Redirects back to the Flutter app via deep link (mobile)
 * 3. Shows success page (web fallback)
 *
 * Query params from SafePay:
 *   - order_id: MongoDB order ID
 *   - tracker: SafePay transaction tracker token
 *   - status: 'success' or 'cancelled' (from the URL path)
 */
export default async function handler(req: any, res: any) {
  try {
    const { order_id, tracker, status } = req.query;

    // Step 1: Store tracker on backend (CRITICAL for payment verification)
    if (order_id && tracker) {
      try {
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
        // Call the backend to store tracker token
        await fetch(`${backendUrl}/api/payments/callback/${status === 'success' ? 'success' : 'cancelled'}?order_id=${order_id}&tracker=${tracker}`, {
          method: 'GET',
        }).catch(() => {
          // If backend is unreachable, continue anyway (webhook will handle it)
          console.log('Backend unreachable, but continuing with redirect');
        });
      } catch (error) {
        console.log('Could not reach backend to store tracker, continuing:', error);
      }
    }

    // Step 2: Build deep link back to Flutter app
    const deepLinkParams = new URLSearchParams({
      status: status === 'success' ? 'success' : 'cancelled',
      ...(order_id ? { order_id } : {}),
      ...(tracker ? { tracker } : {}),
    });

    const deepLink = `prestigecollection://payment-callback?${deepLinkParams.toString()}`;

    // Step 3: Return HTML that tries deep link (mobile) and shows success page (web)
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}.container{text-align:center;background:white;padding:40px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}h1{color:#111827;margin:0 0 10px}p{color:#666;margin:10px 0}button{background:#F2C94C;color:#111827;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-size:16px;font-weight:600}button:hover{opacity:0.9}</style><script>
      // Try deep link first (mobile)
      const deepLink = '${deepLink}';
      window.location.href = deepLink;

      // If we're still here after 1.5s, we're on web
      setTimeout(() => {
        document.querySelector('.deeplink-failed').style.display = 'block';
      }, 1500);
    </script></head><body><div class="container"><h1>✅ Payment Successful!</h1><p>Your payment has been processed successfully.</p><div class="deeplink-failed" style="display:none"><p>Returning to app...</p><button onclick="window.close()">Close</button></div></div></body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Redirect failed', message: errorMsg });
  }
}
