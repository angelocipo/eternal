// Minimal transactional email sender via Resend (https://resend.com).
// Requires RESEND_API_KEY env var set in Vercel. Sender must be a verified domain/address
// in your Resend account (e.g. ordini@tipografia.online).

const FROM = process.env.RESEND_FROM || 'Tshirt Shop Online <ordini@tshirt-shop.online>';

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
