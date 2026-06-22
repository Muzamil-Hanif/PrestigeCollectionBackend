# CLAUDE.md — prestige-men-backend

See parent directory's CLAUDE.md for full architecture documentation and commands.

## Payment Integration (SafePay)

### Payment Callback Handler
`POST /api/payments/callback/:status` receives SafePay redirects after payment completion.

**Flow:**
1. SafePay redirects to `GET /api/payments/callback/success?order_id=...&tracker=...`
2. Backend stores tracker token in database (needed for app verification)
3. Renders branded HTML page with:
   - Success/failure badge and message (using brand colors #111827, #F2C94C)
   - JavaScript that attempts to open deep link: `prestigecollection://payment-callback?...`
   - Fallback "Return to App" button for web users
   - Auto-detection of app installation with app store link
4. On mobile: Deep link triggers OS to launch app with payment callback data
5. On web: User sees branded page with retry button and support contact

**Security:**
- Webhook is the authoritative source (not this callback)
- SafePay signature validation via custom HMAC verification
- Tracker token stored server-side for app verification

**Configuration:**
```env
SAFEPAY_ENVIRONMENT=sandbox           # or 'production'
SAFEPAY_API_KEY=sec_xxxx...           # SafePay dashboard
SAFEPAY_V1_SECRET=xxxx...             # SafePay dashboard
SAFEPAY_WEBHOOK_SECRET=xxxx...        # SafePay dashboard → Webhooks
SAFEPAY_REDIRECT_BASE_URL=https://api.prestige-men.com  # For production
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
