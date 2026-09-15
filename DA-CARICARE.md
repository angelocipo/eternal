# Da caricare su GitHub — tshirt-shop

Memoria di lavoro: file modificati e non ancora confermati come caricati.

Ultimo aggiornamento: 3 agosto 2026 — **pulizia progetto: rimosso tutto tipografia-online**

## Il progetto ora contiene solo tshirt-shop

29 pagine, tutte a marchio tshirt-shop:

**Nucleo commerciale** — `index.html`, `Beagle.dc.html`, `promozione-100-magliette.dc.html`,
`checkout.dc.html`, `grazie.dc.html`, `preventivo.dc.html`

**Pagine SEO prodotto/servizio** — stampa-dtf-roma, stampa-magliette-24-ore-roma,
stampa-oro-argento-olografica, stampa-t-shirt-grandi-quantita, stampa-t-shirt-roma-eur-guida,
preparare-file-stampa-t-shirt, abbigliamento-lavoro-personalizzato, magliette-personalizzate-eventi,
servizio-express-stampa-roma-sud, custom-t-shirt-printing-rome, felpe-personalizzate,
abbigliamento-personalizzato-roma, magliette-con-frasi-romani-roma-eur,
stampa-su-magliette-centro-stampa-roma-eur

**Blog** — `blog.dc.html` + 4 articoli (addio al celibato, maglietta in tempi record,
rivoluzione stampa t-shirt 24 ore, printing services in Italy)

**Servizio e legali** — contattateci, privacy-policy, privacy-gdpr,
termini-di-servizio-terms-of-service, blocked

**Supporto** — `i18n.js`, `consent.js`, `doc-page.js`, `support.js`, `api/`, `img/`, `_ds/`,
`vercel.json` (28 rewrite), `sitemap.xml` (26 URL)

## Da caricare — l'intero progetto

Dopo una pulizia di questa portata conviene caricare tutto, non i singoli file.

## Da NON caricare mai

- `backup-tipografia/` — archivio delle 25 pagine rimosse, tenuto solo come scorta locale
- `DA-CARICARE.md` — questo promemoria
- `api/diag-replay.js`, `api/diag-stripe.js` — endpoint diagnostici ancora aperti

## Da cancellare a mano su GitHub

L'upload non rimuove i file eliminati: vanno cancellati uno per uno dal repo.

**25 pagine** — tipografia-roma-eur, centro-stampa-tipografia-roma-eur, catalogo-tipografia,
prezzi-strategici-qualita-professionale-risultati-concreti, preparare-lesecutivo-per-la-stampa,
stampa-rollup-roma-eur-24h, stampa-rollup-banner-espositore-roma-eur, roll-up-in-24-ore-roma,
roll-up-express-consegna-roma-eur, rollup-economico, rollup-landing-2025,
noleggio-stand-fieristici-leggeri-roma, stampa-poster-a-roma-in-24-ore,
realizzazione-foto-quadri-roma-eur, canvas-con-foto-effetto-pittura-ad-olio,
blog-canvas-effetto-pittura-ad-olio, blog-statua-della-liberta-warhol, blog-tele-pop-art-warhol,
blog-van-gogh-notte-stellata, blog-biglietti-da-visita-roma-eur-24h,
blog-modifica-documenti-photoshop, custom-printed-badges-en, checkout-print-19awfrr,
"Grazie per il tuo ordine.html", "Grazie source.html"

**2 cartelle** — `uploads/`, `da-caricare-upload/`

**1 immagine** — `img/tshirt-dic-copia.avif`

## Dopo l'upload

1. Attendere **Ready** su Vercel.
2. Redeploy manuale solo se sono state toccate variabili d'ambiente (in questo giro, no).
3. In Search Console: reinviare `sitemap.xml`. Le 25 pagine rimosse daranno 404 —
   è corretto, ma se avevano posizionamento su Google conviene un redirect 301 verso
   la pagina equivalente su tipografia.online.

## Da decidere

- **`api/_pricing-data.js` contiene ancora i listini tipografia** (volantini, pieghevoli,
  locandine, biglietti da visita, rilegature, roll-up). Non sono raggiungibili da nessuna
  pagina del sito, ma restano nel codice del server. Ripulirli è delicato: va verificato
  che nessun `productId` in uso vi faccia riferimento.
- Tre riferimenti a "tipografia" sono stati lasciati **volutamente** perché reali e legali:
  l'email `tipografiaromaeur@gmail.com` nelle pagine legali, la ragione sociale
  "Printing Italy/tipografia.online" come titolare del trattamento nella privacy policy,
  e l'insegna "Centro Stampa Tipografia" nella mappa Google in contattateci.

## Lavori aperti

- Pulizia sicurezza: rimuovere `diag-*.js` e `DIAG_TOKEN`
- Verificare o rimuovere il pulsante PayPal
- `inv_sdi` obbligatorio per i clienti business
- Attivazione Aruba per la fatturazione
- Switch IT/EN da estendere alle pagine che hanno già le traduzioni `data-en` inutilizzate
- Checkout e pagina di ringraziamento non ancora tradotti
