-- ZK Shop: orders for the "Eat Well — 4-Week Recipe Plan" (and future products)
-- Run once in Supabase (SQL editor or `supabase db push`).

-- ---------------------------------------------------------------------------
-- Products (price + time-limited offer live here, NOT in the website code,
-- so nobody can change the price from the browser)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id            text primary key,                 -- e.g. 'eat-well'
  name          text not null,
  price_egp     integer not null,                 -- regular price
  offer_egp     integer,                          -- offer price (null = no offer)
  offer_starts  timestamptz,
  offer_ends    timestamptz,                      -- exclusive
  pdf_path      text not null,                    -- path inside the private 'products' bucket
  active        boolean not null default true
);

insert into public.products (id, name, price_egp, offer_egp, offer_starts, offer_ends, pdf_path)
values (
  'eat-well',
  'Eat Well — The 4-Week Recipe Plan',
  1500,
  1200,
  '2026-11-13 00:00:00+02',   -- Friday 13 Nov 2026, midnight Cairo time
  '2026-11-23 00:00:00+02',   -- 10 full days: 13 → 22 Nov inclusive
  'ZK-Eat-Well-4-Week-Recipe-Plan.pdf'
)
on conflict (id) do update set
  name = excluded.name, price_egp = excluded.price_egp, offer_egp = excluded.offer_egp,
  offer_starts = excluded.offer_starts, offer_ends = excluded.offer_ends, pdf_path = excluded.pdf_path;

create or replace function public.product_price(p_id text, at_time timestamptz default now())
returns integer language sql stable as $$
  select case
    when offer_egp is not null and at_time >= offer_starts and at_time < offer_ends then offer_egp
    else price_egp end
  from public.products where id = p_id and active;
$$;

-- ---------------------------------------------------------------------------
-- Admins (whoever is listed here can see orders and receipts)
-- ---------------------------------------------------------------------------
create table if not exists public.shop_admins (
  email text primary key
);
insert into public.shop_admins (email) values ('zeina.kassas@gmail.com') on conflict do nothing;

create or replace function public.is_shop_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shop_admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        bigint generated always as identity,
  access_token    text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),  -- secret for the customer's order link
  created_at      timestamptz not null default now(),

  product_id      text not null references public.products(id),
  format          text not null check (format in ('pdf', 'print')),
  amount_egp      integer not null,                -- price locked at checkout time

  customer_name   text not null,
  email           text not null,
  whatsapp        text,                            -- required for print (checked in create-order)
  city            text,
  address         text,
  notes           text,
  lang            text not null default 'en',

  payment_ref     text,                            -- InstaPay reference / sender name (optional)
  receipt_path    text not null,                   -- path inside the private 'receipts' bucket

  status          text not null default 'pending' check (status in ('pending', 'paid', 'rejected')),
  reject_reason   text,
  confirmed_at    timestamptz,
  email_sent_at   timestamptz,
  email_error     text,
  download_count  integer not null default 0,

  -- printed copies only
  print_fee_egp   integer,                         -- printing + shipping, set by admin
  print_status    text check (print_status in ('awaiting_quote', 'quote_sent', 'fee_paid', 'shipped')),
  admin_notes     text
);

create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);

alter table public.products    enable row level security;
alter table public.shop_admins enable row level security;
alter table public.orders      enable row level security;

-- Anyone may read the product list (price shown on the site)
drop policy if exists "products readable" on public.products;
create policy "products readable" on public.products for select using (true);

-- Only admins can read/update orders from the browser.
-- Customers never touch this table directly: orders are created and read
-- through the Edge Functions (service role), which check the access token.
drop policy if exists "admins read orders" on public.orders;
create policy "admins read orders" on public.orders for select using (public.is_shop_admin());
drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders" on public.orders for update using (public.is_shop_admin()) with check (public.is_shop_admin());

drop policy if exists "admins read admins" on public.shop_admins;
create policy "admins read admins" on public.shop_admins for select using (public.is_shop_admin());

-- ---------------------------------------------------------------------------
-- Storage: two PRIVATE buckets
--   products  – the PDF itself (never public; customers get short-lived signed links)
--   receipts  – payment screenshots uploaded at checkout
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('products', 'products', false, 52428800),
       ('receipts', 'receipts', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "admins read receipts" on storage.objects;
create policy "admins read receipts" on storage.objects for select
  using (bucket_id = 'receipts' and public.is_shop_admin());
