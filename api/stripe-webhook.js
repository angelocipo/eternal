// Vercel serverless function — POST /api/stripe-webhook
// Configure this URL in the Stripe Dashboard (Developers → Webhooks) listening for
// checkout.session.completed. On a successful payment, generates and submits the
// FatturaPA invoice to Aruba automatically.
//
// Needs the raw request body for signature verification — see vercel.json config note below.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
// NOTE: create-invoice is NOT required at the top level — it pulls in _fattura-xml and
// _aruba-client, and any one of those missing would crash this function on import, which is
// exactly the failure that silently killed every order confirmation. It is loaded lazily below.

// Email sending is INLINED here on purpose. It used to live in ./_email-client, but that helper
// went missing from a deployment and the top-level require crashed the whole function — the
// webhook never returned 200, so Stripe retried forever and no confirmation was ever sent.
// Keeping it inline means this endpoint has no local dependency that can go missing.
// The sender MUST be on a domain verified in Resend, otherwise Resend refuses every send
// (403) and neither the buyer nor the shop gets the order email. If RESEND_FROM points
// elsewhere it is ignored and the default address on the verified domain is used.
const VERIFIED_DOMAIN = 'eternalcity.jewelry';
function safeFrom() {
  const raw = (process.env.RESEND_FROM || '').trim();
  const addr = (raw.match(/<([^>]+)>/) || [null, raw])[1] || '';
  if (addr.toLowerCase().endsWith('@' + VERIFIED_DOMAIN)) return raw;
  if (raw) console.warn(`RESEND_FROM "${raw}" is not on @${VERIFIED_DOMAIN}: ignored.`);
  return `Eternal City Jewelry <orders@${VERIFIED_DOMAIN}>`;
}
const RESEND_FROM = safeFrom();

async function sendEmail({ to, subject, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  const text = await r.text();
  if (!r.ok) {
    console.error(`Resend send failed → to=${to} from=${RESEND_FROM} status=${r.status} body=${text}`);
    throw new Error(`Resend send failed: ${r.status} ${text}`);
  }
  return text;
}

const OWNER_EMAIL = process.env.OWNER_NOTIFICATION_EMAIL || 'info@eternalcity.jewelry';

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Stripe signs the EXACT bytes it sent, so we need the raw body. Depending on the runtime
// the body may already have been consumed and parsed — cover every shape we might get.
async function rawBody(req) {
  if (req.rawBody) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const buf = await buffer(req);
  if (buf.length > 0) return buf;
  if (req.body && typeof req.body === 'object') {
    // Last resort: the runtime parsed and discarded the raw bytes. Re-serialising cannot
    // reproduce them byte-for-byte, so the signature check WILL fail — surface that clearly.
    throw new Error('Raw body non disponibile: il runtime ha già parsato la richiesta. La verifica firma Stripe non è possibile.');
  }
  throw new Error('Body della richiesta vuoto.');
}

// Order reference in airline-booking style: a 6-character code like "K7QF2M".
//
// Derived deterministically from the Stripe session id — no counter, no storage, and the same
// order always produces the same code (a cold start cannot repeat or reset it, which is what the
// old in-memory 00001 counter did). The alphabet omits I, O, 0 and 1 so the code can be read out
// over the phone without ambiguity.
//
// IMPORTANT: grazie.dc.html contains a character-for-character copy of this function. Change one,
// change the other, or the code on screen stops matching the code in the email.
// Math.imul is required, not a plain `*`: 32-bit values times these primes exceed 2^53, so the
// low bits get rounded away before >>>0 reads them. That collapsed one character position to 5
// possible values and produced duplicate codes.
const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function orderRef(session) {
  const src = String(session.id || '');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < src.length; i++) {
    h1 = Math.imul(h1 ^ src.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + src.charCodeAt(i) * (i + 7), 2654435761) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 6; i++) {
    const mix = i < 3 ? (h1 >>> (i * 5)) : (h2 >>> ((i - 3) * 5));
    out += REF_ALPHABET[mix % 32];
  }
  return out;
}

// NOTE: the config assignment lives at the BOTTOM of this file — assigning it before
// `module.exports = handler` would be wiped out by that reassignment.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  let event;
  try {
    const buf = await rawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // The signature check can fail for a reason that is NOT an attack: the runtime may have
    // parsed and discarded the raw bytes, so they can't be re-created byte-for-byte. In that
    // case fall back to a trust-nothing path — take only the event id from the payload and
    // re-fetch the event from Stripe's API over an authenticated call. If the id is fake the
    // fetch fails, so the data we act on always comes from Stripe itself.
    const claimedId = req.body && typeof req.body === 'object' ? req.body.id : null;
    if (!claimedId || !/^evt_/.test(claimedId)) {
      console.error('Webhook signature verification failed and no event id to re-fetch', err);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }
    try {
      event = await stripe.events.retrieve(claimedId);
      console.warn('Signature check unavailable (raw body consumed) — event re-fetched from Stripe API:', claimedId);
    } catch (refetchErr) {
      console.error('Webhook re-fetch failed for', claimedId, refetchErr);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      const total = session.amount_total / 100;
      const md = session.metadata || {};
      const isCompany = md.inv_type === 'azienda';
      const order = {
        number: orderRef(session),
        date: new Date(),
        total,
        customer: {
          name: isCompany ? (md.inv_company || md.inv_name) : (md.inv_name || session.customer_details?.name || 'Cliente'),
          isCompany,
          vatNumber: md.inv_vat || undefined,
          fiscalCode: md.inv_cf || undefined,
          pec: md.inv_pec || undefined,
          address: md.inv_address || session.customer_details?.address?.line1 || '',
          cap: md.inv_cap || session.customer_details?.address?.postal_code || '',
          city: md.inv_city || session.customer_details?.address?.city || '',
          province: '',
          country: md.inv_country || session.customer_details?.address?.country || 'IT',
          // No SDI code = "consumatore finale", invoice made available via portal instead of pushed by SDI.
          sdiCode: md.inv_sdi || '0000000',
        },
        lines: lineItems.data.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.amount_total / 100 / li.quantity,
          vatRate: 22, // adjust if any product carries a different aliquota
        })),
      };
      const buyerEmail = md.inv_email || session.customer_details?.email || session.customer_email;
      console.log('Order', order.number, 'session', session.id, 'buyerEmail:', buyerEmail || 'NONE', '— owner:', OWNER_EMAIL);
      const summaryHtml = orderEmailHtml(order, total, md);
      // Each send gets its OWN try. They used to share one: if the buyer send threw, the owner
      // notification was skipped entirely and the shop never learned about the order.
      if (buyerEmail) {
        try {
          await sendEmail({ to: buyerEmail, subject: `Your order #${order.number} — Eternal City Jewelry`, html: summaryHtml });
          console.log('Buyer confirmation sent to', buyerEmail);
        } catch (mailErr) {
          console.error('Buyer confirmation FAILED for session', session.id, mailErr);
        }
      }
      try {
        await sendEmail({
          to: OWNER_EMAIL,
          subject: `Nuovo ordine #${order.number} — € ${total.toFixed(2)}`,
          html: summaryHtml.replace('</body></html>', ownerBlockHtml(order, buyerEmail, session) + '</body></html>'),
        });
        console.log('Owner notification sent to', OWNER_EMAIL);
      } catch (mailErr) {
        console.error('Owner notification FAILED to', OWNER_EMAIL, mailErr);
      }

      // Aruba is NOT connected yet (it needs a professional account) — invoices are issued by
      // hand for now. Set ARUBA_ENABLED=1 in the environment to switch the automatic submission
      // back on; until then we skip it instead of failing on every order.
      if (process.env.ARUBA_ENABLED === '1') {
        try {
          const { createInvoiceForOrder } = require('./create-invoice');
          await createInvoiceForOrder(order);
        } catch (invErr) {
          console.error('Invoice creation failed for session', session.id, invErr);
        }
      } else {
        console.log('Aruba disabled — invoice for order', order.number, 'must be issued manually. Total €', total.toFixed(2));
      }

      // Shipping/sender details aren't part of the invoice — they drive the packing slip
      // and courier label. Logged here for now; wire to your fulfillment email/sheet/CRM.
      console.log('Shipping for session', session.id, md.ship_same === '0'
        ? { name: md.ship_name, phone: md.ship_phone, address: md.ship_address, city: md.ship_city, cap: md.ship_cap, notes: md.ship_notes }
        : { sameAsBilling: true, ...order.customer });
      if (md.sender_use === '1') {
        console.log('Custom sender for session', session.id, { company: md.sender_company, phone: md.sender_phone, address: md.sender_address, city: md.sender_city, cap: md.sender_cap });
      }
    } catch (err) {
      // Don't fail the webhook response for Stripe's sake — log and handle/retry separately.
      console.error('Order processing failed for session', session.id, err);
    }
  }

  res.status(200).json({ received: true });
};

// ---------------------------------------------------------------------------
// Order emails. Table-based and fully inline-styled: email clients strip <style>
// blocks and ignore flexbox. Colours and type follow the shop: warm black, gold
// accent, Cormorant Garamond headings over Jost.
// ---------------------------------------------------------------------------

const BG = '#f4f1ea';
const PAPER = '#ffffff';
const INK = '#1b1711';
const GOLD = '#a8834f';
const DARK = '#15120d';
const ON_DARK = '#d4b572';
const RULE = '#e4ddd0';
const MUTED = '#6f6a5e';
const HEAD_FONT = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const BODY_FONT = "Jost,'Helvetica Neue',Helvetica,Arial,sans-serif";
const SITE = 'https://www.eternalcity.jewelry';

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function eur(n) {
  return '€ ' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function infoRows(rows) {
  return rows.map(([k, v]) => '<tr>' +
    '<td style="padding:8px 0;border-bottom:1px solid ' + RULE + ';font:500 11px/1.4 ' + BODY_FONT + ';letter-spacing:.12em;text-transform:uppercase;color:' + MUTED + ';width:130px;vertical-align:top;">' + k + '</td>' +
    '<td style="padding:8px 0;border-bottom:1px solid ' + RULE + ';font:400 14px/1.5 ' + BODY_FONT + ';color:' + INK + ';">' + v + '</td>' +
  '</tr>').join('');
}
function shipTo(order, md) {
  return md.ship_same === '0'
    ? [md.ship_name, md.ship_address, md.ship_cap, md.ship_city].filter(Boolean).map(esc).join(', ')
    : [order.customer.name, order.customer.address, order.customer.cap, order.customer.city, order.customer.country].filter(Boolean).map(esc).join(', ');
}

function orderEmailHtml(order, total, md) {
  md = md || {};
  const rows = order.lines.map((l) => '<tr>' +
    '<td style="padding:14px 0;border-bottom:1px solid ' + RULE + ';font:400 15px/1.5 ' + BODY_FONT + ';color:' + INK + ';">' + esc(l.description) + '</td>' +
    '<td style="padding:14px 0 14px 16px;border-bottom:1px solid ' + RULE + ';font:400 15px/1.5 ' + BODY_FONT + ';color:' + INK + ';text-align:right;white-space:nowrap;">' + eur(l.unitPrice * l.quantity) + '</td>' +
  '</tr>').join('');

  const details = infoRows([
    ['Ship to', shipTo(order, md) || '—'],
    ['Email', esc(md.inv_email) || '—'],
  ]);

  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
'<body style="margin:0;padding:0;background:' + BG + ';">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + BG + ';padding:32px 16px;"><tr><td align="center">' +
'<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:' + PAPER + ';border:1px solid ' + RULE + ';">' +

'<tr><td style="background:' + DARK + ';padding:30px 32px;text-align:center;">' +
  '<div style="font:500 11px/1 ' + BODY_FONT + ';letter-spacing:.32em;text-transform:uppercase;color:' + ON_DARK + ';">Eternal City Jewelry</div>' +
  '<div style="font:500 34px/1.1 ' + HEAD_FONT + ';color:#efe9dc;padding-top:12px;">Thank you for your order</div>' +
'</td></tr>' +

'<tr><td style="padding:28px 32px 0;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font:400 16px/1.6 ' + BODY_FONT + ';color:' + INK + ';">Dear ' + esc(order.customer.name) + ', your payment has been received. Your piece is now being prepared in our Roman atelier.</td>' +
    '<td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:16px;"><span style="display:inline-block;border:1px solid ' + GOLD + ';padding:6px 10px;font:500 13px/1 ' + BODY_FONT + ';letter-spacing:.1em;color:' + GOLD + ';">#' + order.number + '</span></td>' +
  '</tr></table>' +
'</td></tr>' +

'<tr><td style="padding:26px 32px 0;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' +
    '<tr><td colspan="2" style="padding-bottom:8px;border-bottom:1px solid ' + INK + ';font:500 11px/1 ' + BODY_FONT + ';letter-spacing:.16em;text-transform:uppercase;color:' + MUTED + ';">Your order</td></tr>' +
    rows +
    '<tr><td style="padding:18px 0 0;font:500 12px/1 ' + BODY_FONT + ';letter-spacing:.14em;text-transform:uppercase;color:' + MUTED + ';">Total paid</td>' +
    '<td style="padding:18px 0 0;font:500 28px/1 ' + HEAD_FONT + ';color:' + INK + ';text-align:right;white-space:nowrap;">' + eur(total) + '</td></tr>' +
    '<tr><td colspan="2" style="padding-top:4px;font:400 12px/1.4 ' + BODY_FONT + ';color:' + MUTED + ';text-align:right;">VAT included</td></tr>' +
  '</table>' +
'</td></tr>' +

'<tr><td style="padding:26px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' + details + '</table></td></tr>' +

'<tr><td style="padding:26px 32px 0;font:400 14px/1.7 ' + BODY_FONT + ';color:' + MUTED + ';">' +
  'Every piece is shipped insured from Rome in its luxury box. You will receive the tracking number as soon as it leaves the atelier. ' +
  'Questions about your order? Simply reply to this email and quote <strong style="color:' + INK + ';">#' + order.number + '</strong>.' +
'</td></tr>' +

'<tr><td style="padding:28px 32px 30px;">' +
  '<div style="border-top:1px solid ' + RULE + ';padding-top:16px;font:400 12px/1.6 ' + BODY_FONT + ';color:' + MUTED + ';text-align:center;">' +
    'Eternal City Jewelry · Made in Rome, worn forever · <a href="' + SITE + '" style="color:' + GOLD + ';text-decoration:none;">eternalcity.jewelry</a>' +
  '</div>' +
'</td></tr>' +

'</table></td></tr></table></body></html>';
}

function ownerBlockHtml(order, buyerEmail, session) {
  const md = session.metadata || {};
  const rowsData = [
    ['Cliente', esc(order.customer.name)],
    ['Email', esc(buyerEmail) || '—'],
    ['Tipo', order.customer.isCompany ? 'Azienda' : 'Privato'],
    ['P. IVA / CF', esc(order.customer.vatNumber || order.customer.fiscalCode) || '—'],
    ['Fatturazione', [order.customer.address, order.customer.cap, order.customer.city, order.customer.country].filter(Boolean).map(esc).join(', ') || '—'],
    ['Spedire a', shipTo(order, md) || '—'],
  ];
  if (md.ship_same === '0' && md.ship_phone) rowsData.push(['Telefono', esc(md.ship_phone)]);
  if (md.ship_same === '0' && md.ship_notes) rowsData.push(['Note', esc(md.ship_notes)]);
  if (order.customer.isCompany) rowsData.push(['PEC / SDI', [md.inv_pec, md.inv_sdi].filter(Boolean).map(esc).join(' — ') || '—']);
  rowsData.push(['Stripe', '<a href="https://dashboard.stripe.com/payments/' + esc(session.payment_intent || '') + '" style="color:' + GOLD + ';">Apri pagamento</a>']);

  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + BG + ';padding:0 16px 32px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:' + PAPER + ';border:1px solid ' + RULE + ';">' +
      '<tr><td style="padding:22px 32px 6px;font:500 11px/1 ' + BODY_FONT + ';letter-spacing:.16em;text-transform:uppercase;color:' + GOLD + ';">Dati per l\'evasione</td></tr>' +
      '<tr><td style="padding:8px 32px 26px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' + infoRows(rowsData) + '</table></td></tr>' +
    '</table></td></tr></table>';
}

// Raw body is required for Stripe signature verification. Must be assigned AFTER the
// handler above, otherwise `module.exports = handler` discards it.
module.exports.config = { api: { bodyParser: false } };
