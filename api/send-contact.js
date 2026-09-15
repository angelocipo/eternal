// Contact form handler for Eternal City Jewelry.
// Sends the enquiry to the shop owner via Resend, with the visitor's address as reply-to.
// Requires RESEND_API_KEY and OWNER_NOTIFICATION_EMAIL env vars set in Vercel.

const FROM = process.env.RESEND_FROM || 'Eternal City Jewelry <ordini@tshirt-shop.online>';
const OWNER_EMAIL = process.env.OWNER_NOTIFICATION_EMAIL || 'tipografiaromaeur@gmail.com';
const MAX = { name: 120, email: 160, subject: 160, message: 4000 };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method-not-allowed' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Honeypot: bots fill hidden fields, humans never see them.
  if (body.website) { res.status(200).json({ ok: true }); return; }

  const name = String(body.name || '').trim().slice(0, MAX.name);
  const email = String(body.email || '').trim().slice(0, MAX.email);
  const subject = String(body.subject || '').trim().slice(0, MAX.subject);
  const message = String(body.message || '').trim().slice(0, MAX.message);

  if (!name || !email || !message) { res.status(400).json({ error: 'missing-fields' }); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { res.status(400).json({ error: 'invalid-email' }); return; }

  if (!process.env.RESEND_API_KEY) {
    console.error('contact: RESEND_API_KEY is not set');
    res.status(500).json({ error: 'not-configured' });
    return;
  }

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1d1f20;">
    <p style="margin:0 0 14px;"><strong>New enquiry from the Eternal City Jewelry site</strong></p>
    <p style="margin:0 0 6px;"><strong>Name:</strong> ${esc(name)}</p>
    <p style="margin:0 0 6px;"><strong>Email:</strong> ${esc(email)}</p>
    <p style="margin:0 0 14px;"><strong>Subject:</strong> ${esc(subject) || '—'}</p>
    <p style="margin:0 0 6px;"><strong>Message:</strong></p>
    <div style="white-space:pre-wrap;border-left:3px solid #d4b572;padding-left:12px;">${esc(message)}</div>
  </div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: FROM,
        to: OWNER_EMAIL,
        reply_to: email,
        subject: subject ? `Contact — ${subject}` : `Contact — ${name}`,
        html,
      }),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error(`Resend contact failed → status=${r.status} body=${text}`);
      res.status(502).json({ error: 'send-failed' });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact handler error:', err);
    res.status(500).json({ error: 'server-error' });
  }
};
