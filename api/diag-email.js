// TEMPORARY DIAGNOSTIC — delete from GitHub after use.
// Protected by the DIAG_TOKEN env var: without it, or with a wrong token, this returns 404.
//
//   /api/diag-email?token=XXX                 → env vars present + Resend account/domain state
//   /api/diag-email?token=XXX&to=me@mail.it   → also performs a REAL send and returns Resend's raw reply
//
// NOTE: the filename must NOT start with an underscore — Vercel treats api/_*.js as helper
// modules and does not expose them as routes (that is why _email-client.js is not a URL).
//
// What each result means is spelled out in the "verdict" field of the response.

const FALLBACK_FROM = 'Tshirt Shop Online <ordini@tshirt-shop.online>';

function mask(v) {
  if (!v) return null;
  return `${v.slice(0, 6)}…${v.slice(-4)} (len ${v.length})`;
}

async function resend(path, apiKey) {
  const r = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  let body;
  try { body = JSON.parse(await r.text() || '{}'); } catch (e) { body = { parseError: String(e) }; }
  return { status: r.status, body };
}

module.exports = async (req, res) => {
  const token = (req.query && req.query.token) || '';
  if (!process.env.DIAG_TOKEN || token !== process.env.DIAG_TOKEN) {
    res.status(404).send('Not found');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || FALLBACK_FROM;
  const out = {
    checkedAt: new Date().toISOString(),
    deployment: {
      vercelEnv: process.env.VERCEL_ENV || 'unknown',
      url: process.env.VERCEL_URL || 'unknown',
      // If this timestamp is older than your last env-var change, the deployment predates it
      // and is still running the OLD values — you need a Redeploy.
      commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : 'unknown',
    },
    env: {
      RESEND_API_KEY: apiKey ? mask(apiKey) : 'MISSING',
      RESEND_FROM: process.env.RESEND_FROM || `not set → fallback "${FALLBACK_FROM}"`,
      OWNER_NOTIFICATION_EMAIL: process.env.OWNER_NOTIFICATION_EMAIL || 'not set → fallback info@tshirt-shop.online',
    },
    effectiveFrom: from,
    verdict: [],
  };

  if (!apiKey) {
    out.verdict.push('RESEND_API_KEY missing → no email can ever be sent. Set it in Vercel, then Redeploy.');
    res.status(200).json(out);
    return;
  }

  // 1. Which Resend account does this key belong to, and which domains can it send from?
  const domains = await resend('/domains', apiKey);
  out.resendDomains = domains;

  if (domains.status === 401 || domains.status === 403) {
    out.verdict.push('Resend rejected the API key (401/403) → the key is revoked or belongs to a deleted account. Create a new key in the account that owns the verified domain.');
  } else if (domains.status === 200) {
    const list = Array.isArray(domains.body?.data) ? domains.body.data : [];
    out.visibleDomains = list.map((d) => `${d.name} [${d.status}]`);
    const fromDomain = (from.match(/@([^>\s]+)/) || [])[1];
    out.fromDomain = fromDomain;
    const match = list.find((d) => d.name === fromDomain);
    if (!list.length) {
      out.verdict.push('This API key sees ZERO domains → it belongs to a different Resend account than the one where you verified tshirt-shop.online. Create a key inside the "printeurope" account.');
    } else if (!match) {
      out.verdict.push(`The sending domain "${fromDomain}" is NOT in this account (it sees: ${out.visibleDomains.join(', ')}) → every send is refused. Either fix RESEND_FROM or use a key from the account that owns that domain.`);
    } else if (match.status !== 'verified') {
      out.verdict.push(`Domain "${fromDomain}" exists but its status is "${match.status}", not verified → sends are refused until DNS verification completes.`);
    } else {
      out.verdict.push(`Key and domain agree: "${fromDomain}" is verified in this account. If mail still does not arrive, the failure is downstream (webhook never fires, or delivery/spam) — run /api/diag-stripe and add &to= here.`);
    }
  }

  // 2. Optional: attempt a real send. This is the definitive test.
  const to = req.query && req.query.to;
  if (to) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from,
          to,
          subject: 'Diagnostica invio — Tshirt Shop Online',
          html: '<p style="font:400 16px/1.5 Helvetica,Arial,sans-serif">Se leggi questo messaggio, l\'invio dal server funziona. Il problema è quindi a monte: il webhook Stripe non arriva o non contiene la tua email.</p>',
        }),
      });
      const text = await r.text();
      out.sendAttempt = { to, status: r.status, body: text };
      if (r.ok) {
        out.verdict.push('REAL SEND ACCEPTED by Resend. Check the inbox AND the spam folder, plus Resend → Logs for the delivery result. If this arrives but order emails do not, the webhook is the problem.');
      } else {
        out.verdict.push(`REAL SEND REFUSED (${r.status}). Resend's own reason is in sendAttempt.body — that message is the root cause.`);
      }
    } catch (err) {
      out.sendAttempt = { to, error: String(err) };
      out.verdict.push('The request to Resend threw before getting a reply — network/DNS level failure from the serverless function.');
    }
  } else {
    out.hint = 'Add &to=your@email.it to this URL to perform a real send test.';
  }

  res.status(200).json(out);
};
