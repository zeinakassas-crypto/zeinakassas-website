-- ZK Shop: PayPal (US dollars) for buyers outside Egypt.
-- PayPal can't take EGP, so the book has its own USD price. PayPal orders
-- are PDF only (printed copies ship within Egypt).

alter table public.products add column if not exists price_usd numeric(10,2);
alter table public.products add column if not exists offer_usd numeric(10,2);   -- same offer window as the EGP offer
update public.products set price_usd = 35, offer_usd = 28 where id = 'eat-well';

alter table public.orders add column if not exists payment_method text not null default 'instapay'
  check (payment_method in ('instapay', 'paypal'));
alter table public.orders add column if not exists currency text not null default 'EGP'
  check (currency in ('EGP', 'USD'));
alter table public.orders add column if not exists amount_usd numeric(10,2);    -- what a PayPal buyer pays
-- amount_egp keeps the EGP price for every order (for PayPal orders: the EGP equivalent, for reference).

-- quote_price now takes a currency. A percentage code works the same in both;
-- a fixed EGP code takes the same share of the USD price as of the EGP price.
drop function if exists public.quote_price(text, text);
create or replace function public.quote_price(p_id text, p_code text default null, p_currency text default 'EGP')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p       public.products;
  base    integer := public.product_price(p_id);       -- EGP price right now
  usd     numeric;
  c       public.discount_codes;
  used    integer;
  off     integer := 0;                                -- EGP discount
  cur     text := case when upper(coalesce(p_currency, 'EGP')) = 'USD' then 'USD' else 'EGP' end;
  norm    text := upper(btrim(coalesce(p_code, '')));
  err     text;
  res     jsonb;
begin
  if base is null then
    return jsonb_build_object('error', 'product');
  end if;
  select * into p from public.products where id = p_id;
  usd := case when p.offer_usd is not null and now() >= p.offer_starts and now() < p.offer_ends
              then p.offer_usd else p.price_usd end;
  if cur = 'USD' and usd is null then
    return jsonb_build_object('error', 'currency');
  end if;

  if norm <> '' then
    select * into c from public.discount_codes where code = norm;
    if not found or not c.active then
      err := 'invalid';
    elsif (c.starts_at is not null and now() < c.starts_at) or (c.ends_at is not null and now() >= c.ends_at) then
      err := 'expired';
    elsif c.max_uses is not null then
      select count(*) into used from public.orders where discount_code = c.code and status <> 'rejected';
      if used >= c.max_uses then err := 'used_up'; end if;
    end if;
    if err is null then
      off := case when c.kind = 'percent' then round(base * c.value / 100.0)::integer else least(c.value, base) end;
    end if;
  end if;

  if cur = 'USD' then
    res := jsonb_build_object('currency', 'USD', 'price', usd,
      'discount', case when c.code is null or err is not null then 0
                       when c.kind = 'percent' then round(usd * c.value / 100.0, 2)
                       else round(usd * off / base::numeric, 2) end);
    res := res || jsonb_build_object('total', usd - (res->>'discount')::numeric);
  else
    res := jsonb_build_object('currency', 'EGP', 'price', base, 'discount', off, 'total', base - off);
  end if;
  res := res || jsonb_build_object('price_egp', base, 'discount_egp', off, 'total_egp', base - off);

  if err is not null then
    return res || jsonb_build_object('code_error', err);
  end if;
  if c.code is not null then
    res := res || jsonb_build_object('code', c.code, 'kind', c.kind, 'value', c.value);
  end if;
  return res;
end;
$$;

revoke all on function public.quote_price(text, text, text) from public;
grant execute on function public.quote_price(text, text, text) to anon, authenticated, service_role;
