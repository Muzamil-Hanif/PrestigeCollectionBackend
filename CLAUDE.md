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

### Deployment (Render + MongoDB Atlas)

This is a **long-running NestJS server** (`main.ts` calls `app.listen()`), so it must run
on a **persistent Node host** — Render, Railway, Fly.io, a VPS, etc. It is **not** a Vercel
serverless app: Vercel runs exported request handlers, and deploying this `main.ts` there
crashes with `No exports found in module "main.js"`. Do not add a serverless adapter / `api/`
function unless you intentionally migrate the whole app to that model.

The database must be **MongoDB Atlas** (or any reachable hosted Mongo) — a cloud host cannot
reach a local MongoDB. Set `MONGODB_URI` to the Atlas `mongodb+srv://...` string and allow
the host's egress in Atlas → Network Access (`0.0.0.0/0` is simplest).

**Render (blueprint):** [`render.yaml`](render.yaml) defines the web service —
`buildCommand: npm install && npm run build`, `startCommand: npm run start:prod`,
`healthCheckPath: /api` (AppController `GET /api` returns 200). Secrets (`MONGODB_URI`,
`JWT_SECRET`, all `SAFEPAY_*`) are `sync: false` and set in the Render dashboard. Render
injects `PORT`; `main.ts` binds `0.0.0.0`. Set `SAFEPAY_REDIRECT_BASE_URL` to the
`https://<app>.onrender.com` URL so SafePay's redirect + webhook reach the service.

Seed the first admin after the DB is connected: `npm run seed:admin`
(`MONGODB_URI=<atlas> node scripts/seed-admin.js`) → `admin@prestige-men.com` / `Admin@12345`.

**Important:** All `/api/payments/*` routes are served by the NestJS app — there is no separate `api/` folder with standalone serverless functions. A legacy `api/payments/callback.ts` serverless function previously existed alongside a `vercel.json` route override (`"src": "/api/payments/callback/(.*)"`) that hijacked the callback path before it reached `PaymentsController`. That function tried to re-POST to `BACKEND_URL` (unset in production, defaulting to `http://localhost:3000`), so it silently failed to store the SafePay tracker token — `PaymentsController.verifyPayment()` then fell back to the pre-checkout session token (`requestId`) instead of the real tracker, which SafePay's Fetch Tracker API correctly rejects with "cannot find tracker ... using keys" since that ID was never promoted to a real tracker. Both the file and `vercel.json` were removed; do not reintroduce a standalone `api/` function for payment callbacks — all logic belongs in `PaymentsController`.
