// Minimal transactional email sender via Resend (https://resend.com).
// Requires RESEND_API_KEY env var set in Vercel. Sender must be a verified domain/address
// in your Resend account (orders@eternalcity.jewelry).

const VERIFIED_DOMAIN = 'eternalcity.jewelry';
// Sender must be on the domain verified in Resend; anything else is ignored (Resend would refuse it).
function safeFrom() {
  const raw = (process.env.RESEND_FROM || '').trim();
  const addr = (raw.match(/<([^>]+)>/) || [null, raw])[1] || '';
  if (addr.toLowerCase().endsWith('@' + VERIFIED_DOMAIN)) return raw;
  return `Eternal City Jewelry <orders@${VERIFIED_DOMAIN}>`;
}
const FROM = safeFrom();

async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  const text = await res.text();
  if (!res.ok) {
    // Log before throwing: the caller swallows the error so the order still completes,
    // and without this the real Resend reason never reaches the Vercel logs.
    console.error(`Resend send failed → to=${to} from=${FROM} status=${res.status} body=${text}`);
    throw new Error(`Resend send failed: ${res.status} ${text}`);
  }
  return JSON.parse(text || '{}');
}

module.exports = { sendEmail };
