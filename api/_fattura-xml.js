// Builds a minimal valid FatturaPA XML (FPR12/FPA12 body, simplified for privati/B2C via TD01)
// from an order. This is NOT the full FatturaPA schema — it covers the fields Aruba's
// synchronous checks require for a basic B2C cash-sale invoice. Extend as needed
// (bollo, ritenuta, multiple line items, ecc.) if your catalog needs them.

function pad(n, len) { return String(n).padStart(len, '0'); }

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// order: { number, date (Date), customer: { name, isCompany, vatNumber?, fiscalCode?, address, cap, city, province, country },
//          lines: [{ description, quantity, unitPrice, vatRate }], total }
function buildFatturaPAXml(order, seller) {
  const date = order.date || new Date();
  const dataDoc = `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
  const progressivo = order.number; // e.g. "00001"

  const lines = order.lines.map((l, i) => {
    const idx = i + 1;
    const totale = (l.quantity * l.unitPrice).toFixed(2);
    return `
      <DettaglioLinee>
        <NumeroLinea>${idx}</NumeroLinea>
        <Descrizione>${escapeXml(l.description)}</Descrizione>
        <Quantita>${l.quantity.toFixed(2)}</Quantita>
        <PrezzoUnitario>${l.unitPrice.toFixed(2)}</PrezzoUnitario>
        <PrezzoTotale>${totale}</PrezzoTotale>
        <AliquotaIVA>${l.vatRate.toFixed(2)}</AliquotaIVA>
      </DettaglioLinee>`;
  }).join('');

  const vatGroups = {};
  for (const l of order.lines) {
    const key = l.vatRate.toFixed(2);
    vatGroups[key] = (vatGroups[key] || 0) + l.quantity * l.unitPrice;
  }
  const riepiloghi = Object.entries(vatGroups).map(([rate, imponibile]) => `
      <DatiRiepilogo>
        <AliquotaIVA>${rate}</AliquotaIVA>
        <ImponibileImporto>${imponibile.toFixed(2)}</ImponibileImporto>
        <Imposta>${(imponibile * parseFloat(rate) / 100).toFixed(2)}</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>`).join('');

  const cliente = order.customer;
  const cessionarioAnagrafica = cliente.isCompany
    ? `<Anagrafica><Denominazione>${escapeXml(cliente.name)}</Denominazione></Anagrafica>`
    : `<Anagrafica><Denominazione>${escapeXml(cliente.name)}</Denominazione></Anagrafica>`;

  const idFiscaleCliente = cliente.vatNumber
    ? `<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${escapeXml(cliente.vatNumber)}</IdCodice></IdFiscaleIVA>`
    : '';
  const codiceFiscaleCliente = cliente.fiscalCode
    ? `<CodiceFiscale>${escapeXml(cliente.fiscalCode)}</CodiceFiscale>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" versione="FPR12">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${escapeXml(seller.vatNumber)}</IdCodice></IdTrasmittente>
      <ProgressivoInvio>${escapeXml(progressivo)}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${escapeXml(cliente.sdiCode || '0000000')}</CodiceDestinatario>
      ${cliente.pec ? `<PECDestinatario>${escapeXml(cliente.pec)}</PECDestinatario>` : ''}
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${escapeXml(seller.vatNumber)}</IdCodice></IdFiscaleIVA>
        <CodiceFiscale>${escapeXml(seller.fiscalCode)}</CodiceFiscale>
        <Anagrafica><Denominazione>${escapeXml(seller.name)}</Denominazione></Anagrafica>
        <RegimeFiscale>${escapeXml(seller.regimeFiscale || 'RF01')}</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(seller.address)}</Indirizzo>
        <CAP>${escapeXml(seller.cap)}</CAP>
        <Comune>${escapeXml(seller.city)}</Comune>
        <Provincia>${escapeXml(seller.province)}</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        ${idFiscaleCliente}
        ${codiceFiscaleCliente}
        ${cessionarioAnagrafica}
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(cliente.address)}</Indirizzo>
        <CAP>${escapeXml(cliente.cap)}</CAP>
        <Comune>${escapeXml(cliente.city)}</Comune>
        <Provincia>${escapeXml(cliente.province || '')}</Provincia>
        <Nazione>${escapeXml(cliente.country || 'IT')}</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${dataDoc}</Data>
        <Numero>${escapeXml(progressivo)}</Numero>
        <ImportoTotaleDocumento>${order.total.toFixed(2)}</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      ${lines}
      ${riepiloghi}
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
}

module.exports = { buildFatturaPAXml };
