# Lead email worker

Turns lead-notification emails into instant texts. Each client gets an address
like `desert-air.k7f3a9c2e1@leads.nickbuilds.org` (shown in the CRM's Customers
tab). Point Angi / Thumbtack / Facebook lead notifications at it, or have the
owner auto-forward them.

## One-time setup

1. Add the domain (e.g. `nickbuilds.org`) to Cloudflare and use Cloudflare DNS.
2. Cloudflare dashboard → **Email** → **Email Routing** → enable it for
   `leads.nickbuilds.org` (Cloudflare adds the MX/TXT records).
3. Deploy the worker:
   ```sh
   cd cloudflare/lead-email-worker
   npm install
   npx wrangler login
   npx wrangler secret put LEAD_EMAIL_SECRET   # same value as LEAD_EMAIL_SECRET on Vercel
   # edit LEAD_WEBHOOK_URL in wrangler.toml, then:
   npm run deploy
   ```
4. Email Routing → **Routing rules** → **Catch-all address** → action
   "Send to a Worker" → `lead-email-worker`.
5. On the receptionist's Vercel project set `LEAD_EMAIL_DOMAIN=leads.nickbuilds.org`
   and `LEAD_EMAIL_SECRET` (a long random string).

Test: email `<the client's lead address>` with "Phone: 702-555-0101" in the body.
The lead gets a text and the owner an alert within a few seconds.
