-- ZK Shop: free gift copies.
-- The admin sends the PDF to someone as a gift from admin.html (🎁 Send a gift).
-- A gift is stored as an order that is already paid, costs 0 and has no receipt,
-- so the recipient gets the same private download page as a buyer.

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('instapay', 'paypal', 'gift'));

alter table public.orders add column if not exists gift_message text;   -- personal note shown in the gift email
