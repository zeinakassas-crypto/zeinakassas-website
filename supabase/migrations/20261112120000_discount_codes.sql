-- ZK Shop: discount codes
-- A code takes a percentage or a fixed EGP amount off the book price
-- (printing + shipping is quoted separately and is never discounted).
-- It stacks on top of the current price, so during the launch offer it
-- applies to the offer price.

create table if not exists public.discount_codes (
  code        text primary key check (code ~ '^[A-Z0-9_-]{2,30}$'),   -- stored in capitals
  kind        text not null check (kind in ('percent', 'amount')),
  value       integer not null check (value > 0),                     -- percent (1–100) or EGP
  active      boolean not null default true,
  starts_at   timestamptz,                                            -- null = from now
  ends_at     timestamptz,                                            -- null = no expiry (exclusive)
  max_uses    integer check (max_uses > 0),                           -- null = unlimited
  note        text,
  created_at  timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);

alter table public.discount_codes enable row level security;

drop policy if exists "admins manage codes" on public.discount_codes;
create policy "admins manage codes" on public.discount_codes for all
  using (public.is_shop_admin()) with check (public.is_shop_admin());

alter table public.orders add column if not exists discount_code text;
alter table public.orders add column if not exists discount_egp  integer not null default 0;
-- free orders (100% code) have no receipt
alter table public.orders alter column receipt_path drop not null;
create index if not exists orders_discount_code_idx on public.orders (discount_code) where discount_code is not null;

-- Price for a product with an optional code. Used by the checkout page
-- (Apply button) and, authoritatively, by the create-order function.
-- A use is counted for every order with the code that is not rejected,
-- so a rejected order gives its use back.
create or replace function public.quote_price(p_id text, p_code text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  base   integer := public.product_price(p_id);
  c      public.discount_codes;
  used   integer;
  off    integer;
  norm   text := upper(btrim(coalesce(p_code, '')));
begin
  if base is null then
    return jsonb_build_object('error', 'product');
  end if;
  if norm = '' then
    return jsonb_build_object('price', base, 'discount', 0, 'total', base);
  end if;

  select * into c from public.discount_codes where code = norm;
  if not found or not c.active then
    return jsonb_build_object('price', base, 'discount', 0, 'total', base, 'code_error', 'invalid');
  end if;
  if (c.starts_at is not null and now() < c.starts_at) or (c.ends_at is not null and now() >= c.ends_at) then
    return jsonb_build_object('price', base, 'discount', 0, 'total', base, 'code_error', 'expired');
  end if;
  if c.max_uses is not null then
    select count(*) into used from public.orders where discount_code = c.code and status <> 'rejected';
    if used >= c.max_uses then
      return jsonb_build_object('price', base, 'discount', 0, 'total', base, 'code_error', 'used_up');
    end if;
  end if;

  off := case when c.kind = 'percent' then round(base * c.value / 100.0)::integer else least(c.value, base) end;
  return jsonb_build_object('price', base, 'discount', off, 'total', base - off,
                            'code', c.code, 'kind', c.kind, 'value', c.value);
end;
$$;

revoke all on function public.quote_price(text, text) from public;
grant execute on function public.quote_price(text, text) to anon, authenticated, service_role;
