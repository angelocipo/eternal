// Vercel serverless function — /api/reviews
// Product reviews from verified buyers only. One file on purpose (Vercel Hobby allows 12 functions).
//
//   GET  /api/reviews?slug=<product>        → approved reviews for a product page (public)
//   GET  /api/reviews?session_id=cs_...     → what the review page needs (product, buyer first name)
//   POST /api/reviews  {session_id, rating, title, text, name}  → new review, saved as PENDING
//   GET  /api/reviews?mod=<id>&do=approve|delete&sig=…  → confirmation page for the shop owner
//   POST /api/reviews  mod=<id>&do=…&sig=…  (form)      → approves or deletes
//   GET  /api/reviews?cron=1  (via /api/review-cron)    → sends the review invites that are due
//
// Who can write a review: only someone holding the Stripe session id of a PAID order. That id is
// in the invite email (and the thank-you page URL); it is long and not guessable — the same model
// /api/order-summary already uses. One review per order. Nothing is published until the owner
// clicks "Approve" in the notification email.
//
// Storage: Upstash Redis (Vercel Marketplace → Upstash → Redis, connect to this project). The
// integration sets KV_REST_API_URL + KV_REST_API_TOKEN; UPSTASH_REDIS_REST_URL/TOKEN also work.
// Without it, product pages simply show no reviews and the form answers "not available".
//
// Env: REVIEW_INVITE_DAYS (default 14) is read by stripe-webhook.js. REVIEW_SECRET (optional)
// signs the moderation links; if unset, STRIPE_SECRET_KEY is used as the signing key.
// CRON_SECRET (optional): when set, the invite job only runs when Vercel Cron calls it.

const crypto = require('crypto');
const Stripe = require('stripe');
const PRODUCTS = require('../data/products.json');

const SITE = 'https://www.eternalcity.jewelry';
const OWNER_EMAIL = process.env.OWNER_NOTIFICATION_EMAIL || 'info@eternalcity.jewelry';
const products = Array.isArray(PRODUCTS) ? PRODUCTS : Object.values(PRODUCTS);

// ---------------------------------------------------------------- Redis (Upstash REST)
function redisConf() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
async function redis(cmds) {
  const c = redisConf();
  if (!c) throw new Error('Reviews storage not configured');
  const r = await fetch(c.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Redis ' + r.status + ' ' + (await r.text()));
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error('Redis: ' + x.error);
    return x.result;
  });
}
const K = {
  review: (id) => 'rev:' + id,
  pending: 'rev:pending',
  product: (slug) => 'rev:p:' + slug,
  invites: 'rev:invites',
  invited: (id) => 'rev:invited:' + id,
};

// ---------------------------------------------------------------- Email (Resend), inlined
const VERIFIED_DOMAIN = 'eternalcity.jewelry';
function safeFrom() {
  const raw = (process.env.RESEND_FROM || '').trim();
  const addr = (raw.match(/<([^>]+)>/) || [null, raw])[1] || '';
  if (addr.toLowerCase().endsWith('@' + VERIFIED_DOMAIN)) return raw;
  return `Eternal City Jewelry <info@${VERIFIED_DOMAIN}>`;
}
async function sendEmail({ to, subject, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: safeFrom(), to, subject, html }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Resend send failed: ${r.status} ${text}`);
  return text;
}

// ---------------------------------------------------------------- helpers
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}
function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
function sig(id, action) {
  const key = process.env.REVIEW_SECRET || process.env.STRIPE_SECRET_KEY || '';
  return crypto.createHmac('sha256', key).update(id + ':' + action).digest('hex').slice(0, 32);
}
function sigOk(id, action, given) {
  const a = Buffer.from(sig(id, action));
  const b = Buffer.from(String(given || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validSession(id) { return /^cs_[A-Za-z0-9_]{10,200}$/.test(String(id || '')); }
function displayName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.' : parts[0];
}

// The order's product: metadata.product_slug (orders placed after reviews went live), otherwise
// the longest product name the Stripe line item starts with (older orders).
function productForSession(s) {
  const md = s.metadata || {};
  if (md.product_slug) {
    const p = products.find((x) => x.slug === md.product_slug);
    if (p) return p;
  }
  const desc = String((((s.line_items || {}).data || [])[0] || {}).description || '').toLowerCase();
  let best = null;
  for (const p of products) {
    const n = String(p.name || '').toLowerCase();
    if (n && desc.startsWith(n) && (!best || n.length > best.name.length)) best = p;
  }
  return best;
}
let stripeClient = null;
async function paidSession(id) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured');
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  const s = await stripeClient.checkout.sessions.retrieve(id, { expand: ['line_items'] });
  return s.payment_status === 'paid' ? s : null;
}

// ---------------------------------------------------------------- email templates
const BG = '#f4f1ea', PAPER = '#ffffff', INK = '#1b1711', GOLD = '#a8834f', DARK = '#15120d', ON_DARK = '#d4b572', RULE = '#e4ddd0', MUTED = '#6f6a5e';
const HEAD_FONT = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const BODY_FONT = "Jost,'Helvetica Neue',Helvetica,Arial,sans-serif";
function shell(title, inner) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:' + BG + ';"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + BG + ';padding:32px 16px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:' + PAPER + ';border:1px solid ' + RULE + ';">' +
    '<tr><td style="background:' + DARK + ';padding:28px 32px;text-align:center;"><div style="font:500 11px/1 ' + BODY_FONT + ';letter-spacing:.32em;text-transform:uppercase;color:' + ON_DARK + ';">Eternal City Jewelry</div>' +
    '<div style="font:500 30px/1.15 ' + HEAD_FONT + ';color:#efe9dc;padding-top:12px;">' + title + '</div></td></tr>' + inner +
    '<tr><td style="padding:24px 32px 28px;"><div style="border-top:1px solid ' + RULE + ';padding-top:16px;font:400 12px/1.6 ' + BODY_FONT + ';color:' + MUTED + ';text-align:center;">Eternal City Jewelry · Made in Rome, worn forever · <a href="' + SITE + '" style="color:' + GOLD + ';text-decoration:none;">eternalcity.jewelry</a></div></td></tr>' +
    '</table></td></tr></table></body></html>';
}
function button(href, label) {
  return '<a href="' + href + '" style="display:inline-block;background:' + DARK + ';color:#efe9dc;font:500 13px/1 ' + BODY_FONT + ';letter-spacing:.18em;text-transform:uppercase;text-decoration:none;padding:16px 26px;">' + label + '</a>';
}
function inviteEmail(name, product, link) {
  return shell('How is your piece?',
    '<tr><td style="padding:28px 32px 0;font:400 16px/1.7 ' + BODY_FONT + ';color:' + INK + ';">Dear ' + esc(name || 'customer') + ',<br><br>' +
    'your <strong>' + esc(product) + '</strong> left our Roman atelier a little while ago. We would love to know how it feels on the wrist. ' +
    'A few honest lines help other people choose their stone — and help us do better.</td></tr>' +
    '<tr><td style="padding:26px 32px 0;" align="center">' + button(link, 'Write a review') + '</td></tr>' +
    '<tr><td style="padding:22px 32px 0;font:400 13px/1.7 ' + BODY_FONT + ';color:' + MUTED + ';">It takes a minute. We publish every genuine review, positive or negative, under your first name and initial. ' +
    'This is the only email we send about it: if you prefer not to review, simply ignore it. Something wrong with your order? Reply to this email and we will sort it out.</td></tr>');
}
function ownerEmail(rev, product) {
  const a = `${SITE}/api/reviews?mod=${encodeURIComponent(rev.id)}&do=approve&sig=${sig(rev.id, 'approve')}`;
  const d = `${SITE}/api/reviews?mod=${encodeURIComponent(rev.id)}&do=delete&sig=${sig(rev.id, 'delete')}`;
  return shell('Nuova recensione',
    '<tr><td style="padding:28px 32px 0;font:400 15px/1.7 ' + BODY_FONT + ';color:' + INK + ';">' +
    '<div style="font:500 11px/1 ' + BODY_FONT + ';letter-spacing:.16em;text-transform:uppercase;color:' + MUTED + ';">' + esc(product) + '</div>' +
    '<div style="font-size:22px;color:' + GOLD + ';padding:12px 0 4px;">' + stars(rev.rating) + '</div>' +
    (rev.title ? '<div style="font:500 22px/1.3 ' + HEAD_FONT + ';">' + esc(rev.title) + '</div>' : '') +
    '<div style="white-space:pre-line;padding-top:8px;">' + esc(rev.text) + '</div>' +
    '<div style="padding-top:12px;color:' + MUTED + ';font-size:13px;">— ' + esc(rev.name) + ' · acquirente verificato · ' + esc(rev.email || '') + '</div></td></tr>' +
    '<tr><td style="padding:26px 32px 0;">' + button(a, 'Pubblica') + ' &nbsp; <a href="' + d + '" style="font:400 13px/1 ' + BODY_FONT + ';color:' + MUTED + ';">Elimina</a></td></tr>' +
    '<tr><td style="padding:18px 32px 0;font:400 12px/1.6 ' + BODY_FONT + ';color:' + MUTED + ';">Finché non la pubblichi, la recensione non compare sul sito. Per correttezza verso i clienti (e per legge) vanno pubblicate anche le recensioni negative: elimina solo quelle offensive, fuori tema o con dati personali.</td></tr>');
}
function page(title, body) {
  return '<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + esc(title) + '</title></head>' +
    '<body style="margin:0;background:#0e1524;color:#eef0f4;font-family:Jost,Helvetica,Arial,sans-serif;"><div style="max-width:620px;margin:0 auto;padding:56px 24px;line-height:1.6;">' +
    '<div style="font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#a3abba;">Eternal City Jewelry · recensioni</div>' +
    '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:32px;margin:14px 0 22px;">' + esc(title) + '</h1>' + body + '</div></body></html>';
}

// ---------------------------------------------------------------- handlers
async function listForProduct(req, res) {
  const slug = clean(req.query.slug, 200);
  if (!redisConf()) { res.status(200).json({ count: 0, average: 0, reviews: [] }); return; }
  const [ids] = await redis([['ZREVRANGE', K.product(slug), '0', '199']]);
  let list = [];
  if (ids && ids.length) {
    const [raw] = await redis([['MGET', ...ids.map(K.review)]]);
    list = raw.filter(Boolean).map((s) => JSON.parse(s)).filter((r) => r.status === 'approved');
  }
  const count = list.length;
  const average = count ? Math.round((list.reduce((a, r) => a + r.rating, 0) / count) * 10) / 10 : 0;
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  res.status(200).json({
    count, average,
    reviews: list.map((r) => ({ name: r.name, rating: r.rating, title: r.title, text: r.text, date: r.approvedAt || r.createdAt, verified: true })),
  });
}

async function sessionInfo(req, res) {
  const id = String(req.query.session_id);
  res.setHeader('Cache-Control', 'no-store');
  if (!validSession(id)) { res.status(400).json({ error: 'invalid' }); return; }
  if (!redisConf()) { res.status(503).json({ error: 'unavailable' }); return; }
  const s = await paidSession(id).catch(() => null);
  if (!s) { res.status(404).json({ error: 'not_found' }); return; }
  const p = productForSession(s);
  if (!p) { res.status(404).json({ error: 'no_product' }); return; }
  const [existing] = await redis([['EXISTS', K.review(id)]]);
  const md = s.metadata || {};
  res.status(200).json({ slug: p.slug, productName: p.name, name: displayName(md.inv_name || (s.customer_details || {}).name), already: !!existing });
}

async function submit(req, res) {
  const b = req.body || {};
  const id = String(b.session_id || '');
  if (!validSession(id)) { res.status(400).json({ error: 'invalid' }); return; }
  const rating = parseInt(b.rating, 10);
  const text = clean(b.text, 2000);
  const title = clean(b.title, 90);
  const name = clean(b.name, 40);
  if (!(rating >= 1 && rating <= 5)) { res.status(400).json({ error: 'rating' }); return; }
  if (text.length < 20) { res.status(400).json({ error: 'text' }); return; }
  if (!name) { res.status(400).json({ error: 'name' }); return; }
  if (!redisConf()) { res.status(503).json({ error: 'unavailable' }); return; }
  const s = await paidSession(id).catch(() => null);
  if (!s) { res.status(404).json({ error: 'not_found' }); return; }
  const p = productForSession(s);
  if (!p) { res.status(404).json({ error: 'no_product' }); return; }
  const md = s.metadata || {};
  const rev = {
    id, slug: p.slug, rating, title, text, name,
    email: md.inv_email || (s.customer_details || {}).email || '',
    status: 'pending', createdAt: new Date().toISOString(),
  };
  // NX: one review per order, a second submit (double click, reload) cannot overwrite the first.
  const [ok] = await redis([['SET', K.review(id), JSON.stringify(rev), 'NX']]);
  if (ok !== 'OK') { res.status(409).json({ error: 'already' }); return; }
  await redis([['ZADD', K.pending, String(Date.now()), id], ['ZREM', K.invites, id]]);
  try {
    await sendEmail({ to: OWNER_EMAIL, subject: `Nuova recensione ${stars(rating)} — ${p.name}`, html: ownerEmail(rev, p.name) });
  } catch (e) { console.error('Review notification failed', e); }
  res.status(200).json({ ok: true });
}

async function moderatePage(req, res) {
  const id = String(req.query.mod || ''), action = String(req.query.do || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!['approve', 'delete'].includes(action) || !sigOk(id, action, req.query.sig)) { res.status(403).send(page('Link non valido', '<p>Il link non è valido o è stato modificato.</p>')); return; }
  const [raw] = await redis([['GET', K.review(id)]]);
  if (!raw) { res.status(404).send(page('Recensione non trovata', '<p>Questa recensione è già stata eliminata.</p>')); return; }
  const r = JSON.parse(raw);
  const p = products.find((x) => x.slug === r.slug);
  // A real button (POST), not an action on GET: mail scanners open links in emails by themselves.
  const label = action === 'approve' ? 'Pubblica sul sito' : 'Elimina definitivamente';
  res.status(200).send(page(action === 'approve' ? 'Pubblicare questa recensione?' : 'Eliminare questa recensione?',
    '<p style="color:#a3abba;margin:0;">' + esc(p ? p.name : r.slug) + ' · stato: ' + (r.status === 'approved' ? 'pubblicata' : 'in attesa') + '</p>' +
    '<p style="font-size:22px;color:#cfd3da;margin:14px 0 4px;">' + stars(r.rating) + '</p>' +
    (r.title ? '<p style="font-family:Georgia,serif;font-size:21px;margin:0;">' + esc(r.title) + '</p>' : '') +
    '<p style="white-space:pre-line;color:#bcc2cd;">' + esc(r.text) + '</p><p style="color:#a3abba;">— ' + esc(r.name) + '</p>' +
    '<form method="POST" action="/api/reviews" style="margin-top:28px;"><input type="hidden" name="mod" value="' + esc(id) + '"><input type="hidden" name="do" value="' + esc(action) + '"><input type="hidden" name="sig" value="' + esc(req.query.sig) + '">' +
    '<button type="submit" style="background:#cfd3da;color:#0e1524;border:0;padding:16px 28px;font-size:14px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;">' + label + '</button></form>'));
}

async function moderate(req, res) {
  const b = req.body || {};
  const id = String(b.mod || ''), action = String(b.do || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!['approve', 'delete'].includes(action) || !sigOk(id, action, b.sig)) { res.status(403).send(page('Link non valido', '<p>Il link non è valido.</p>')); return; }
  const [raw] = await redis([['GET', K.review(id)]]);
  if (!raw) { res.status(404).send(page('Recensione non trovata', '<p>Già eliminata.</p>')); return; }
  const r = JSON.parse(raw);
  if (action === 'approve') {
    r.status = 'approved';
    r.approvedAt = r.approvedAt || new Date().toISOString();
    await redis([['SET', K.review(id), JSON.stringify(r)], ['ZREM', K.pending, id], ['ZADD', K.product(r.slug), String(Date.parse(r.createdAt) || Date.now()), id]]);
    res.status(200).send(page('Recensione pubblicata', `<p>È visibile sulla pagina del prodotto entro un paio di minuti.</p><p><a style="color:#cfd3da;" href="${SITE}/bracelets/${encodeURIComponent(r.slug)}">Apri il prodotto</a></p>`));
  } else {
    // The order keeps its "already reviewed" mark, so the same link cannot be used to post again.
    const tomb = { id, slug: r.slug, status: 'deleted', createdAt: r.createdAt };
    await redis([['SET', K.review(id), JSON.stringify(tomb)], ['ZREM', K.pending, id], ['ZREM', K.product(r.slug), id]]);
    res.status(200).send(page('Recensione eliminata', '<p>Non compare più sul sito.</p>'));
  }
}

async function sendDueInvites(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) { res.status(401).end(); return; }
  if (!redisConf()) { res.status(200).json({ sent: 0, note: 'storage not configured' }); return; }
  const [due] = await redis([['ZRANGEBYSCORE', K.invites, '0', String(Date.now()), 'LIMIT', '0', '25']]);
  let sent = 0;
  for (const id of due || []) {
    try {
      // Claim first: a second run (or a retry) can never email the same buyer twice.
      const [claim] = await redis([['SET', K.invited(id), '1', 'NX', 'EX', String(400 * 86400)]]);
      await redis([['ZREM', K.invites, id]]);
      if (claim !== 'OK') continue;
      const [existing] = await redis([['EXISTS', K.review(id)]]);
      if (existing) continue;
      const s = await paidSession(id);
      if (!s || s.status === 'expired') continue;
      const p = productForSession(s);
      const md = s.metadata || {};
      const email = md.inv_email || (s.customer_details || {}).email;
      if (!p || !email) continue;
      const first = String(md.inv_name || (s.customer_details || {}).name || '').trim().split(/\s+/)[0];
      await sendEmail({ to: email, subject: `How is your ${p.name}?`, html: inviteEmail(first, p.name, `${SITE}/review.html?session_id=${encodeURIComponent(id)}`) });
      sent++;
    } catch (e) { console.error('Review invite failed for', id, e); }
  }
  res.status(200).json({ sent, checked: (due || []).length });
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    if (req.method === 'GET') {
      if (q.cron) return await sendDueInvites(req, res);
      if (q.mod) return await moderatePage(req, res);
      if (q.session_id) return await sessionInfo(req, res);
      if (q.slug) return await listForProduct(req, res);
      res.status(400).json({ error: 'missing parameter' });
      return;
    }
    if (req.method === 'POST') {
      if ((req.body || {}).mod) return await moderate(req, res);
      return await submit(req, res);
    }
    res.status(405).end();
  } catch (e) {
    console.error('reviews failed', e);
    if (!res.headersSent) res.status(500).json({ error: 'server' });
  }
};
