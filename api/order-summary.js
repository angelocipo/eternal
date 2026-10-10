// Vercel serverless function — GET /api/order-summary?session_id=cs_...
// Summary for the thank-you page: reads from Stripe what was actually charged, so the page
// and the PDF receipt never show amounts that only existed in the browser.
// Answers only for paid sessions; the session id is long and not guessable.

const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!process.env.STRIPE_SECRET_KEY) { res.status(500).json({ error: 'Not configured' }); return; }
  const id = String((req.query && req.query.session_id) || '');
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) { res.status(400).json({ error: 'Invalid session_id' }); return; }
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const s = await stripe.checkout.sessions.retrieve(id, { expand: ['line_items'] });
    if (s.payment_status !== 'paid') { res.status(404).json({ error: 'Order not paid' }); return; }
    const m = s.metadata || {};
    const items = ((s.line_items && s.line_items.data) || []).map((li) => ({
      name: li.description || '',
      amount: (li.amount_total || 0) / 100,
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      items,
      shippingFee: Number(m.shipping_fee) || 0,
      total: (s.amount_total || 0) / 100,
      email: m.inv_email || (s.customer_details && s.customer_details.email) || '',
    });
  } catch (e) {
    console.error('order-summary failed', e);
    res.status(500).json({ error: 'Summary not available' });
  }
};
