// Shared helpers for the ZK shop Edge Functions.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://zeinakassas.fit").replace(/\/$/, "");
export const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Coach Bigzee <orders@zeinakassas.fit>";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Service-role client: bypasses RLS. Only ever used inside Edge Functions. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export function orderLink(id: string, token: string, lang = "en") {
  return `${SITE_URL}/order.html?id=${id}&t=${token}${lang === "ar" ? "&lang=ar" : ""}`;
}

export function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

export type Attachment = { filename: string; content: string /* base64 */ };

export async function sendEmail(to: string, subject: string, html: string, attachments: Attachment[] = []) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], reply_to: ADMIN_EMAIL || undefined, subject, html, attachments }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${await res.text()}`);
}

export function bytesToBase64(bytes: Uint8Array) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Simple branded email wrapper (works in Gmail / Outlook / phone mail apps). */
export function emailLayout(inner: string, rtl = false) {
  return `<!doctype html><html><body style="margin:0;background:#0B0F18;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="100%" style="max-width:560px;background:#F4F5F2;border-radius:4px;" cellpadding="0" cellspacing="0" dir="${rtl ? "rtl" : "ltr"}">
    <tr><td style="background:#10141F;padding:22px 28px;color:#F4F5F2;font-size:13px;letter-spacing:3px;font-weight:bold;">
      ZK &nbsp;<span style="color:#FF4E1E">MOVE RIGHT · EAT WELL</span></td></tr>
    <tr><td style="padding:30px 28px;color:#10141F;font-size:15px;line-height:1.6;text-align:${rtl ? "right" : "left"};">${inner}</td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #ddd;color:#777;font-size:12px;text-align:${rtl ? "right" : "left"};">
      Coach Bigzee — Zeina Kassas · <a href="${SITE_URL}" style="color:#FF4E1E">zeinakassas.fit</a> · Instagram @coachbigzee</td></tr>
  </table></td></tr></table></body></html>`;
}

export function button(href: string, label: string) {
  return `<p style="margin:26px 0;"><a href="${href}" style="background:#FF4E1E;color:#fff;text-decoration:none;padding:14px 26px;border-radius:2px;font-weight:bold;display:inline-block;">${label}</a></p>`;
}
