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
const RESEND_FROM = process.env.RESEND_FROM || 'Tshirt Shop Online <ordini@tshirt-shop.online>';

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

const OWNER_EMAIL = process.env.OWNER_NOTIFICATION_EMAIL || 'info@tshirt-shop.online';

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
          await sendEmail({ to: buyerEmail, subject: `Conferma ordine #${order.number} — Tshirt Shop Online`, html: summaryHtml });
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
// Order confirmation email. Table-based and fully inline-styled: email clients
// strip <style> blocks and ignore flexbox. Colours and type follow the site's
// own system — steel accent on a light technical ground, condensed headings.
// (Repainted with the shop's own palette: ink #201e1d, accent red #ec3013, Archivo.)
// ---------------------------------------------------------------------------

const BG = '#f3f2f2';
const INK = '#201e1d';
const STEEL = '#ec3013';
const STEEL_DARK = '#201e1d';
const RULE = '#cfcccc';
const MUTED = '#605d5d';
const ON_DARK = '#a8a4a4';
const HEAD_FONT = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";
const BODY_FONT = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";

function eur(n) {
  const s = (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
  return '€ ' + s;
}

function cornerRow() {
  return `<tr>
    <td colspan="2" style="padding:0;"><div style="height:1px;background:${RULE};font-size:0;line-height:0;">&nbsp;</div></td>
  </tr>`;
}

function orderEmailHtml(order, total, md) {
  md = md || {};
  const designRows = [];
  if (md.design_ref) {
    designRows.push(`Riferimento file: <strong style="color:${INK};">${md.design_ref}</strong>${md.design_files ? ` — ${md.design_files}` : ''}`);
  }
  if (md.design_link) {
    designRows.push(`Link file: <a href="${md.design_link}" style="color:${STEEL};">${md.design_link}</a>`);
  }
  const designBlock = designRows.length
    ? `<tr><td style="padding:22px 32px 0;">
        <div style="border:1px solid ${RULE};padding:14px 16px;font:400 13px/1.7 ${BODY_FONT};color:${MUTED};">
          <div style="font:600 11px/1 ${BODY_FONT};letter-spacing:.14em;text-transform:uppercase;color:${STEEL};padding-bottom:8px;">Materiale da stampare</div>
          ${designRows.join('<br>')}
          <div style="padding-top:8px;">Cita questo riferimento in ogni comunicazione sull'ordine.</div>
        </div>
      </td></tr>`
    : '';
  const rows = order.lines.map((l) => {
    const lineTotal = l.unitPrice * l.quantity;
    return `<tr>
      <td style="padding:14px 0;border-bottom:1px solid ${RULE};font:400 15px/1.45 ${BODY_FONT};color:${INK};">${l.description}</td>
      <td style="padding:14px 0 14px 16px;border-bottom:1px solid ${RULE};font:400 15px/1.45 ${BODY_FONT};color:${MUTED};text-align:right;white-space:nowrap;">${l.quantity}×</td>
      <td style="padding:14px 0 14px 16px;border-bottom:1px solid ${RULE};font:400 15px/1.45 ${BODY_FONT};color:${INK};text-align:right;white-space:nowrap;">${eur(lineTotal)}</td>
    </tr>`;
  }).join('');

  const billingRows = [
    ['Intestatario', order.customer.name || '—'],
    ['Tipo', order.customer.isCompany ? 'Azienda' : 'Privato'],
    ['P. IVA / CF', order.customer.vatNumber || order.customer.fiscalCode || '—'],
    ['Indirizzo', [order.customer.address, order.customer.cap, order.customer.city].filter(Boolean).join(', ') || '—'],
    ['Email', md.inv_email || '—'],
  ];
  if (order.customer.isCompany) {
    billingRows.push(['PEC / SDI', [md.inv_pec, md.inv_sdi].filter(Boolean).join(' — ') || '—']);
  }
  const billingBlock = `<tr><td style="padding:26px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${STEEL};border-collapse:separate;">
          <tr><td style="padding:14px 16px 4px;">
            <div style="font:700 11px/1 ${BODY_FONT};letter-spacing:.16em;text-transform:uppercase;color:${STEEL};">Dati per la fatturazione</div>
            <div style="font:800 20px/1.2 ${HEAD_FONT};color:${INK};padding-top:6px;">La fattura sarà intestata così</div>
          </td></tr>
          <tr><td style="padding:8px 16px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              ${billingRows.map(([k, v]) => `<tr>
                <td style="padding:7px 0;border-bottom:1px solid ${RULE};font:600 12px/1.4 ${BODY_FONT};letter-spacing:.06em;text-transform:uppercase;color:${MUTED};width:140px;">${k}</td>
                <td style="padding:7px 0;border-bottom:1px solid ${RULE};font:400 14px/1.4 ${BODY_FONT};color:${INK};">${v}</td>
              </tr>`).join('')}
            </table>
            <div style="padding-top:10px;font:400 13px/1.6 ${BODY_FONT};color:${MUTED};">Serve una correzione? Rispondi a questa email entro un giorno lavorativo, prima dell'emissione.</div>
          </td></tr>
        </table>
      </td></tr>`;

  const senderRows = md.sender_use === '1' ? [
    ['Ragione sociale', md.sender_company || '—'],
    ['Indirizzo', [md.sender_address, md.sender_cap, md.sender_city].filter(Boolean).join(', ') || '—'],
    ['Telefono', md.sender_phone || '—'],
  ] : [];
  const senderBlock = senderRows.length
    ? `<tr><td style="padding:26px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${STEEL};border-collapse:separate;">
          <tr><td style="padding:14px 16px 4px;">
            <div style="font:700 11px/1 ${BODY_FONT};letter-spacing:.16em;text-transform:uppercase;color:${STEEL};">Dati del mittente</div>
            <div style="font:800 20px/1.2 ${HEAD_FONT};color:${INK};padding-top:6px;">Il pacco parte a nome tuo</div>
          </td></tr>
          <tr><td style="padding:8px 16px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              ${senderRows.map(([k, v]) => `<tr>
                <td style="padding:7px 0;border-bottom:1px solid ${RULE};font:600 12px/1.4 ${BODY_FONT};letter-spacing:.06em;text-transform:uppercase;color:${MUTED};width:140px;">${k}</td>
                <td style="padding:7px 0;border-bottom:1px solid ${RULE};font:400 14px/1.4 ${BODY_FONT};color:${INK};">${v}</td>
              </tr>`).join('')}
            </table>
            <div style="padding-top:10px;font:400 13px/1.6 ${BODY_FONT};color:${MUTED};">Nessun nostro riferimento comparirà sul pacco: mittente e documento di trasporto riportano questi dati.</div>
          </td></tr>
        </table>
      </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${RULE};">

      <tr><td style="background:${STEEL_DARK};padding:26px 32px;">
        <div style="font:600 11px/1 ${BODY_FONT};letter-spacing:.18em;text-transform:uppercase;color:${ON_DARK};">Tshirt Shop Online</div>
        <div style="font:800 34px/1.05 ${HEAD_FONT};letter-spacing:-.01em;color:#ffffff;padding-top:8px;">Ordine confermato</div>
      </td></tr>

      <tr><td style="padding:0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cornerRow()}</table>
      </td></tr>

      <tr><td style="padding:8px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font:400 16px/1.5 ${BODY_FONT};color:${INK};">Grazie per il tuo ordine, ${order.customer.name}.</td>
          <td style="text-align:right;vertical-align:top;white-space:nowrap;">
            <span style="display:inline-block;border:1px solid ${RULE};padding:5px 10px;font:600 13px/1 ${BODY_FONT};letter-spacing:.08em;color:${STEEL};">#${order.number}</span>
          </td>
        </tr></table>
      </td></tr>

      <tr><td style="padding:26px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding-bottom:8px;border-bottom:2px solid ${INK};font:600 11px/1 ${BODY_FONT};letter-spacing:.14em;text-transform:uppercase;color:${MUTED};">Dettaglio</td>
            <td style="padding-bottom:8px;border-bottom:2px solid ${INK};font:600 11px/1 ${BODY_FONT};letter-spacing:.14em;text-transform:uppercase;color:${MUTED};text-align:right;">Q.tà</td>
            <td style="padding-bottom:8px;border-bottom:2px solid ${INK};font:600 11px/1 ${BODY_FONT};letter-spacing:.14em;text-transform:uppercase;color:${MUTED};text-align:right;">Importo</td>
          </tr>
          ${rows}
          <tr>
            <td colspan="2" style="padding:18px 0 0;font:600 13px/1 ${BODY_FONT};letter-spacing:.1em;text-transform:uppercase;color:${MUTED};">Totale pagato</td>
            <td style="padding:18px 0 0;font:800 30px/1 ${HEAD_FONT};color:${INK};text-align:right;white-space:nowrap;">${eur(total)}</td>
          </tr>
          <tr><td colspan="3" style="padding-top:4px;font:400 12px/1.4 ${BODY_FONT};color:${MUTED};text-align:right;">IVA inclusa</td></tr>
        </table>
      </td></tr>

      ${billingBlock}
      ${senderBlock}
      ${designBlock}
      <tr><td style="padding:28px 32px 0;">
        <div style="border-top:1px solid ${RULE};padding-top:18px;font:400 14px/1.6 ${BODY_FONT};color:${MUTED};">
          Riceverai la fattura entro un giorno lavorativo, insieme alle istruzioni per l'invio del materiale da stampare.
        </div>
      </td></tr>
      <tr><td style="padding:0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cornerRow()}</table>
      </td></tr>

      <tr><td style="padding:0 32px 28px;">
        <div style="font:400 12px/1.6 ${BODY_FONT};color:${MUTED};">
          Tshirt Shop Online · Roma EUR · <a href="https://tshirt-shop.online" style="color:${STEEL};text-decoration:none;">tshirt-shop.online</a>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

function ownerBlockHtml(order, buyerEmail, session) {
  const md = session.metadata || {};
  const rowsData = [
    ['Cliente', order.customer.name],
    ['Email', buyerEmail || '—'],
    ['Tipo', order.customer.isCompany ? 'Azienda' : 'Privato'],
    ['P. IVA / CF', order.customer.vatNumber || order.customer.fiscalCode || '—'],
    ['Indirizzo', [order.customer.address, order.customer.cap, order.customer.city].filter(Boolean).join(', ') || '—'],
    ['Spedizione', md.ship_same === '0'
      ? [md.ship_name, md.ship_address, md.ship_cap, md.ship_city].filter(Boolean).join(', ')
      : 'Come fatturazione'],
  ];
  if (md.design_ref) {
    rowsData.push(['File design', `${md.design_ref}${md.design_files ? ' — ' + md.design_files : ''} (arrivati per email separata)`]);
  }
  if (md.design_link) {
    rowsData.push(['Link file', `<a href="${md.design_link}" style="color:${STEEL};">${md.design_link}</a>`]);
  }
  const rows = rowsData.map(([k, v]) => `<tr>
    <td style="padding:7px 0;border-bottom:1px solid ${RULE};font:600 12px/1.4 ${BODY_FONT};letter-spacing:.06em;text-transform:uppercase;color:${MUTED};width:150px;">${k}</td>
    <td style="padding:7px 0;border-bottom:1px solid ${RULE};font:400 14px/1.4 ${BODY_FONT};color:${INK};">${v}</td>
  </tr>`).join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:0 16px 32px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${RULE};">
      <tr><td style="padding:22px 32px 6px;">
        <div style="font:600 11px/1 ${BODY_FONT};letter-spacing:.16em;text-transform:uppercase;color:${STEEL};">Dati per l'evasione</div>
      </td></tr>
      <tr><td style="padding:8px 32px 26px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

// Raw body is required for Stripe signature verification. Must be assigned AFTER the
// handler above, otherwise `module.exports = handler` discards it.
module.exports.config = { api: { bodyParser: false } };
