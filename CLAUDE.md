# Project instructions

## Always flag anomalies
Always check the data and the result, and proactively tell the user when something looks strange —
don't silently accept it and don't silently "fix" it either. Report it and ask.

Examples of things to always flag:
- Prices that don't increase with quantity, or a faster delivery that costs less than a slower one
- Duplicate / identical values where a progression is expected
- Missing tiers, formats, papers or delivery options compared to sibling products
- Values that break the established markup rule or pattern
- Inconsistencies between the front-end price table (index.html) and the server-side
  validation table (api/_pricing-data.js), or between displayed / quoted / charged amounts
- Broken or missing links, images, env vars, or pages

Rule: verify before delivering, then state clearly what looks off and let the user decide.

## Always say exactly what to upload to GitHub

The live site runs from GitHub → Vercel. The user uploads files by hand through the GitHub
web interface, so at the end of every turn that changed code, list precisely:

- **Da caricare** — only the files actually modified this turn, with full paths
  (e.g. `api/stripe-webhook.js`, `index.html`). Never "the whole project".
- **Da NON caricare** — anything in the project that must stay off the live site:
  `uploads/` (WordPress backups and screenshots, publicly downloadable once deployed),
  preview/anteprima files, and any temporary diagnostic endpoint.
- **Da cancellare a mano su GitHub** — uploading a folder does NOT delete files that were
  removed from the project. Deletions must be called out separately, file by file.

After the upload, remind the user to wait for **Ready** on Vercel, and note when a change
also needs a manual **Redeploy** (new or edited environment variables only take effect on
deploys created afterwards).

## Prodotti: link "More info here" al Compendium

Regola permanente, valida per **tutti i prodotti presenti e futuri**. Nei testi prodotto queste
frasi ereditate da WooCommerce diventano link cliccabili automaticamente, senza intervento manuale:

- `What is <Pietra>? More info here.` → "here" punta a `category.dc.html?stone=<slug>`
- `More about <Pietra> here.` → idem
- `Check out our complete collection here.` → "here" punta a `collection.dc.html`

La conversione avviene a runtime in `product.dc.html` (metodi `linkify` / `stoneHref`), che risolve
il nome della pietra su `data/stones.json`. Quindi basta scrivere la frase nella descrizione:
il link si crea da solo. Se il nome della pietra non esiste in `stones.json` la frase resta
testo semplice — in quel caso va aggiunta la pietra al Compendium.

## Immagini prodotto: nomi file

`img/<slug-prodotto>/italian-jewelry-<slug-prodotto>-<nome-file-originale>.webp`
Sempre convertite in WebP, mai .avif, mai hotlink da eternalcity.jewelry.
