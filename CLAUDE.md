# CLAUDE.md — prestige-men-backend

See parent directory's CLAUDE.md for full architecture documentation and commands.

## Vercel Deployment (NEW)

This backend is configured to deploy to Vercel with a serverless function for SafePay payment redirects.

### Files
- `vercel.json` — Deployment config
- `api/payments/callback.ts` — Vercel serverless function that handles SafePay redirects

### To Deploy
```bash
# Option 1: Vercel CLI
npm i -g vercel
vercel deploy --prod

# Option 2: GitHub + Vercel dashboard (recommended)
# Push to GitHub, then import to vercel.com
```

### Environment Variable
After deployment, update `.env`:
```env
SAFEPAY_REDIRECT_BASE_URL=https://your-vercel-deployment.vercel.app
```

### Implementation Notes
- `api/payments/callback.ts` uses plain JavaScript (no `@vercel/node` types) for runtime compatibility
- **CRITICAL:** Function calls backend to store tracker token BEFORE redirecting
  - Without this, payment verification fails ("Payment not yet confirmed")
  - Backend stores tracker so app can verify payment status
- Function receives SafePay query params and redirects to deep link (`prestigecollection://payment-callback?...`)
- On mobile: deep link opens the Flutter app automatically + app verifies payment
- On web browsers: shows success page (deep link doesn't work on web)
- Webhook is authoritative source; this callback is best-effort verification
- Eliminates ngrok free-tier warning page entirely
