// Receives ONE design file as a raw binary POST body and forwards it to the shop owner
// as an email attachment (Resend). Nothing is stored server-side.
//
//   POST /api/upload-design?ref=DES-AB12CD&name=logo.pdf
//   Content-Type: application/octet-stream
//   body: raw file bytes
//
// Content-Type is deliberately NOT application/json: the Vercel Node runtime then leaves
// the request stream untouched so we can read the bytes without base64 inflation.
// Requires RESEND_API_KEY and OWNER_NOTIFICATION_EMAIL env vars.

const MAX_BYTES = 4 * 1024 * 1024; // Vercel serverless request bodies cap out at 4.5 MB — hard platform limit
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'pdf', 'ai', 'eps', 'psd', 'tif', 'tiff', 'zip'];
const RESEND_FROM = process.env.RESEND_FROM || 'Tshirt Shop Online <ordini@tshirt-shop.online>';
const OWNER_EMAIL = process.env.OWNER_NOTIFICATION_EMAIL || 'tipografiaromaeur@gmail.com';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) { reject(Object.assign(new Error('too-large'), { code: 'too-large' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeName(raw) {
  return String(raw || 'design')
    .replace(/[\\/]/g, '_')
    .replace(/[^\w.\-À-ÿ ]/g, '')
    .slice(-120) || 'design';
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const url = new URL(req.url, 'http://localhost');
  const ref = safeName(url.searchParams.get('ref') || 'DES-000000');
  const filename = safeName(url.searchParams.get('name') || 'design');
  const product = (url.searchParams.get('product') || '').slice(0, 120);
  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (!ALLOWED_EXT.includes(ext)) {
    res.status(415).json({ error: `Formato .${ext} non supportato. Usa ${ALLOWED_EXT.join(', ')}.` });
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: 'Servizio di upload non configurato (RESEND_API_KEY).' });
    return;
  }

  let buf;
  try {
    buf = await readBody(req);
  } catch (err) {
    if (err.code === 'too-large') {
      res.status(413).json({ error: 'File troppo grande (max 4 MB). Inviacelo via email dopo l\'ordine.' });
      return;
    }
    res.status(400).json({ error: 'Lettura del file non riuscita.' });
    return;
  }
  if (!buf || !buf.length) { res.status(400).json({ error: 'File vuoto.' }); return; }

  const kb = (buf.length / 1024).toFixed(0);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: OWNER_EMAIL,
        subject: `File design ${ref} — ${filename}`,
        html: `<p style="font:400 15px/1.5 Barlow,Arial,sans-serif;">Nuovo file caricato dal configuratore.</p>
<p style="font:400 14px/1.6 Barlow,Arial,sans-serif;">
Riferimento: <strong>${ref}</strong><br>
File: <strong>${filename}</strong> (${kb} KB)<br>
Prodotto: ${product || '—'}<br>
Ricevuto: ${new Date().toLocaleString('it-IT')}
</p>
<p style="font:400 13px/1.6 Barlow,Arial,sans-serif;color:#6b6f72;">Se il cliente completa l'ordine, lo stesso riferimento comparirà nella mail di conferma.</p>`,
        attachments: [{ filename, content: buf.toString('base64') }],
      }),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error(`upload-design: Resend failed status=${r.status} body=${text}`);
      res.status(502).json({ error: 'Invio del file non riuscito, riprova.' });
      return;
    }
  } catch (err) {
    console.error('upload-design error', err);
    res.status(502).json({ error: 'Invio del file non riuscito, riprova.' });
    return;
  }

  res.status(200).json({ ok: true, ref, filename, bytes: buf.length });
};
