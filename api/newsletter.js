// Vercel serverless function — /api/newsletter
// Newsletter subscriber list for Eternal City Jewelry, with double opt-in (GDPR).
//
//   POST /api/newsletter  {email, lang, source, company}  → saves PENDING, emails a confirm link
//   GET  /api/newsletter?confirm=<email>&s=<sig>           → page with a "Confirm" button
//   POST /api/newsletter  confirm=<email>&s=<sig> (form)   → CONFIRMED, owner gets a notice
//   GET  /api/newsletter?unsubscribe=<email>&s=<sig>       → page with an "Unsubscribe" button
//   POST /api/newsletter  unsubscribe=<email>&s=<sig>      → removed from the list (also RFC 8058 one-click)
//   GET  /api/newsletter?admin=list&s=<sig>                → the owner's list (HTML table)
//   GET  /api/newsletter?admin=list&s=<sig>&format=csv     → same list as a CSV download
//   POST /api/newsletter  admin=delete&email=…&s=<sig>     → owner deletes one address
//   GET  /api/newsletter?admin=preview&id=<issue>&s=<sig>  → the issue as it will look in the inbox
//   POST /api/newsletter  admin=test&id=<issue>&s=<sig>    → sends the issue to the owner only
//   POST /api/newsletter  admin=send&id=<issue>&s=<sig>    → sends the issue to every CONFIRMED subscriber
//
// Issues live in data/newsletters.json (one per week, images only, no video). Nothing is ever
// sent automatically: the owner presses "Send to all" on the list page. Each issue can be sent
// to the list only once (nl:issue:<id> in Redis records when and to how many).
//
// Buttons (not plain links) on confirm/unsubscribe pages: mail scanners open every link in an
// email, and would otherwise confirm or unsubscribe people on their own.
//
// The owner's list link is never shown on the site: it arrives in the notification email sent
// to OWNER_NOTIFICATION_EMAIL each time someone confirms. Links are HMAC-signed with
// NEWSLETTER_SECRET, or REVIEW_SECRET, or STRIPE_SECRET_KEY (first one set).
//
// Storage: the same Upstash Redis already used by reviews (KV_REST_API_URL + KV_REST_API_TOKEN).
//   nl:s:<email>  JSON {email, status, lang, source, created, confirmed}; pending ones expire in 30 days
//   nl:all        sorted set of emails by signup time
//   nl:rl:<ip>    signup attempts per hour (rate limit, expires)

const crypto = require('crypto');
let ISSUES = [];
try { ISSUES = require('../data/newsletters.json'); } catch (e) { ISSUES = []; }

const SITE = 'https://www.eternalcity.jewelry';
const OWNER_EMAIL = process.env.OWNER_NOTIFICATION_EMAIL || 'info@eternalcity.jewelry';
const MAX_PER_HOUR = 5;

// ---------------------------------------------------------------- Redis (Upstash REST)
function redisConf() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
async function redis(cmds) {
  const c = redisConf();
  if (!c) throw new Error('Newsletter storage not configured');
  const r = await fetch(c.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Redis ' + r.status + ' ' + (await r.text()));
  return (await r.json()).map((x) => {
    if (x.error) throw new Error('Redis: ' + x.error);
    return x.result;
  });
}
const K = { sub: (e) => 'nl:s:' + e, all: 'nl:all', rl: (ip) => 'nl:rl:' + ip, issue: (id) => 'nl:issue:' + id };

// ---------------------------------------------------------------- Email (Resend)
const VERIFIED_DOMAIN = 'eternalcity.jewelry';
function safeFrom() {
  const raw = (process.env.RESEND_FROM || '').trim();
  const addr = (raw.match(/<([^>]+)>/) || [null, raw])[1] || '';
  if (addr.toLowerCase().endsWith('@' + VERIFIED_DOMAIN)) return raw;
  return `Eternal City Jewelry <info@${VERIFIED_DOMAIN}>`;
}
async function sendEmail({ to, subject, html, headers }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: safeFrom(), to, subject, html, ...(headers ? { headers } : {}) }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Resend send failed: ${r.status} ${text}`);
  return text;
}

// ---------------------------------------------------------------- helpers
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function normEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(e) ? e : '';
}
function sig(id, action) {
  const key = process.env.NEWSLETTER_SECRET || process.env.REVIEW_SECRET || process.env.STRIPE_SECRET_KEY || '';
  if (!key) throw new Error('No signing key configured');
  return crypto.createHmac('sha256', key).update('nl:' + id + ':' + action).digest('hex').slice(0, 32);
}
function sigOk(id, action, given) {
  let want;
  try { want = Buffer.from(sig(id, action)); } catch (e) { return false; }
  const got = Buffer.from(String(given || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
function link(action, email) {
  return `${SITE}/api/newsletter?${action}=${encodeURIComponent(email)}&s=${sig(email, action)}`;
}
function adminLink(format) {
  return `${SITE}/api/newsletter?admin=list&s=${sig('owner', 'list')}${format ? '&format=' + format : ''}`;
}
function clientIp(req) {
  return String(req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim().slice(0, 64);
}
function fmtDate(t) {
  return t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : '';
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) raw = await new Promise((res) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); }); req.on('end', () => res(d)); req.on('error', () => res('')); });
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json')) { try { return JSON.parse(raw || '{}'); } catch (e) { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}
async function getSub(email) {
  const [v] = await redis([['GET', K.sub(email)]]);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

// ---------------------------------------------------------------- pages & emails
const T = {
  en: {
    confirmSubject: 'Confirm your subscription to Eternal City Jewelry',
    confirmIntro: 'Thank you for joining our newsletter. Please confirm your email address by clicking the button below.',
    confirmBtn: 'Confirm subscription',
    confirmIgnore: 'If you did not ask for this, simply ignore this email: you will not be added.',
    pageConfirm: 'Confirm your subscription',
    pageConfirmText: 'Click the button to confirm that you want to receive the Eternal City Jewelry newsletter at',
    pageDone: 'You are subscribed',
    pageDoneText: 'Thank you. You will hear from us when new pieces and journal stories are ready. Every email has a link to unsubscribe.',
    pageUnsub: 'Unsubscribe',
    pageUnsubText: 'Click the button to stop receiving the newsletter at',
    pageUnsubDone: 'You are unsubscribed',
    pageUnsubDoneText: 'Your address has been removed from our list. You will not receive the newsletter any more.',
    bad: 'This link is not valid or has expired.',
    back: 'Back to the shop',
  },
  it: {
    confirmSubject: 'Conferma l’iscrizione a Eternal City Jewelry',
    confirmIntro: 'Grazie per esserti iscritto alla nostra newsletter. Conferma il tuo indirizzo email con il pulsante qui sotto.',
    confirmBtn: 'Conferma iscrizione',
    confirmIgnore: 'Se non hai chiesto tu l’iscrizione, ignora questa email: non verrai aggiunto.',
    pageConfirm: 'Conferma l’iscrizione',
    pageConfirmText: 'Clicca il pulsante per confermare che vuoi ricevere la newsletter di Eternal City Jewelry a',
    pageDone: 'Iscrizione confermata',
    pageDoneText: 'Grazie. Ti scriveremo quando saranno pronti nuovi gioielli e nuove storie del diario. Ogni email contiene il link per disiscriverti.',
    pageUnsub: 'Disiscriviti',
    pageUnsubText: 'Clicca il pulsante per non ricevere più la newsletter a',
    pageUnsubDone: 'Disiscrizione completata',
    pageUnsubDoneText: 'Il tuo indirizzo è stato rimosso dalla lista. Non riceverai più la newsletter.',
    bad: 'Questo link non è valido o è scaduto.',
    back: 'Torna al negozio',
  },
};
function tr(lang) { return T[lang === 'it' ? 'it' : 'en']; }

function page(res, status, title, bodyHtml, lang) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(`<!doctype html><html lang="${lang === 'it' ? 'it' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} — Eternal City Jewelry</title>
<link rel="stylesheet" href="/fonts/fonts.css"><style>
body{margin:0;background:#0e1524;color:#eef0f4;font-family:Jost,'Helvetica Neue',Arial,sans-serif;line-height:1.6;}
.w{max-width:640px;margin:0 auto;padding:70px 22px;text-align:center;}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:40px;line-height:1.1;margin:22px 0 14px;}
p{color:#bcc2cd;font-weight:300;}
button,.b{display:inline-block;cursor:pointer;border:none;background:#cfd3da;color:#0e1524;font-family:inherit;font-size:11px;letter-spacing:.24em;text-transform:uppercase;padding:15px 34px;border-radius:2px;text-decoration:none;margin-top:14px;}
a{color:#cfd3da;}
.d{width:6px;height:6px;background:#d06f2b;transform:rotate(45deg);margin:0 auto;}
table{width:100%;border-collapse:collapse;font-size:13px;text-align:left;margin-top:24px;}
th,td{padding:8px 6px;border-bottom:1px solid rgba(185,190,200,.18);}
th{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#a3abba;font-weight:500;}
td button{margin:0;padding:6px 10px;font-size:9.5px;background:transparent;color:#d06f2b;border:1px solid rgba(208,111,43,.5);}
</style></head><body><div class="w">
<a href="/"><img src="/img/logo-ecj-stacked.png" alt="Eternal City Jewelry" style="width:160px;height:auto;"></a>
<div class="d" style="margin-top:18px;"></div>${bodyHtml}</div></body></html>`);
}

function confirmEmail(email, lang) {
  const t = tr(lang);
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Helvetica,Arial,sans-serif;color:#1b1711;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4ddd0;">
<tr><td style="background:#0e1524;padding:26px;text-align:center;"><img src="${SITE}/img/logo-ecj-stacked.png" alt="Eternal City Jewelry" width="150" style="display:block;margin:0 auto;width:150px;height:auto;"></td></tr>
<tr><td style="padding:34px 32px 10px;font-size:15px;line-height:1.7;">${esc(t.confirmIntro)}</td></tr>
<tr><td align="center" style="padding:18px 32px 26px;"><a href="${link('confirm', email)}&l=${lang === 'it' ? 'it' : 'en'}" style="display:inline-block;background:#0e1524;color:#ffffff;text-decoration:none;font-size:12px;letter-spacing:.2em;text-transform:uppercase;padding:15px 30px;">${esc(t.confirmBtn)}</a></td></tr>
<tr><td style="padding:0 32px 32px;font-size:12.5px;line-height:1.6;color:#6f6a5e;">${esc(t.confirmIgnore)}</td></tr>
</table></td></tr></table></body></html>`;
}

function ownerEmail(sub, total) {
  return `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1b1711;font-size:14px;line-height:1.6;">
<p>New newsletter subscriber confirmed:</p>
<p><strong>${esc(sub.email)}</strong><br>Language: ${esc(sub.lang)} · From page: ${esc(sub.source || '-')}</p>
<p>Confirmed subscribers now: <strong>${total}</strong></p>
<p><a href="${adminLink()}">Open the subscriber list</a> · <a href="${adminLink('csv')}">Download CSV</a></p>
<p style="color:#6f6a5e;font-size:12px;">Keep these links private: anyone with them can see the list.</p>
</body></html>`;
}

// ---------------------------------------------------------------- actions
async function subscribe(req, res, body) {
  // Honeypot: a hidden "company" field real people never fill in.
  if (body.company) return res.status(200).json({ ok: true });
  const email = normEmail(body.email);
  if (!email) return res.status(400).json({ ok: false, error: 'invalid_email' });
  const lang = body.lang === 'it' ? 'it' : 'en';
  const source = String(body.source || '').replace(/[^\w\-./?=&%#]/g, '').slice(0, 120);

  const [count] = await redis([['INCR', K.rl(clientIp(req))], ['EXPIRE', K.rl(clientIp(req)), 3600]]);
  if (count > MAX_PER_HOUR) return res.status(429).json({ ok: false, error: 'too_many' });

  const now = Date.now();
  const old = await getSub(email);
  // Already confirmed: answer the same as a new signup (never reveal who is on the list).
  if (old && old.status === 'confirmed') return res.status(200).json({ ok: true });
  // Don't resend the confirm email more than once every 10 minutes for the same address.
  if (old && old.status === 'pending' && now - (old.sent || 0) < 10 * 60 * 1000) return res.status(200).json({ ok: true });

  const sub = { email, status: 'pending', lang, source, created: (old && old.created) || now, sent: now };
  // Unconfirmed signups disappear by themselves after 30 days (the key expires).
  await redis([['SET', K.sub(email), JSON.stringify(sub), 'EX', '2592000'], ['ZADD', K.all, String(sub.created), email]]);
  await sendEmail({ to: email, subject: tr(lang).confirmSubject, html: confirmEmail(email, lang) });
  return res.status(200).json({ ok: true });
}

async function confirm(req, res, email, given, lang, isPost) {
  const t = tr(lang);
  if (!email || !sigOk(email, 'confirm', given)) return page(res, 400, t.bad, `<h1>${esc(t.bad)}</h1><a class="b" href="/">${esc(t.back)}</a>`, lang);
  if (!isPost) {
    return page(res, 200, t.pageConfirm, `<h1>${esc(t.pageConfirm)}</h1><p>${esc(t.pageConfirmText)} <strong>${esc(email)}</strong>.</p>
<form method="post" action="/api/newsletter"><input type="hidden" name="confirm" value="${esc(email)}"><input type="hidden" name="s" value="${esc(given)}"><input type="hidden" name="l" value="${esc(lang)}"><button type="submit">${esc(t.confirmBtn)}</button></form>`, lang);
  }
  const old = (await getSub(email)) || { email, lang, source: '', created: Date.now() };
  if (old.status !== 'confirmed') {
    const sub = { ...old, status: 'confirmed', confirmed: Date.now() };
    await redis([['SET', K.sub(email), JSON.stringify(sub)], ['ZADD', K.all, String(sub.created), email]]);
    try {
      const total = await countConfirmed();
      await sendEmail({ to: OWNER_EMAIL, subject: 'Newsletter: new subscriber (' + total + ' total)', html: ownerEmail(sub, total) });
    } catch (e) { console.error('Owner notice failed:', e.message); }
  }
  return page(res, 200, t.pageDone, `<h1>${esc(t.pageDone)}</h1><p>${esc(t.pageDoneText)}</p><a class="b" href="/">${esc(t.back)}</a>`, lang);
}

async function unsubscribe(req, res, email, given, lang, isPost) {
  const t = tr(lang);
  if (!email || !sigOk(email, 'unsubscribe', given)) return page(res, 400, t.bad, `<h1>${esc(t.bad)}</h1><a class="b" href="/">${esc(t.back)}</a>`, lang);
  if (!isPost) {
    return page(res, 200, t.pageUnsub, `<h1>${esc(t.pageUnsub)}</h1><p>${esc(t.pageUnsubText)} <strong>${esc(email)}</strong>.</p>
<form method="post" action="/api/newsletter"><input type="hidden" name="unsubscribe" value="${esc(email)}"><input type="hidden" name="s" value="${esc(given)}"><input type="hidden" name="l" value="${esc(lang)}"><button type="submit">${esc(t.pageUnsub)}</button></form>`, lang);
  }
  await redis([['DEL', K.sub(email)], ['ZREM', K.all, email]]);
  return page(res, 200, t.pageUnsubDone, `<h1>${esc(t.pageUnsubDone)}</h1><p>${esc(t.pageUnsubDoneText)}</p><a class="b" href="/">${esc(t.back)}</a>`, lang);
}

async function allSubs() {
  const [emails] = await redis([['ZRANGE', K.all, '0', '-1', 'REV']]);
  if (!emails || !emails.length) return [];
  const vals = await redis(emails.map((e) => ['GET', K.sub(e)]));
  // Expired unconfirmed signups: drop them from the index too.
  const gone = emails.filter((e, i) => !vals[i]);
  if (gone.length) await redis([['ZREM', K.all, ...gone]]);
  return vals.map((v, i) => { if (!v) return null; try { return JSON.parse(v); } catch (e) { return { email: emails[i], status: 'unknown' }; } }).filter(Boolean);
}
async function countConfirmed() {
  return (await allSubs()).filter((s) => s.status === 'confirmed').length;
}

function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // no formulas when opened in Excel
  return '"' + s.replace(/"/g, '""') + '"';
}

async function adminList(req, res, format) {
  const subs = await allSubs();
  if (format === 'csv') {
    const rows = [['email', 'status', 'language', 'signed_up', 'confirmed', 'source_page']]
      .concat(subs.map((s) => [s.email, s.status, s.lang, fmtDate(s.created), fmtDate(s.confirmed), s.source]));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eternal-city-newsletter-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
  }
  const confirmed = subs.filter((s) => s.status === 'confirmed').length;
  const s = sig('owner', 'list');
  const rows = subs.map((x) => `<tr><td>${esc(x.email)}</td><td style="color:${x.status === 'confirmed' ? '#9fd49a' : '#a3abba'}">${esc(x.status)}</td><td>${esc(x.lang)}</td><td>${esc(fmtDate(x.created))}</td><td>${esc(fmtDate(x.confirmed))}</td><td>${esc(x.source)}</td>
<td><form method="post" action="/api/newsletter" onsubmit="return confirm('Delete ${esc(x.email)}?')"><input type="hidden" name="admin" value="delete"><input type="hidden" name="email" value="${esc(x.email)}"><input type="hidden" name="s" value="${s}"><button type="submit">Delete</button></form></td></tr>`).join('');
  return page(res, 200, 'Newsletter subscribers', `<h1>Newsletter subscribers</h1>
<p><strong style="color:#eef0f4;">${confirmed}</strong> confirmed · ${subs.length - confirmed} waiting for confirmation</p>
<a class="b" href="${adminLink('csv')}">Download CSV</a>
<div style="overflow-x:auto;"><table><thead><tr><th>Email</th><th>Status</th><th>Lang</th><th>Signed up (UTC)</th><th>Confirmed (UTC)</th><th>Page</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#a3abba;">No subscribers yet</td></tr>'}</tbody></table></div>
<p style="font-size:12px;margin-top:22px;">Only confirmed addresses may receive the newsletter. Keep this link private.</p>
${issuesTable(await issueStatus(ISSUES.map((x) => x.id)), s)}`, 'en');
}


// ---------------------------------------------------------------- newsletter issues
function absUrl(u) { return /^https?:\/\//.test(u) ? u : SITE + '/' + String(u || '').replace(/^\/+/, ''); }
function findIssue(id) { return ISSUES.find((x) => x.id === id) || null; }

// Email HTML for one issue. email = the recipient (for the personal unsubscribe link) or null (preview).
// Images only, JPG, never wider than they are (width = the file's own width, max 520).
function issueHtml(issue, email) {
  const unsub = email ? link('unsubscribe', email) : '#';
  const items = (issue.items || []).map((it) => {
    const w = Math.min(Number(it.imageW) || 520, 520);
    const href = it.href ? absUrl(it.href) : '';
    const img = it.image ? `<tr><td style="padding:0 0 18px;text-align:center;">${href ? `<a href="${esc(href)}">` : ''}<img src="${esc(absUrl(it.image))}" width="${w}" alt="${esc(it.title)}" style="display:block;margin:0 auto;width:100%;max-width:${w}px;height:auto;border:0;">${href ? '</a>' : ''}</td></tr>` : '';
    return `<tr><td style="padding:30px 40px 6px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${img}
<tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:#1b1711;padding:0 0 8px;">${esc(it.title)}</td></tr>
<tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#4a463e;padding:0 0 14px;">${esc(it.text)}</td></tr>
${href ? `<tr><td style="padding:0 0 8px;"><a href="${esc(href)}" style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#0e1524;text-decoration:none;border-bottom:1px solid #d06f2b;padding-bottom:3px;">${esc(it.cta || 'Read more')} &rarr;</a></td></tr>` : ''}
</table></td></tr>
<tr><td style="padding:16px 40px 0;"><div style="height:1px;background:#e4ddd0;line-height:1px;font-size:1px;">&nbsp;</div></td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(issue.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f1ea;">${esc(issue.preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:28px 10px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e4ddd0;">
<tr><td style="background:#0e1524;padding:28px;text-align:center;"><a href="${SITE}/"><img src="${SITE}/img/logo-ecj-stacked.png" width="150" alt="Eternal City Jewelry" style="display:block;margin:0 auto;width:150px;height:auto;border:0;"></a></td></tr>
<tr><td style="padding:34px 40px 4px;font-family:Helvetica,Arial,sans-serif;font-size:15.5px;line-height:1.75;color:#1b1711;">${esc(issue.intro || '')}</td></tr>
${items}
<tr><td align="center" style="padding:30px 40px 34px;"><a href="${SITE}/collection.html" style="display:inline-block;background:#0e1524;color:#ffffff;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.2em;text-transform:uppercase;padding:15px 30px;">Shop the collection</a></td></tr>
<tr><td style="background:#0e1524;padding:22px 30px;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.7;color:#a3abba;">
Eternal City Jewelry &middot; Handmade in Rome, Italy<br>
You receive this email because you subscribed at eternalcity.jewelry.<br>
<a href="${esc(unsub)}" style="color:#cfd3da;">Unsubscribe</a> &middot; <a href="${SITE}/privacy-policy.html" style="color:#cfd3da;">Privacy</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function issueStatus(ids) {
  if (!ids.length) return {};
  const vals = await redis(ids.map((id) => ['GET', K.issue(id)]));
  const out = {};
  ids.forEach((id, i) => { try { out[id] = vals[i] ? JSON.parse(vals[i]) : null; } catch (e) { out[id] = null; } });
  return out;
}

async function sendIssueToAll(issue) {
  // Claim the issue first: a second click (or two tabs) can never send it twice.
  const [claimed] = await redis([['SET', K.issue(issue.id), JSON.stringify({ status: 'sending', at: Date.now() }), 'NX']]);
  if (claimed !== 'OK') return { already: true };
  const to = (await allSubs()).filter((s) => s.status === 'confirmed').map((s) => s.email);
  let sent = 0;
  const errors = [];
  for (let i = 0; i < to.length; i += 100) {
    const batch = to.slice(i, i + 100).map((email) => {
      const u = link('unsubscribe', email);
      return { from: safeFrom(), to: email, subject: issue.subject, html: issueHtml(issue, email),
        headers: { 'List-Unsubscribe': `<${u}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
    });
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify(batch),
    });
    if (r.ok) sent += batch.length;
    else { const t = await r.text(); errors.push(r.status + ' ' + t.slice(0, 200)); console.error('Newsletter batch failed:', r.status, t); }
  }
  await redis([['SET', K.issue(issue.id), JSON.stringify({ status: errors.length ? 'partly sent' : 'sent', at: Date.now(), sent, total: to.length, errors })]]);
  return { sent, total: to.length, errors };
}

function issuesTable(status, s) {
  if (!ISSUES.length) return '';
  const rows = ISSUES.slice().sort((a, b) => String(b.id).localeCompare(String(a.id))).map((is) => {
    const st = status[is.id];
    const done = st && st.status !== 'sending' ? `${esc(st.status)} ${esc(fmtDate(st.at))} UTC · ${esc(st.sent)}/${esc(st.total)}` : st ? 'sending…' : 'draft';
    const prev = `${SITE}/api/newsletter?admin=preview&id=${encodeURIComponent(is.id)}&s=${s}`;
    const form = (action, label, ask) => `<form method="post" action="/api/newsletter" style="display:inline;"${ask ? ` onsubmit="return confirm('${ask}')"` : ''}><input type="hidden" name="admin" value="${action}"><input type="hidden" name="id" value="${esc(is.id)}"><input type="hidden" name="s" value="${s}"><button type="submit">${label}</button></form>`;
    return `<tr><td>${esc(is.id)}</td><td>${esc(is.subject)}</td><td>${done}</td><td style="white-space:nowrap;"><a href="${prev}" target="_blank" style="font-size:11px;">Preview</a> ${form('test', 'Test to me')} ${st ? '' : form('send', 'Send to all', 'Send this newsletter to every confirmed subscriber? This cannot be undone.')}</td></tr>`;
  }).join('');
  return `<h1 style="font-size:32px;margin-top:46px;">Newsletters</h1>
<p>Preview, send yourself a test, then send to all. Each issue can be sent to the list once.</p>
<div style="overflow-x:auto;"><table><thead><tr><th>Week</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------- handler
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!redisConf()) return res.status(503).json({ ok: false, error: 'not_configured' });
    const q = req.query || {};

    if (req.method === 'GET') {
      const lang = q.l === 'it' ? 'it' : 'en';
      if (q.confirm) return await confirm(req, res, normEmail(q.confirm), q.s, lang, false);
      if (q.unsubscribe) return await unsubscribe(req, res, normEmail(q.unsubscribe), q.s, lang, false);
      if (q.admin === 'preview') {
        if (!sigOk('owner', 'list', q.s)) return page(res, 403, 'Not allowed', '<h1>Not allowed</h1>', 'en');
        const issue = findIssue(String(q.id || ''));
        if (!issue) return page(res, 404, 'Not found', '<h1>Newsletter not found</h1>', 'en');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        return res.end(issueHtml(issue, null));
      }
      if (q.admin === 'list') {
        if (!sigOk('owner', 'list', q.s)) return page(res, 403, 'Not allowed', '<h1>Not allowed</h1>', 'en');
        return await adminList(req, res, q.format);
      }
      res.statusCode = 302;
      res.setHeader('Location', '/');
      return res.end();
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const lang = (body.l || q.l) === 'it' ? 'it' : 'en';
      // RFC 8058 one-click unsubscribe (List-Unsubscribe-Post) sends the signed values in the URL.
      if (q.unsubscribe && body['List-Unsubscribe'] === 'One-Click') {
        const email = normEmail(q.unsubscribe);
        if (!email || !sigOk(email, 'unsubscribe', q.s)) return res.status(400).end();
        await redis([['DEL', K.sub(email)], ['ZREM', K.all, email]]);
        return res.status(200).end();
      }
      if (body.confirm) return await confirm(req, res, normEmail(body.confirm), body.s, lang, true);
      if (body.unsubscribe) return await unsubscribe(req, res, normEmail(body.unsubscribe), body.s, lang, true);
      if (body.admin === 'test' || body.admin === 'send') {
        if (!sigOk('owner', 'list', body.s)) return page(res, 403, 'Not allowed', '<h1>Not allowed</h1>', 'en');
        const issue = findIssue(String(body.id || ''));
        if (!issue) return page(res, 404, 'Not found', '<h1>Newsletter not found</h1>', 'en');
        const back = `<a class="b" href="${adminLink()}">Back to the list</a>`;
        if (body.admin === 'test') {
          await sendEmail({ to: OWNER_EMAIL, subject: '[TEST] ' + issue.subject, html: issueHtml(issue, OWNER_EMAIL) });
          return page(res, 200, 'Test sent', `<h1>Test sent</h1><p>The test was sent to the owner notification address.</p>${back}`, 'en');
        }
        const r = await sendIssueToAll(issue);
        if (r.already) return page(res, 409, 'Already sent', `<h1>Already sent</h1><p>This newsletter has already been sent (or is being sent).</p>${back}`, 'en');
        return page(res, 200, 'Newsletter sent', `<h1>Newsletter sent</h1><p>Sent to <strong style="color:#eef0f4;">${r.sent}</strong> of ${r.total} confirmed subscribers.${r.errors.length ? ' Some batches failed: see the Vercel logs.' : ''}</p>${back}`, 'en');
      }
      if (body.admin === 'delete') {
        if (!sigOk('owner', 'list', body.s)) return page(res, 403, 'Not allowed', '<h1>Not allowed</h1>', 'en');
        const email = normEmail(body.email);
        if (email) await redis([['DEL', K.sub(email)], ['ZREM', K.all, email]]);
        res.statusCode = 303;
        res.setHeader('Location', adminLink());
        return res.end();
      }
      return await subscribe(req, res, body);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false });
  } catch (e) {
    console.error('newsletter error:', e.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

// Exported for a future sending script: the signed unsubscribe link for each email.
module.exports.unsubscribeLink = (email) => link('unsubscribe', email);
