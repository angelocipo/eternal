// Minimal Aruba "Fatturazione Elettronica" REST client: auth + invoice upload.
// Docs: https://fatturazioneelettronica.aruba.it/apidoc/docs.html
// Uses the DEMO base URL unless ARUBA_ENV=production.

const BASE_URLS = {
  demo: 'https://demows.fatturazioneelettronica.aruba.it',
  production: 'https://ws.fatturazioneelettronica.aruba.it',
};

function baseUrl() {
  return BASE_URLS[process.env.ARUBA_ENV === 'production' ? 'production' : 'demo'];
}

async function arubaSignIn() {
  const res = await fetch(`${baseUrl()}/services/authentication/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.ARUBA_USERNAME,
      password: process.env.ARUBA_PASSWORD,
    }),
  });
  if (!res.ok) {
    throw new Error(`Aruba signIn failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.token; // Bearer token for subsequent calls
}

// xml: the FatturaPA XML string. filename: e.g. "IT01234567890_00001.xml"
async function arubaUploadInvoice(token, xml, filename) {
  const dataFile = Buffer.from(xml, 'utf8').toString('base64');
  const res = await fetch(`${baseUrl()}/services/invoices/uploadInvoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ filename, dataFile }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Aruba uploadInvoice failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body; // { filename, ... } — check via getByFilename / getByInvoiceId for async esito
}

module.exports = { arubaSignIn, arubaUploadInvoice };
