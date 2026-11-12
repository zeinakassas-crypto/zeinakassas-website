// POST { id, token, download? } — used by order.html.
// Returns the order status. When the order is paid and download=true, returns
// a short-lived signed link to the private PDF.
import { adminClient, cors, json } from "../_shared/common.ts";

const MAX_DOWNLOADS = 25;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { id?: string; token?: string; download?: boolean };
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const { id, token, download } = body;
  if (!id || !token || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "not_found" }, 404);

  const db = adminClient();
  const { data: o } = await db.from("orders")
    .select("id, order_no, access_token, created_at, format, amount_egp, customer_name, status, reject_reason, print_status, print_fee_egp, download_count, product_id, products(name, pdf_path)")
    .eq("id", id).maybeSingle();

  // constant-ish comparison; never reveal whether the id exists
  if (!o || o.access_token.length !== token.length || o.access_token !== token) return json({ error: "not_found" }, 404);

  // deno-lint-ignore no-explicit-any
  const product = (o as any).products as { name: string; pdf_path: string };
  const result: Record<string, unknown> = {
    order_no: o.order_no, created_at: o.created_at, format: o.format, amount: o.amount_egp,
    name: o.customer_name, status: o.status, reject_reason: o.reject_reason,
    print_status: o.print_status, print_fee: o.print_fee_egp, product: product?.name,
  };

  if (download) {
    if (o.status !== "paid") return json({ ...result, error: "not_paid" }, 403);
    if (o.download_count >= MAX_DOWNLOADS) return json({ ...result, error: "download_limit" }, 429);
    const { data: signed, error } = await db.storage.from("products")
      .createSignedUrl(product.pdf_path, 600, { download: "ZK-Eat-Well-4-Week-Recipe-Plan.pdf" });
    if (error || !signed) return json({ ...result, error: "file_unavailable" }, 500);
    await db.from("orders").update({ download_count: o.download_count + 1 }).eq("id", o.id);
    result.url = signed.signedUrl;
  }

  return json(result);
});
