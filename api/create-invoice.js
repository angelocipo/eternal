// Vercel serverless function — POST /api/create-invoice
// Body: { number, customer: {...}, lines: [{description, quantity, unitPrice, vatRate}], total }
// Builds a FatturaPA XML from the order and submits it to Aruba's e-invoicing API.
// Called from api/stripe-webhook.js after a successful payment — can also be hit directly
// for manual/test invoices while wiring things up.

const { buildFatturaPAXml } = require('./_fattura-xml');
const { arubaSignIn, arubaUploadInvoice } = require('./_aruba-client');

const SELLER = {
  name: process.env.SELLER_NAME || '',
  vatNumber: process.env.SELLER_VAT_NUMBER || '',
  fiscalCode: process.env.SELLER_FISCAL_CODE || '',
  address: process.env.SELLER_ADDRESS || '',
  cap: process.env.SELLER_CAP || '',
  city: process.env.SELLER_CITY || '',
  province: process.env.SELLER_PROVINCE || '',
  regimeFiscale: process.env.SELLER_REGIME_FISCALE || 'RF01',
};

async function createInvoiceForOrder(order) {
  const xml = buildFatturaPAXml(order, SELLER);
  const filename = `${SELLER.vatNumber}_${order.number}.xml`;
  const token = await arubaSignIn();
  const result = await arubaUploadInvoice(token, xml, filename);
  return { xml, filename, result };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const order = req.body || {};
    if (!order.number || !order.customer || !Array.isArray(order.lines) || !order.lines.length) {
      res.status(400).json({ error: 'Dati fattura incompleti' });
      return;
    }
    const { filename, result } = await createInvoiceForOrder(order);
    res.status(200).json({ ok: true, filename, arubaResponse: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore nella creazione della fattura', detail: String(err.message || err) });
  }
};

module.exports.createInvoiceForOrder = createInvoiceForOrder;
