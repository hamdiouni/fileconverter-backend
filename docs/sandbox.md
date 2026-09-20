# Sandbox Environment

The sandbox is available at `https://sandbox.fileconverterpro.com/v1`.

## Test API Keys

| Key | Tier | Notes |
|-----|------|-------|
| `test_free_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Free | 50 conversions/month |
| `test_pro_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Pro | 500 conversions/month |
| `test_biz_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Business | 5,000 conversions/month |

> Replace `xx...` with keys provided in your developer dashboard.

## Relaxed Rate Limits

| Tier | Requests/hour (Sandbox) |
|------|------------------------|
| All  | 10,000                 |

## Sandbox-Specific Behaviour

- **File storage**: Files are stored for 24 hours only.
- **Virus scanning**: ClamAV is active but test files are never truly deleted.
- **Stripe**: Use [Stripe test cards](https://stripe.com/docs/testing) for billing flows.
- **Emails**: All emails are captured by Mailhog — no real emails are sent.
- **Webhooks**: Register `https://webhook.site` endpoints for testing webhook delivery.

## Accessing Mailhog

When running locally with Docker Compose, the Mailhog UI is available at
`http://localhost:8025`.

## Sandbox Registration

```bash
curl -s -X POST https://sandbox.fileconverterpro.com/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"sandbox-test@example.com","password":"TestPass123!"}'
```
