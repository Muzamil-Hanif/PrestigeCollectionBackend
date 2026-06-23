# CLAUDE.md — prestige-collection-backend

See parent directory's CLAUDE.md for full architecture documentation and commands.

## Payment Integration (SafePay)

### Payment Callback Handler
`GET /api/payments/callback/:status` receives SafePay redirects after payment completion.

**Flow:**
1. SafePay redirects browser to `GET /api/payments/callback/success?order_id=...&tracker=...`
2. Backend stores tracker token in database with improved error handling and logging
3. Renders branded HTML page with:
   - Success/failure badge and message (using brand colors #111827, #F2C94C)
   - Smooth animations (slideUp, scaleIn) for better UX
   - JavaScript that attempts deep link open: `prestigecollection://payment-callback?...`
   - Iframe fallback for alternative browser support
   - Fallback "Return to App" button for web users
   - Auto-detection of app installation with app store link after 5s timeout
   - Safe DOM manipulation using `createElement`/`appendChild` (no innerHTML vulnerabilities)
4. On mobile: Deep link triggers OS to launch app with payment callback data
5. On web: If `SAFEPAY_WEB_REDIRECT_URL` (or `FRONTEND_URL`) is set, the page redirects the
   browser to `<web-app>/#/payment-callback?status=...&order_id=...&tracker=...` so the
   Flutter web build can resume the verify→success flow instead of stranding the user on the
   HTML page. The UA-based heuristic redirects desktop browsers immediately and uses the deep
   link only on mobile (with a web fallback if the app isn't installed).

**Verification Endpoint (tri-state, webhook-first):**
- `GET /api/payments/verify/:orderId/:requestId`. Verification uses **only server-stored,
  order-bound identifiers** — never a client-supplied tracker (that would let an attacker
  submit another order's captured tracker of a matching amount to mark their own unpaid order
  paid). Resolution order: stored `paymentTrackerToken` (set by the SafePay redirect
  callback/webhook, which carry SafePay's order_id binding) → session `requestId`, but only
  when it matches the `paymentSessionToken` we issued for this order at initiation.
- **Webhook-first:** if the order is already `captured` (webhook landed), returns success
  immediately without calling SafePay.
- **Tri-state response** — returns `{ success, paymentStatus, pending, ... }`:
  - `captured` → `success:true` (order marked `payment_successful`, cart cleared)
  - `failed` → `success:false, pending:false` (order marked `cancelled`) — only on a
    *definitive* SafePay terminal-failure state
  - `pending` → `success:false, pending:true` — used for timeouts/unreachable API/in-flight
    payments so the client keeps polling instead of seeing a false "Payment Failed". The
    order is **not** marked cancelled.
- `SafepayService.verifyPayment()` never throws on a slow/unreachable tracker API — it
  returns `pending`. The webhook remains the authoritative confirmation.

**Security:**
- Webhook is the authoritative source (not this callback)
- SafePay signature validation via custom HMAC verification
- Tracker token stored server-side with proper error handling
- Enhanced logging for debugging and monitoring

**Configuration:**
```env
SAFEPAY_ENVIRONMENT=sandbox           # or 'production'
SAFEPAY_API_KEY=sec_xxxx...           # SafePay dashboard
SAFEPAY_V1_SECRET=xxxx...             # SafePay dashboard
SAFEPAY_WEBHOOK_SECRET=xxxx...        # SafePay dashboard → Webhooks
SAFEPAY_REDIRECT_BASE_URL=https://api.prestigecollection.com  # For production
SAFEPAY_WEB_REDIRECT_URL=https://app.prestigecollection.com   # Flutter web origin; callback redirects browser here on web (falls back to FRONTEND_URL)
```

### Vercel Deployment

```bash
# Deploy with Vercel CLI
npm i -g vercel
vercel deploy --prod

# Or use GitHub integration (recommended)
# Push to GitHub → Connect to Vercel dashboard
```

After deployment, update environment variables in Vercel dashboard to match your production domain.

**Important:** All `/api/payments/*` routes are served by the NestJS app — there is no separate `api/` folder with standalone Vercel functions. A legacy `api/payments/callback.ts` serverless function previously existed alongside a `vercel.json` route override (`"src": "/api/payments/callback/(.*)"`) that hijacked the callback path before it reached `PaymentsController`. That function tried to re-POST to `BACKEND_URL` (unset in production, defaulting to `http://localhost:3000`), so it silently failed to store the SafePay tracker token — `PaymentsController.verifyPayment()` then fell back to the pre-checkout session token (`requestId`) instead of the real tracker, which SafePay's Fetch Tracker API correctly rejects with "cannot find tracker ... using keys" since that ID was never promoted to a real tracker. Both the file and `vercel.json` were removed; do not reintroduce a standalone `api/` function for payment callbacks — all logic belongs in `PaymentsController`.
