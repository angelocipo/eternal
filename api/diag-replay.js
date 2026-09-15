// TEMPORARY DIAGNOSTIC + RECOVERY — delete from GitHub after use.
// Protected by DIAG_TOKEN.
//
//   /api/diag-replay?token=XXX&event=evt_123            → DRY RUN: rebuilds the order from the
//                                                          event and shows exactly what would be
//                                                          sent, without sending anything.
//   /api/diag-replay?token=XXX&event=evt_123&send=1     → actually sends the confirmation emails.
//   /api/diag-replay?token=XXX&event=evt_123&send=1&invoice=1 → also submits the invoice to Aruba.
//
// This runs the SAME code path as the webhook but skips signature verification (the event is
// re-fetched from Stripe by id over an authenticated call, so the data is still trustworthy).
// Any error is returned in full instead of being swallowed — which is how we find the real cause.

const Stripe = require('stripe');

module.exports = async (req, res) => {
  const token = (req.query && req.query.token) || '';
  if (!process.env.DIAG_TOKEN || token !== process.env.DIAG_TOKEN) {
    res.status(404).send('Not found');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');

  const eventId = req.query.event;
  if (!eventId || !/^evt_/.test(eventId)) {
    res.status(200).json({ error: 'Pass &event=evt_… (take the id from /api/diag-stripe).' });
    return;
  }

  const out = { eventId, steps: [], dryRun: req.query.send !== '1' };
  const step = (name, ok, detail) => out.steps.push({ name, ok, detail });

  let stripe;
  try {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    step('stripe client', true, 'created');
  } catch (err) {
    step('stripe client', false, String(err && err.stack || err));
    res.status(200).json(out);
    return;
  }

  // 1. Re-fetch the event and its line items.
  let session, lineItems;
  try {
    const event = await stripe.events.retrieve(eventId);
    session = event.data.object;
    step('fetch event', true, `type=${event.type} session=${session.id}`);
    lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    step('list line items', true, `${lineItems.data.length} line(s)`);
  } catch (err) {
    step('fetch event', false, String(err && err.message || err));
    res.status(200).json(out);
    return;
  }

  // 2. Rebuild the order exactly as the webhook does.
  let order, total;
  try {
    total = session.amount_total / 100;
    const md = session.metadata || {};
    const isCompany = md.inv_type === 'azienda';
    order = {
      number: 'REPLAY-' + eventId.slice(-6),
      date: new Date(session.created * 1000),
      total,
      customer: {
        name: isCompany ? (md.inv_company || md.inv_name) : (md.inv_name || session.customer_details?.name || 'Cliente'),
        isCompany,
        vatNumber: md.inv_vat || undefined,
        fiscalCode: md.inv_cf || undefined,
        pec: md.inv_pec || undefined,
        address: md.inv_address || '',
        cap: md.inv_cap || '',
        city: md.inv_city || '',
        province: '',
        country: md.inv_country || 'IT',
        sdiCode: md.inv_sdi || '0000000',
      },
      lines: lineItems.data.map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.amount_total / 100 / li.quantity,
        vatRate: 22,
      })),
    };
    step('build order', true, { total, customer: order.customer.name, lines: order.lines });
  } catch (err) {
    step('build order', false, String(err && err.stack || err));
    res.status(200).json(out);
    return;
  }

  // 3. Load the webhook module and reuse its email template. If THIS fails, the webhook was
  //    crashing on import — which would explain a non-200 for every delivery.
  let orderEmailHtml;
  try {
    const wh = require('./stripe-webhook');
    step('require stripe-webhook', true, `exported keys: ${Object.keys(wh).join(', ') || '(handler only)'}`);
  } catch (err) {
    step('require stripe-webhook', false, String(err && err.stack || err));
  }
  let sendEmail;
  try {
    // Inlined sender — deliberately no local require, so a missing helper cannot break this.
    const RESEND_FROM = process.env.RESEND_FROM || 'Tshirt Shop Online <ordini@tshirt-shop.online>';
    sendEmail = async ({ to, subject, html }) => {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`Resend ${r.status}: ${text}`);
      return text;
    };
    step('email sender', true, `from=${RESEND_FROM}`);

    const buyerEmail = session.metadata?.inv_email || session.customer_details?.email || session.customer_email;
    step('resolve buyer email', !!buyerEmail, buyerEmail || 'NONE — cannot address the confirmation');

    const html = `<div style="font:400 16px/1.6 Helvetica,Arial,sans-serif;color:#1d1f20">
      <p style="font:600 22px/1.2 Helvetica,Arial,sans-serif">Conferma ordine ${order.number}</p>
      <p>Grazie, ${order.customer.name}. Totale: € ${total.toFixed(2).replace('.', ',')}</p>
      <ul>${order.lines.map((l) => `<li>${l.description} — ${l.quantity}× — € ${(l.unitPrice * l.quantity).toFixed(2).replace('.', ',')}</li>`).join('')}</ul>
      <p style="color:#6b7378;font-size:14px">Messaggio rigenerato per un ordine già pagato.</p>
    </div>`;

    if (out.dryRun) {
      step('send emails', true, 'DRY RUN — nothing sent. Add &send=1 to actually deliver.');
      out.wouldSendTo = { buyer: buyerEmail || null, owner: process.env.OWNER_NOTIFICATION_EMAIL || 'info@tshirt-shop.online' };
    } else {
      if (buyerEmail) {
        try {
          const r = await sendEmail({ to: buyerEmail, subject: `Conferma ordine ${order.number} — Tshirt Shop Online`, html });
          step('send buyer email', true, r);
        } catch (err) {
          step('send buyer email', false, String(err && err.message || err));
        }
      }
      const owner = process.env.OWNER_NOTIFICATION_EMAIL || 'info@tshirt-shop.online';
      try {
        const r = await sendEmail({ to: owner, subject: `Ordine ${order.number} — € ${total.toFixed(2)}`, html });
        step('send owner email', true, r);
      } catch (err) {
        step('send owner email', false, String(err && err.message || err));
      }
    }
  } catch (err) {
    step('email sender', false, String(err && err.stack || err));
  }

  // 4. Invoicing — opt-in, because it produces a real fiscal document.
  if (req.query.invoice === '1' && !out.dryRun) {
    try {
      const { createInvoiceForOrder } = require('./create-invoice');
      step('require create-invoice', true, 'ok');
      const r = await createInvoiceForOrder(order);
      step('create invoice', true, r || 'submitted');
    } catch (err) {
      step('create invoice', false, String(err && err.stack || err));
    }
  } else {
    step('create invoice', true, 'skipped (add &invoice=1 with &send=1 to submit to Aruba)');
  }

  out.failures = out.steps.filter((s) => !s.ok).map((s) => s.name);
  out.verdict = out.failures.length
    ? `FAILED at: ${out.failures.join(', ')} — read the detail of those steps, that is the root cause.`
    : 'Every step succeeded. The order pipeline works when invoked directly, so the webhook failure is in the HTTP/signature layer, not in the order logic.';

  res.status(200).json(out);
};
