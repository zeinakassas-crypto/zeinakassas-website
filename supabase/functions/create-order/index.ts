// POST multipart/form-data from the checkout form.
// Validates the order, locks the price server-side, stores the receipt
// privately, creates the order and emails the customer + Zeina.
import {
  adminClient, ADMIN_EMAIL, button, cors, emailLayout, esc, json, orderLink, sendEmail, SITE_URL,
} from "../_shared/common.ts";

const MAX_RECEIPT = 10 * 1024 * 1024;
const RECEIPT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "application/pdf": "pdf",
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "Invalid form" }, 400); }

  const str = (k: string, max = 300) => String(form.get(k) ?? "").trim().slice(0, max);
  if (str("website")) return json({ ok: true }); // honeypot: bots fill hidden field

  const productId = str("product") || "eat-well";
  const format = str("format");
  const name = str("name", 120);
  const email = str("email", 160).toLowerCase();
  const whatsapp = str("whatsapp", 40);
  const city = str("city", 80);
  const address = str("address", 500);
  const notes = str("notes", 1000);
  const paymentRef = str("payment_ref", 120);
  const lang = str("lang") === "ar" ? "ar" : "en";
  const receipt = form.get("receipt");
  const discountCode = str("discount_code", 40);

  const errors: string[] = [];
  if (!["pdf", "print"].includes(format)) errors.push("format");
  if (name.length < 2) errors.push("name");
  if (!EMAIL_RE.test(email)) errors.push("email");
  const waDigits = whatsapp.replace(/[^\d]/g, "");
  if (format === "print" && waDigits.length < 8) errors.push("whatsapp");
  if (whatsapp && waDigits.length < 8) errors.push("whatsapp");
  if (format === "print" && (!city || address.length < 8)) errors.push("address");

  const db = adminClient();

  // Price (and discount) are always decided here, never by the browser.
  const { data: quote, error: priceErr } = await db.rpc("quote_price", { p_id: productId, p_code: discountCode || null });
  if (priceErr || !quote || quote.error) return json({ error: "Product not available" }, 400);
  if (quote.code_error) return json({ error: "discount", code_error: quote.code_error, fields: ["discount_code"] }, 400);
  const price: number = quote.total;

  // A receipt is required unless a 100% code makes the order free.
  const hasReceipt = receipt instanceof File && receipt.size > 0;
  if (price > 0 && !hasReceipt) errors.push("receipt");
  else if (hasReceipt && (receipt as File).size > MAX_RECEIPT) errors.push("receipt_size");
  else if (hasReceipt && !RECEIPT_TYPES[(receipt as File).type] && !/^image\//.test((receipt as File).type)) errors.push("receipt_type");
  if (errors.length) return json({ error: "validation", fields: errors }, 400);

  let receiptPath = "";
  if (hasReceipt) {
    const file = receipt as File;
    const ext = RECEIPT_TYPES[file.type] ?? "img";
    receiptPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from("receipts").upload(receiptPath, file, { contentType: file.type });
    if (up.error) return json({ error: "Could not save receipt, please try again" }, 500);
  }

  const { data: order, error } = await db.from("orders").insert({
    product_id: productId,
    format,
    amount_egp: price,
    discount_code: quote.code ?? null,
    discount_egp: quote.discount ?? 0,
    customer_name: name,
    email,
    whatsapp: whatsapp || null,
    city: city || null,
    address: address || null,
    notes: notes || null,
    payment_ref: paymentRef || null,
    lang,
    receipt_path: receiptPath || null,
    print_status: format === "print" ? "awaiting_quote" : null,
  }).select("id, order_no, access_token, amount_egp").single();

  if (error || !order) {
    if (receiptPath) await db.storage.from("receipts").remove([receiptPath]);
    return json({ error: "Could not create order, please try again" }, 500);
  }

  const link = orderLink(order.id, order.access_token, lang);
  const ar = lang === "ar";

  // Emails are best-effort: the order is saved even if email is not configured yet.
  const customerHtml = ar
    ? emailLayout(`<h2 style="margin:0 0 12px">استلمنا طلبك رقم #${order.order_no} ✅</h2>
      <p>أهلاً ${esc(name)}، شكراً على طلب <b>Eat Well Vol. 1 — كتيب الـ 4 أسابيع</b>.</p>
      <p>هنراجع إيصال الدفع ونأكد طلبك في أقرب وقت. أول ما الدفع يتأكد هيوصلك إيميل فيه الـ PDF${format === "print" ? "، وهنتواصل معاك على واتساب بتكلفة الطباعة والشحن" : ""}.</p>
      <p>المبلغ: <b>${order.amount_egp} جنيه</b></p>${button(link, "متابعة الطلب")}`, true)
    : emailLayout(`<h2 style="margin:0 0 12px">Order #${order.order_no} received ✅</h2>
      <p>Hi ${esc(name)}, thank you for ordering <b>Eat Well Vol. 1 — The 4-Week Recipe Book</b>.</p>
      <p>We're reviewing your payment receipt now. As soon as payment is confirmed you'll get an email with your PDF${format === "print" ? ", and we'll message you on WhatsApp with the printing + shipping cost" : ""}.</p>
      <p>Amount: <b>${order.amount_egp} EGP</b></p>${button(link, "Track your order")}`);

  const adminHtml = emailLayout(`<h2 style="margin:0 0 12px">New order #${order.order_no} — ${format === "print" ? "PRINTED COPY" : "PDF"}</h2>
    <p><b>${esc(name)}</b> · ${esc(email)}${whatsapp ? ` · WhatsApp ${esc(whatsapp)}` : ""}</p>
    <p>Amount: <b>${order.amount_egp} EGP</b>${quote.code ? ` · Code ${esc(quote.code)} (−${quote.discount} EGP)` : ""}${paymentRef ? ` · Ref: ${esc(paymentRef)}` : ""}</p>
    ${format === "print" ? `<p>Ship to: ${esc(city)} — ${esc(address)}</p>` : ""}
    ${notes ? `<p>Notes: ${esc(notes)}</p>` : ""}
    ${button(`${SITE_URL}/admin.html`, "Review receipt & confirm")}`);

  await Promise.allSettled([
    sendEmail(email, ar ? `استلمنا طلبك #${order.order_no} — Eat Well` : `Order #${order.order_no} received — Eat Well`, customerHtml),
    ADMIN_EMAIL ? sendEmail(ADMIN_EMAIL, `🛒 New order #${order.order_no} (${format.toUpperCase()}) — ${order.amount_egp} EGP`, adminHtml) : Promise.resolve(),
  ]);

  return json({ ok: true, id: order.id, token: order.access_token, order_no: order.order_no, amount: order.amount_egp });
});
