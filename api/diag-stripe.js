// TEMPORARY DIAGNOSTIC — delete from GitHub after use.
// Protected by the DIAG_TOKEN env var: without it, or with a wrong token, this returns 404.
//
//   /api/diag-stripe?token=XXX           → Stripe key, registered webhook endpoints, recent
//                                          checkout.session.completed events and their delivery state
//   /api/diag-stripe?token=XXX&full=1    → also dumps the metadata of the most recent session
//                                          (shows whether the buyer's email actually reached us)
//
// This answers the other half of the question: did the webhook ever fire, and did it succeed?

const Stripe = require('stripe');

function mask(v) {
  if (!v) return null;
  return `${v.slice(0, 8)}…${v.slice(-4)} (len ${v.length})`;
}

module.exports = async (req, res) => {
  const token = (req.query && req.query.token) || '';
  if (!process.env.DIAG_TOKEN || token !== process.env.DIAG_TOKEN) {
    res.status(404).send('Not found');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const out = {
    checkedAt: new Date().toISOString(),
    deployment: {
      vercelEnv: process.env.VERCEL_ENV || 'unknown',
      commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : 'unknown',
    },
    env: {
      STRIPE_SECRET_KEY: secretKey ? mask(secretKey) : 'MISSING',
      mode: secretKey ? (secretKey.startsWith('sk_live') ? 'LIVE' : secretKey.startsWith('sk_test') ? 'TEST' : 'unrecognised prefix') : '—',
      STRIPE_WEBHOOK_SECRET: whSecret ? mask(whSecret) : 'MISSING',
      webhookSecretLooksValid: whSecret ? /^whsec_/.test(whSecret) : false,
    },
    verdict: [],
  };

  if (!secretKey) {
    out.verdict.push('STRIPE_SECRET_KEY missing → checkout itself cannot work. Set it in Vercel, then Redeploy.');
    res.status(200).json(out);
    return;
  }
  if (!whSecret) {
    out.verdict.push('STRIPE_WEBHOOK_SECRET missing → the webhook rejects every call, so no email and no invoice is ever produced.');
  } else if (!/^whsec_/.test(whSecret)) {
    out.verdict.push('STRIPE_WEBHOOK_SECRET does not start with "whsec_" → you likely pasted the endpoint id or an API key instead of the signing secret.');
  }

  const stripe = new Stripe(secretKey);

  // 1. Which webhook endpoints are registered on this Stripe account?
  try {
    const eps = await stripe.webhookEndpoints.list({ limit: 20 });
    out.webhookEndpoints = eps.data.map((e) => ({
      url: e.url,
      status: e.status,
      events: e.enabled_events,
      created: new Date(e.created * 1000).toISOString(),
    }));
    const target = eps.data.filter((e) => /tshirt-shop\.online/.test(e.url));
    if (!eps.data.length) {
      out.verdict.push('NO webhook endpoint is registered on this Stripe account → Stripe never calls the site, so nothing after payment happens. Create one pointing at https://tshirt-shop.online/api/stripe-webhook for checkout.session.completed.');
    } else if (!target.length) {
      out.verdict.push(`No endpoint points at tshirt-shop.online (registered: ${out.webhookEndpoints.map((e) => e.url).join(', ')}) → payments on the new domain trigger nothing.`);
    } else {
      target.forEach((e) => {
        if (/www\./.test(e.url)) out.verdict.push(`Endpoint ${e.url} uses www → the redirect breaks the POST. Use the bare https://tshirt-shop.online/api/stripe-webhook.`);
        if (e.status !== 'enabled') out.verdict.push(`Endpoint ${e.url} is "${e.status}", not enabled.`);
        if (!e.enabled_events.includes('checkout.session.completed') && !e.enabled_events.includes('*')) {
          out.verdict.push(`Endpoint ${e.url} does NOT listen for checkout.session.completed (only: ${e.enabled_events.join(', ')}) → the order handler never runs.`);
        }
      });
    }
  } catch (err) {
    out.webhookEndpoints = { error: String(err && err.message || err) };
    out.verdict.push('Could not list webhook endpoints — the secret key may be restricted or invalid.');
  }

  // 2. Did any payment actually complete, and what did Stripe see of it?
  try {
    const events = await stripe.events.list({ type: 'checkout.session.completed', limit: 5 });
    out.recentCompletedCheckouts = events.data.map((e) => ({
      eventId: e.id,
      at: new Date(e.created * 1000).toISOString(),
      pendingWebhooks: e.pending_webhooks,
      sessionId: e.data.object.id,
      amount: e.data.object.amount_total != null ? (e.data.object.amount_total / 100).toFixed(2) + ' ' + String(e.data.object.currency || '').toUpperCase() : '—',
      buyerEmail: e.data.object.customer_details?.email || e.data.object.customer_email || 'NONE ON SESSION',
      metadataEmail: e.data.object.metadata?.inv_email || 'not in metadata',
    }));
    if (!events.data.length) {
      out.verdict.push('Stripe has recorded NO completed checkout at all → nothing has been paid yet in this mode (check you are not looking at TEST while paying in LIVE). No email is expected.');
    } else {
      const stuck = events.data.filter((e) => e.pending_webhooks > 0);
      if (stuck.length) {
        out.verdict.push(`${stuck.length} recent event(s) still have pending webhooks → Stripe is retrying because our endpoint did not return 200. Open Stripe → Developers → Webhooks → the endpoint → the failing attempt, and read the response body.`);
      } else {
        out.verdict.push('Recent completed checkouts exist and Stripe has no pending webhooks → the endpoint answered 200. If no mail arrived, the failure is inside the email step: check Vercel logs for "Resend send failed" and run /api/diag-email.');
      }
      const noEmail = events.data.filter((e) => !(e.data.object.customer_details?.email || e.data.object.customer_email || e.data.object.metadata?.inv_email));
      if (noEmail.length) {
        out.verdict.push(`${noEmail.length} recent session(s) carry NO buyer email anywhere → the confirmation cannot be addressed. The checkout form is not passing inv_email / customer_email.`);
      }
    }

    if (req.query.full === '1' && events.data.length) {
      out.mostRecentSessionMetadata = events.data[0].data.object.metadata || {};
    }
  } catch (err) {
    out.recentCompletedCheckouts = { error: String(err && err.message || err) };
  }

  res.status(200).json(out);
};
