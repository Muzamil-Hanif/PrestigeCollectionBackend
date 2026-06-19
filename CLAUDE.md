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

The Vercel function redirects SafePay callbacks directly to the Flutter app via deep link (`prestigecollection://payment-callback?...`), eliminating the ngrok free-tier warning page.
