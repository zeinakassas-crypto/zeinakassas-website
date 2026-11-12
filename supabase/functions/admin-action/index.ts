// POST { action, id, ... } with the admin's login token (Authorization: Bearer <jwt>).
// Actions:
//   confirm        – mark paid + automatically email the PDF to the customer
//   reject         – mark rejected (optional reason) + email the customer
//   resend         – re-send the PDF email
//   print_fee      – save printing + shipping fee for a printed order (status → quote_sent)
//   print_status   – set print_status to fee_paid | shipped
//   receipt_url    – signed link to view the uploaded receipt
import {
  adminClient, bytesToBase64, button, cors, emailLayout, esc, json, orderLink, sendEmail,
} from "../_shared/common.ts";

// Also attach / send the PDF to customers who ordered a printed copy.
const PDF_WITH_PRINT = (Deno.env.get("PDF_WITH_PRINT") ?? "true") === "true";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = adminClient();

  // --- who is calling? -------------------------------------------------------
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(jwt);
  const callerEmail = auth?.user?.email?.toLowerCase();
  if (!callerEmail) return json({ error: "Not signed in" }, 401);
  const { data: admin } = await db.from("shop_admins").select("email").ilike("email", callerEmail).maybeSingle();
  if (!admin) return json({ error: "Not an admin" }, 403);

  let body: { action?: string; id?: string; reason?: string; fee?: number; print_status?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const { action, id } = body;
  if (!id) return json({ error: "Missing order id" }, 400);

  const { data: o } = await db.from("orders").select("*, products(name, pdf_path)").eq("id", id).maybeSingle();
  if (!o) return json({ error: "Order not found" }, 404);
  const ar = o.lang === "ar";
  const link = orderLink(o.id, o.access_token, o.lang);

  async function sendPdfEmail() {
    const wantsPdf = o.format === "pdf" || PDF_WITH_PRINT;
    let attachments: { filename: string; content: string }[] = [];
    if (wantsPdf) {
      const { data: file, error } = await db.storage.from("products").download(o.products.pdf_path);
      if (error || !file) throw new Error("PDF file missing in storage bucket 'products'");
      attachments = [{ filename: "ZK-Eat-Well-4-Week-Recipe-Plan.pdf", content: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }];
    }
    const printLine = o.format === "print"
      ? (ar ? `<p>بخصوص النسخة المطبوعة: هنتواصل معاك على واتساب (${esc(o.whatsapp)}) بتكلفة الطباعة والشحن لعنوانك.</p>`
            : `<p>About your printed copy: we'll message you on WhatsApp (${esc(o.whatsapp)}) with the printing + shipping cost to your address.</p>`)
      : "";
    const html = ar
      ? emailLayout(`<h2 style="margin:0 0 12px">تم تأكيد الدفع 🎉</h2>
        <p>أهلاً ${esc(o.customer_name)}، الدفع لطلب رقم #${o.order_no} اتأكد.</p>
        ${wantsPdf ? `<p>ملف <b>Eat Well — كتيب الـ 4 أسابيع</b> مرفق في الإيميل ده. وتقدر كمان تنزله في أي وقت من صفحة الطلب:</p>${button(link, "تحميل الـ PDF")}` : ""}
        ${printLine}<p>بالهنا والشفا، كُل صح. 🧡<br>كوتش بيجزي</p>`, true)
      : emailLayout(`<h2 style="margin:0 0 12px">Payment confirmed 🎉</h2>
        <p>Hi ${esc(o.customer_name)}, your payment for order #${o.order_no} is confirmed.</p>
        ${wantsPdf ? `<p>Your copy of <b>Eat Well — The 4-Week Recipe Plan</b> is attached to this email. You can also download it any time from your order page:</p>${button(link, "Download your PDF")}` : ""}
        ${printLine}<p>Move right, eat well. 🧡<br>Coach Bigzee</p>`);
    await sendEmail(o.email, ar ? `تم تأكيد طلبك #${o.order_no} — Eat Well` : `Your Eat Well book is here — order #${o.order_no}`, html, attachments);
  }

  switch (action) {
    case "confirm":
    case "resend": {
      if (action === "confirm") {
        const { error } = await db.from("orders")
          .update({ status: "paid", confirmed_at: new Date().toISOString(), reject_reason: null }).eq("id", id);
        if (error) return json({ error: error.message }, 500);
      } else if (o.status !== "paid") {
        return json({ error: "Order is not confirmed yet" }, 400);
      }
      try {
        await sendPdfEmail();
        await db.from("orders").update({ email_sent_at: new Date().toISOString(), email_error: null }).eq("id", id);
        return json({ ok: true, emailed: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.from("orders").update({ email_error: msg.slice(0, 500) }).eq("id", id);
        // Payment is still confirmed: the customer can download from their order page.
        return json({ ok: true, emailed: false, email_error: msg });
      }
    }

    case "reject": {
      const reason = String(body.reason ?? "").slice(0, 300);
      await db.from("orders").update({ status: "rejected", reject_reason: reason || null }).eq("id", id);
      const html = ar
        ? emailLayout(`<h2 style="margin:0 0 12px">محتاجين نراجع الدفع</h2>
          <p>أهلاً ${esc(o.customer_name)}، ماقدرناش نأكد الدفع لطلب رقم #${o.order_no}.</p>
          ${reason ? `<p>السبب: ${esc(reason)}</p>` : ""}<p>لو شايف إن ده غلط، رد على الإيميل ده أو ابعتلنا على واتساب ومعاك الإيصال.</p>`, true)
        : emailLayout(`<h2 style="margin:0 0 12px">We couldn't confirm your payment</h2>
          <p>Hi ${esc(o.customer_name)}, we weren't able to confirm the payment for order #${o.order_no}.</p>
          ${reason ? `<p>Reason: ${esc(reason)}</p>` : ""}<p>If you think this is a mistake, just reply to this email with your receipt and we'll sort it out.</p>`);
      const r = await sendEmail(o.email, ar ? `بخصوص طلبك #${o.order_no}` : `About your order #${o.order_no}`, html)
        .then(() => true, () => false);
      return json({ ok: true, emailed: r });
    }

    case "print_fee": {
      const fee = Math.round(Number(body.fee));
      if (!(fee >= 0 && fee < 100000)) return json({ error: "Invalid fee" }, 400);
      await db.from("orders").update({ print_fee_egp: fee, print_status: "quote_sent" }).eq("id", id);
      return json({ ok: true });
    }

    case "print_status": {
      if (!["awaiting_quote", "quote_sent", "fee_paid", "shipped"].includes(String(body.print_status))) {
        return json({ error: "Invalid print status" }, 400);
      }
      await db.from("orders").update({ print_status: body.print_status }).eq("id", id);
      return json({ ok: true });
    }

    case "receipt_url": {
      const { data, error } = await db.storage.from("receipts").createSignedUrl(o.receipt_path, 600);
      if (error || !data) return json({ error: "Receipt not found" }, 404);
      return json({ ok: true, url: data.signedUrl });
    }

    default:
      return json({ error: "Unknown action" }, 400);
  }
});
