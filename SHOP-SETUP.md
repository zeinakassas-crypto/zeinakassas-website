# ZK Shop — "Eat Well" 4-Week Recipe Plan

## How it works

```
Customer                                   You (Coach Bigzee)
────────                                   ──────────────────
eat-well.html
  1. Picks PDF or Printed copy
  2. Fills name, email, WhatsApp*
     (*required for printed copies) + address
  3. Pays via InstaPay
  4. Uploads receipt (REQUIRED), then Place order ──► 📧 "New order" email to you
         │
         ▼
order.html (their private order link, also emailed)
  "Pending review", download locked 🔒
                                           admin.html
                                             - see the order, open the receipt
                                             - click ✓ "Payment confirmed — send PDF"
         ◄─────────────────────────────────── PDF is emailed to the customer automatically
order.html unlocks ⬇ Download PDF            (attached + link)

Printed copy only:                         - type the printing + shipping fee
                                             → "Save & send on WhatsApp" (message is pre-written)
                                           - mark "Fee paid", then "Shipped"
                                             (the customer sees each step on order.html)
```

**Pricing** is stored in the database, so nobody can change it from their browser:
- Regular price **1,500 EGP**
- Launch offer **1,200 EGP** from **Friday 13 Nov 2026, 00:00** to **Sunday 22 Nov 2026, 23:59** (Cairo time, 10 days)
- The price is locked when the order is placed. The website switches the price and the countdown on its own.

**Security**: the PDF and the receipts are stored in **private** storage. Customers only ever get a download link that expires after 10 minutes, and only after you confirm the payment. Each order link has a secret token. The PDF is **not** in this GitHub repo; keep it that way.

## Files

| File | What it is |
|---|---|
| `eat-well.html` | Product page + checkout (English, plus Arabic via `?lang=ar`) |
| `order.html` | Customer's order status + download page |
| `admin.html` | Your dashboard (log in, review receipts, confirm payment) |
| `assets/shop/shop-config.js` | **The only file you edit**: Supabase URL + key |
| `assets/shop/*.webp` | Cover and preview pages (pages 1, 2, 5, 6, 7 of the PDF) |
| `supabase/migrations/…_shop.sql` | Database tables, pricing, security rules, storage buckets |
| `supabase/functions/*` | Server code: create order, order status, admin actions + emails |

## One-time setup (about 20 minutes)

### 1. Supabase (database, storage, server code), free plan is enough
1. Create a project at https://supabase.com, e.g. "zk-shop" (region: Frankfurt / eu-central-1).
2. **SQL Editor** → paste all of `supabase/migrations/20261112000000_shop.sql` → Run.
3. **Storage** → open the `products` bucket → upload `ZK-Eat-Well-4-Week-Recipe-Plan.pdf`
   (the name must match exactly).
4. **Authentication → Users → Add user**: `zeina.kassas@gmail.com` + a strong password, tick "Auto confirm".
   Then **Authentication → Sign In / Providers** → turn **off** "Allow new users to sign up".
5. Deploy the functions (from this repo folder, with the Supabase CLI):
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase functions deploy create-order order-status admin-action --no-verify-jwt
   ```

### 2. Emails (Resend), free for up to 3,000 emails a month
1. Sign up at https://resend.com → **Domains → Add domain** `zeinakassas.fit` → add the DNS records it shows at your domain provider → wait for "Verified".
2. **API Keys → Create** → copy the key.
3. In Supabase → **Edge Functions → Secrets**, add:
   | Name | Value |
   |---|---|
   | `RESEND_API_KEY` | your Resend key |
   | `MAIL_FROM` | `Coach Bigzee <orders@zeinakassas.fit>` |
   | `ADMIN_EMAIL` | `zeina.kassas@gmail.com` (new-order alerts + customers' replies go here) |
   | `SITE_URL` | `https://zeinakassas.fit` |
   | `PDF_WITH_PRINT` | `true` (printed-copy buyers also get the PDF) or `false` |

### 3. Connect the website
In Supabase → **Project Settings → API**, copy the **Project URL** and the **anon / publishable key**,
and paste them into `assets/shop/shop-config.js`. Commit, and the shop is live.

### 4. Test it once
Place a test order with your own email and any screenshot → open `zeinakassas.fit/admin.html` →
log in → **View receipt** → **✓ Payment confirmed — send PDF** → check your inbox.

## Everyday use
- You get an email for every new order → open **admin.html** → check the receipt against InstaPay →
  **✓ Payment confirmed** (the customer gets the PDF by email automatically) or **✕ Reject** (they get a polite email).
- If an email ever fails, the order stays confirmed, the customer can still download from their order page, and you can press **↻ Resend PDF email**.
- **Printed copy:** enter the fee → **Save & send on WhatsApp** (opens WhatsApp with the message ready) →
  when they pay, **Fee paid** → after delivery, **Shipped**.

## Changing the price or offer later
Supabase → Table Editor → `products` → edit `price_egp`, `offer_egp`, `offer_starts`, `offer_ends`.
Also update the same numbers in `assets/shop/shop-config.js` and in the small script at the end of `index.html` / `ar.html`.
They only control what the home-page teaser shows when the database can't be reached.
