// ZK Shop configuration — the only file you need to edit after setting up Supabase.
// (The anon/publishable key is safe to be public: the database rules protect the data.)
window.ZK_SHOP = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-SUPABASE-ANON-OR-PUBLISHABLE-KEY',

  INSTAPAY_URL: 'https://ipn.eg/S/bigzee/instapay/03EiLL',
  WHATSAPP_ADMIN: '',            // optional: your WhatsApp number in international format, e.g. 2010xxxxxxxx

  // Display fallback only — the real price is decided by the database (products table)
  PRODUCT: {
    id: 'eat-well',
    price_egp: 1500,
    offer_egp: 1200,
    offer_starts: '2026-11-13T00:00:00+02:00',
    offer_ends: '2026-11-23T00:00:00+02:00'
  }
};

window.ZK_SHOP.fn = function (name) {
  return window.ZK_SHOP.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/' + name;
};
window.ZK_SHOP.headers = function (extra) {
  var k = window.ZK_SHOP.SUPABASE_ANON_KEY;
  var h = { apikey: k };
  if (/^eyJ/.test(k)) h.Authorization = 'Bearer ' + k;   // legacy JWT anon key
  return Object.assign(h, extra || {});
};
window.ZK_SHOP.configured = function () {
  return !/YOUR-PROJECT-REF/.test(window.ZK_SHOP.SUPABASE_URL);
};
