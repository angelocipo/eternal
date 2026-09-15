// Server-side pricing mirror of the catalog. Keep in sync with PRODUCTS in index.html.
// Only what's needed to recompute price safely (never trust a price sent from the browser).

const ROLLUP_VARIANTS = [
  { label: '80/85 × 200 cm', price: 60 },
  { label: '150 × 200 cm', price: 350 },
  { label: '200 × 200 cm', price: 530 },
];

const ANGOLI_ARROTONDATI_TIERS = [{qty:100,price:8},{qty:250,price:10},{qty:500,price:14},{qty:1000,price:19},{qty:2500,price:23},{qty:5000,price:29},{qty:7500,price:38},{qty:10000,price:48}];
function angoliArrotondatiPrice(qty) {
  const t = ANGOLI_ARROTONDATI_TIERS.find(t => qty <= t.qty);
  return (t || ANGOLI_ARROTONDATI_TIERS[ANGOLI_ARROTONDATI_TIERS.length - 1]).price;
}

// --- T-Shirt Unisex 24H (mirror of T-Shirt Product Page.dc.html) ---
const TSHIRT_PRICE_TIERS = [
  { min: 1, white: 8, other: 8.8 }, { min: 5, white: 6.5, other: 7.15 },
  { min: 10, white: 5, other: 5.5 }, { min: 20, white: 3.5, other: 3.85 },
  { min: 50, white: 2.9, other: 3.2 }, { min: 100, white: 2.5, other: 2.75 },
];
const TSHIRT_CUORE_TIERS = [
  { min: 1, price: 14 }, { min: 2, price: 10 }, { min: 5, price: 5 },
  { min: 10, price: 4 }, { min: 20, price: 3.5 }, { min: 50, price: 2.5 }, { min: 100, price: 2.2 },
];
const TSHIRT_AREA_TABLE = [
  [12,12,12,13,14,14,14,16,16,16,17,18],[12,12,13,14,14,14,16,16,16,17,18,18],
  [12,13,14,14,14,16,16,16,17,18,18,19],[13,14,14,14,16,16,16,17,18,20.5,22.5,25],
  [14,14,14,16,16,16,17,18,19,22,24.75,26],[14,14,16,16,16,17,18,20,22,25,28,28],
  [14,16,16,16,17,18,20,22,24,26,28,30],[16,16,16,17,18,20,22,24,26,28,30,32],
  [16,16,17,18,19,22,24,26,28,30,32,34],[16,17,18,20.5,22,25,26,28,30,32,34,36],
  [17,18,18,22.5,24.75,28,28,30,32,34,36,38],[18,18,19,25,26,28,30,32,34,36,38,40],
];
const TSHIRT_DISCOUNT_TIERS = [
  { min: 1, mult: 1 }, { min: 2, mult: 0.67 }, { min: 5, mult: 0.61 },
  { min: 10, mult: 0.56 }, { min: 20, mult: 0.44 }, { min: 50, mult: 0.39 }, { min: 100, mult: 0.33 },
];
const POLO_PRICE_TIERS = [
  { min: 1, price: 8 }, { min: 2, price: 7.5 }, { min: 5, price: 7 },
  { min: 10, price: 6.5 }, { min: 20, price: 6 }, { min: 50, price: 5.5 }, { min: 100, price: 5.2 },
];
const STAR_POLO_PRICE_TIERS = [
  { min: 1, price: 9 }, { min: 2, price: 8.5 }, { min: 5, price: 8 },
  { min: 10, price: 7.5 }, { min: 20, price: 7 }, { min: 50, price: 6.5 }, { min: 100, price: 5.95 },
];
function pickTier(tiers, qty) { let t = tiers[0]; for (const x of tiers) if (qty >= x.min) t = x; return t; }

const PRICING = {
  'tshirt': { nome: 'Maglietta Unisex 24H', type: 'tshirt',
    garmentUnitPrice: (qty, isWhite) => { const t = pickTier(TSHIRT_PRICE_TIERS, qty); return isWhite ? t.white : t.other; },
    cuoreUnitPrice: (qty) => pickTier(TSHIRT_CUORE_TIERS, qty).price,
    areaUnitPrice: (wIdx, hIdx) => TSHIRT_AREA_TABLE[wIdx][hIdx],
    discount: (qty) => pickTier(TSHIRT_DISCOUNT_TIERS, qty).mult },

  // Polo Austral — listino capi Austral (unico per tutti i colori); stampa = tariffe DTF t-shirt.
  // Polo Star — listino capi Star (tabella 1-1, unico per tutti i colori); stampa = tariffe DTF t-shirt.
  'star-polo': { nome: 'Polo Star', type: 'tshirt',
    garmentUnitPrice: (qty) => pickTier(STAR_POLO_PRICE_TIERS, qty).price,
    cuoreUnitPrice: (qty) => pickTier(TSHIRT_CUORE_TIERS, qty).price,
    areaUnitPrice: (wIdx, hIdx) => TSHIRT_AREA_TABLE[wIdx][hIdx],
    discount: (qty) => pickTier(TSHIRT_DISCOUNT_TIERS, qty).mult },

  'austral-polo': { nome: 'Polo Austral', type: 'tshirt',
    garmentUnitPrice: (qty) => pickTier(POLO_PRICE_TIERS, qty).price,
    cuoreUnitPrice: (qty) => pickTier(TSHIRT_CUORE_TIERS, qty).price,
    areaUnitPrice: (wIdx, hIdx) => TSHIRT_AREA_TABLE[wIdx][hIdx],
    discount: (qty) => pickTier(TSHIRT_DISCOUNT_TIERS, qty).mult },

  // Promozione 100 Magliette + Stampa — prezzi a matrice (IVA inclusa, magliette bianche;
  // colorate +10%, spedizione inclusa). Fonte: scheda prodotto printeurope.pro.
  'promo100': { nome: 'Promozione 100 Magliette + Stampa', type: 'promo100',
    qtyChoices: [50, 100],
    // Oltre i 100 pz il prezzo è lineare al prezzo unitario della fascia 100 (nessuno scaglione).
    maxQty: 1000,
    // colonne: c8 = 8×8cm · s10 = 25×10cm · s32 = 25×32cm · cr10 = 8×8 + 25×10 · cr32 = 8×8 + 25×32
    matrix: {
      50:  { c8: 145, s10: 186, s32: 290, cr10: 216, cr32: 365 },
      100: { c8: 260, s10: 343, s32: 570, cr10: 393, cr32: 620 },
    },
    printChoices: [
      { key: 'cuore_8x8', label: 'Cuore/manica 8×8 cm', col: 'c8' },
      { key: 'davanti_25x10', label: 'Davanti 25×10 cm', col: 's10' },
      { key: 'retro_25x10', label: 'Retro 25×10 cm', col: 's10' },
      { key: 'davanti_25x32', label: 'Davanti 25×32 cm', col: 's32' },
      { key: 'retro_25x32', label: 'Retro 25×32 cm', col: 's32' },
      { key: 'cuore_retro_25x10', label: 'Cuore + retro 25×10 cm', col: 'cr10' },
      { key: 'cuore_retro_25x32', label: 'Cuore + retro 25×32 cm', col: 'cr32' },
    ],
    coloredSurcharge: 1.1 },

  // Reconstructed 1:1 from the real Advanced Product Fields (Studio Wombat) config for this product.
  '197': { nome: 'Stampa Roll-Up 80/85 × 200 cm', type: 'formula',
    rollupRate: (qty) => (qty > 6 ? 20 : qty > 4 ? 25 : 30),
    strutturaRates: [30, 0], // index 0 = "Con struttura", 1 = "Solo stampa"
    rate24h: 10 },
  '5833': { nome: 'Stampa Roll-Up 200 × 200 cm', type: 'size', variants: ROLLUP_VARIANTS },
  '5850': { nome: 'Stampa Roll-Up 150 × 200 cm', type: 'formula',
    rollupRate: (qty) => (qty > 1 ? 90 : 95),
    strutturaRates: [255, 0], // index 0 = "Con struttura", 1 = "Solo stampa"
    rate24h: 0 },
  '5392': { nome: 'Volantini A5 gr 130', type: 'tiersDelivery',
    tiersByDelivery: [
      [{qty:100,price:33},{qty:250,price:36},{qty:500,price:41},{qty:1000,price:48},{qty:2500,price:74},{qty:5000,price:107},{qty:10000,price:166},{qty:20000,price:299},{qty:30000,price:440},{qty:40000,price:573},{qty:50000,price:712},{qty:60000,price:851},{qty:70000,price:990},{qty:80000,price:1119},{qty:90000,price:1257},{qty:100000,price:1395}],
      [{qty:100,price:66},{qty:250,price:69},{qty:500,price:74},{qty:1000,price:81},{qty:2500,price:107},{qty:5000,price:141},{qty:10000,price:204},{qty:20000,price:364},{qty:30000,price:527},{qty:40000,price:685},{qty:50000,price:848},{qty:60000,price:1012},{qty:70000,price:1176},{qty:80000,price:1330},{qty:90000,price:1492},{qty:100000,price:1655}],
    ] },
  '5560': { nome: 'Volantini A4 gr 170', type: 'tiers', tiers: [{qty:1000,price:82},{qty:2500,price:137},{qty:5000,price:236},{qty:10000,price:429},{qty:20000,price:804},{qty:30000,price:1163},{qty:40000,price:1596},{qty:50000,price:1937},{qty:60000,price:2249},{qty:70000,price:2614},{qty:80000,price:2972},{qty:90000,price:3361},{qty:100000,price:3600}] },
  '5840': { nome: 'Volantini A6 gr 130', type: 'tiersDelivery',
    tiersByDelivery: [
      [{qty:100,price:25},{qty:250,price:30},{qty:500,price:31},{qty:1000,price:35},{qty:2500,price:44},{qty:5000,price:67},{qty:10000,price:108},{qty:20000,price:190},{qty:30000,price:277},{qty:40000,price:346},{qty:50000,price:437},{qty:60000,price:526},{qty:70000,price:596},{qty:80000,price:687},{qty:90000,price:776},{qty:100000,price:847}],
      [{qty:100,price:56},{qty:250,price:60},{qty:500,price:65},{qty:1000,price:70},{qty:2500,price:82},{qty:5000,price:100},{qty:10000,price:142},{qty:20000,price:253},{qty:30000,price:368},{qty:40000,price:441},{qty:50000,price:550},{qty:60000,price:664},{qty:70000,price:737},{qty:80000,price:851},{qty:90000,price:964},{qty:100000,price:1040}],
    ] },
  '5723': { nome: 'Volantini 10×21 cm', type: 'tiersDelivery',
    tiersByDelivery: [
      [{qty:1000,price:35},{qty:2500,price:54},{qty:5000,price:83},{qty:10000,price:135},{qty:20000,price:238},{qty:30000,price:350},{qty:40000,price:458},{qty:50000,price:571},{qty:60000,price:683},{qty:70000,price:796},{qty:80000,price:909},{qty:90000,price:1022},{qty:100000,price:1114}],
      [{qty:1000,price:68},{qty:2500,price:87},{qty:5000,price:117},{qty:10000,price:170},{qty:20000,price:302},{qty:30000,price:442},{qty:40000,price:579},{qty:50000,price:709},{qty:60000,price:847},{qty:70000,price:985},{qty:80000,price:1123},{qty:90000,price:1260},{qty:100000,price:1352}],
    ] },
  '5398': { nome: 'Pieghevoli A4 a 2 Ante A5', type: 'tiersDelivery',
    tiersByDelivery: [
      [{qty:100,price:48},{qty:500,price:71},{qty:1000,price:89},{qty:2500,price:138},{qty:5000,price:236},{qty:10000,price:410},{qty:20000,price:769},{qty:30000,price:1169},{qty:40000,price:1563},{qty:50000,price:1902},{qty:60000,price:2315},{qty:70000,price:2784},{qty:80000,price:3037},{qty:90000,price:3427},{qty:100000,price:3619}],
      [{qty:100,price:81},{qty:500,price:105},{qty:1000,price:122},{qty:2500,price:173},{qty:5000,price:298},{qty:10000,price:500},{qty:20000,price:969},{qty:30000,price:1438},{qty:40000,price:1908},{qty:50000,price:2334},{qty:60000,price:2795},{qty:70000,price:3318},{qty:80000,price:3717},{qty:90000,price:4179},{qty:100000,price:4611}],
    ] },
  '5794': { nome: 'Pieghevoli A4 a 3 Ante 10×21 cm', type: 'tiersDelivery',
    tiersByDelivery: [
      [{qty:100,price:55},{qty:500,price:70},{qty:1000,price:81},{qty:2500,price:142},{qty:5000,price:240},{qty:10000,price:433},{qty:20000,price:842},{qty:30000,price:1245},{qty:40000,price:1678},{qty:50000,price:2013},{qty:60000,price:2393},{qty:70000,price:2787},{qty:80000,price:3140},{qty:90000,price:3431},{qty:100000,price:3685}],
      [{qty:100,price:90},{qty:500,price:103},{qty:1000,price:115},{qty:2500,price:177},{qty:5000,price:304},{qty:10000,price:528},{qty:20000,price:1027},{qty:30000,price:1493},{qty:40000,price:2029},{qty:50000,price:2445},{qty:60000,price:2853},{qty:70000,price:3322},{qty:80000,price:3749},{qty:90000,price:4183},{qty:100000,price:4643}],
    ] },
  '5606': { nome: 'Locandine 70×100 cm', type: 'tiersDelivery',
    tiersByDelivery: [
      [{qty:50,price:97},{qty:100,price:151},{qty:150,price:175},{qty:200,price:190},{qty:250,price:204},{qty:300,price:222},{qty:400,price:268},{qty:500,price:295},{qty:750,price:385},{qty:1000,price:454},{qty:1500,price:633},{qty:2000,price:792},{qty:3000,price:1118},{qty:4000,price:1437},{qty:5000,price:1770},{qty:6000,price:2104}],
      [{qty:50,price:129},{qty:100,price:183},{qty:150,price:222},{qty:200,price:236},{qty:250,price:236},{qty:300,price:254},{qty:400,price:325},{qty:500,price:352},{qty:750,price:466},{qty:1000,price:534},{qty:1500,price:768},{qty:2000,price:954},{qty:3000,price:1366},{qty:4000,price:1737},{qty:5000,price:2149},{qty:6000,price:2521}],
    ] },
  // Reconstructed 1:1 from the real APF config for this product (conditional Formato → Carta → Quantità chain).
  '5515': { nome: 'Biglietti da Visita Prezzi Strategici', type: 'businessCardStrategici',
    qtyLabels: [100,250,500,1000,2500,5000,10000,15000,20000],
    formats: [
      { label: 'Orizzontale 5,5×8,5 cm', papers: [
        { label: 'gr. 300 (classico)', deliveries: [
          { label: '1 Settimana', prices: [35,37,40,45,54,71,105,136,165] },
          { label: '2 Giorni lavorativi', prices: [67,69,73,78,87,104,137,169,198] },
        ] },
        { label: 'gr. 400', deliveries: [
          { label: '1 Settimana', prices: [39,43,45,49,58,78,116,153,203] },
          { label: '2 Giorni lavorativi', prices: [73,77,79,82,90,111,149,185,262] },
        ] },
        { label: 'gr. 500', deliveries: [ { label: '1 Settimana', prices: [39,42,44,48,56,73,109,142,176] } ] },
      ] },
      { label: 'Verticale 5,5×8,5 cm', papers: [
        { label: 'gr. 300 (classico)', deliveries: [
          { label: '1 Settimana', prices: [35,37,40,45,54,71,105,136,165] },
          { label: '2 Giorni lavorativi', prices: [67,69,73,78,87,104,137,169,198] },
        ] },
        { label: 'gr. 400', deliveries: [
          { label: '1 Settimana', prices: [39,43,45,49,58,78,116,153,203] },
          { label: '2 Giorni lavorativi', prices: [73,77,79,82,90,111,149,185,262] },
        ] },
        { label: 'gr. 500', deliveries: [ { label: '1 Settimana', prices: [39,42,44,48,56,73,109,142,176] } ] },
      ] },
      { label: 'Orizzontale 9×5 cm', papers: [
        { label: 'gr. 300 (classico)', deliveries: [
          { label: '1 Settimana', prices: [36,41,43,46,52,67,98,124,149] },
          { label: '2 Giorni lavorativi', prices: [68,75,76,79,85,100,131,157,182] },
        ] },
        { label: 'gr. 400', deliveries: [ { label: '1 Settimana', prices: [39,43,45,48,57,76,113,150,200] } ] },
        { label: 'gr. 500', deliveries: [ { label: '1 Settimana', prices: [39,42,44,48,56,73,109,142,176] } ] },
      ] },
      { label: 'Verticale 5×9 cm', papers: [
        { label: 'gr. 300 (classico)', deliveries: [
          { label: '1 Settimana', prices: [36,41,43,46,52,67,98,124,149] },
          { label: '2 Giorni lavorativi', prices: [68,75,76,79,85,100,131,157,182] },
        ] },
        { label: 'gr. 400', deliveries: [ { label: '1 Settimana', prices: [39,43,45,48,57,76,113,150,200] } ] },
        { label: 'gr. 500', deliveries: [ { label: '1 Settimana', prices: [39,42,44,48,56,73,109,142,176] } ] },
      ] },
      // Order of `formats` MUST match index.html exactly — the client sends a numeric
      // formatIndex, so a different order here charges the price of a different format.
      { label: 'Quadrato 5,5×5,5 cm', papers: [
        { label: 'gr. 300 (classico)', deliveries: [
          { label: '1 Settimana', prices: [34,39,41,41,45,56,78,97,114] },
          { label: '2 Giorni lavorativi', prices: [67,72,75,73,78,89,110,129,147] },
        ] },
        { label: 'gr. 400', deliveries: [ { label: '1 Settimana', prices: [37,40,41,43,49,62,89,115,138] } ] },
        { label: 'gr. 500', deliveries: [ { label: '1 Settimana', prices: [39,42,44,48,56,73,109,142,176] } ] },
      ] },
    ] },
  '198': { nome: 'Foto Quadro Personalizzato', type: 'fotoQuadro', basePrice: 30 },
  '199': { nome: 'Marilyn Monroe Warhol', type: 'size', variants: [
    { label: '50×40 cm', price: 48 },
    { label: '70×50 cm', price: 67 },
  ] },
  '200': { nome: 'Quadro Claude Monet', type: 'size', variants: [
    { label: '50×40 cm', price: 48 },
    { label: '70×50 cm', price: 67 },
  ] },
  '201': { nome: 'Quadro Van Gogh "Notte stellata"', type: 'size', variants: [
    { label: '50×40 cm', price: 48 },
    { label: '70×50 cm', price: 67 },
  ] },
  '203': { nome: 'Adesivi Prespaziati Personalizzati', type: 'flat', price: 15 },
  '206': { nome: 'Foto Libro Copertina Flessibile', type: 'flat', price: 15 },
  '209': { nome: '2 Adesivi Jeep Renegade Fango', type: 'flat', price: 49 },
  '210': { nome: '1 Paio di 2 Woodpecker Adesivi Prespaziati', type: 'flat', price: 32 },
  '212': { nome: 'Wall Stickers Sky Line Città Vinile', type: 'skylineFormato' },
  '213': { nome: 'Adesivi frasi romane per decorazione', type: 'imageSwatch', price: 24,
    swatches: ['Mejo','Iddio','Tutte le strade','Omo de Panza',"'ngrassa",'Napoli Orto','Faccia Tosta','A chi tocca'] },
  '214': { nome: 'Decalcomania Hollywood Sticker', type: 'imageSwatchQty', pricePerUnit: 24, defaultSwatchIdx: 2,
    swatches: ['James Dean','Madonna','Marilyn','Audrey','Swift'] },
  '214': { nome: 'Decalcomania Hollywood Sticker', type: 'flat', price: 20 },
  '215': { nome: 'Struttura Personalizzata per Eventi', type: 'strutturaEventi' },
  '216': { nome: 'Scatola Gioielli + stampa Oro/Argento', type: 'scatolaGioielli',
    misuraChoices: ['5x5x3cm','7x7x3cm','9x9x3cm','23x4,5x2,4cm','8x8x8cm','17x17x3cm'],
    misuraRate: [1.6, 1.8, 2.25, 2.4, 3.95, 4.35],
    coloreChoices: ['Oro Lucido','Argento Lucido','Bianco Opaco'],
  },
  '5805': { nome: 'Libretti Chiesa Personalizzati', type: 'libretti' },
  '284': { nome: 'Rilegature a spirale Roma EUR', type: 'rilegature',
    cartaChoices: ['gr. 80','gr. 100','gr. 200','gr. 300','gr. 350','gr. 400'],
    cartaRate: [0.042, 0.065, 0.125, 0.185, 0.215, 0.245],
  },
  '220': { nome: '2 Adesivi Jeep Renegade Stella Graffiata', type: 'flat', price: 23 },
  '221': { nome: '2 Adesivi Jeep Renegade Stella e Teschio', type: 'flat', price: 23 },
  '223': { nome: '2 Adesivi Jeep Renegade Logo', type: 'flat', price: 49 },
  '224': { nome: '2 Adesivi Jeep Renegade Logo + Montagna', type: 'flat', price: 52 },
  '225': { nome: '2 Adesivi Prespaziati Jeep Renegade Crossfit', type: 'flat', price: 32 },
  '226': { nome: '2 Adesivi Prespaziati Jeep Renegade Cavalli', type: 'flat', price: 32 },
  '227': { nome: 'Stampa Quadro Van Gogh Autoritratto', type: 'size', variants: [
    { label: '50×40 cm', price: 48 },
    { label: '70×50 cm', price: 67 },
  ] },
  '250': { nome: 'Locandine Stampate a Roma Eur 24H', type: 'locandine250',
    formatChoices: ['35 x 50 cm','50 x 70 cm','70 x 100 cm','A3','A2','A1','A0'],
    formatRates: [2.8,5.3,8.3,2.8,5.3,8,10],
    cartaChoices: ['Usomano gr 80','Usomano gr 180','Carta Sintetica gr 160'],
    cartaMultiplier: [0.8,1.1,1.4],
  },
  '5849': { nome: 'Quadro Pop Art Personalizzato Warhol', type: 'quadroWarhol' },
  '5047': { nome: 'Stampa Badge Personalizzati', type: 'badge' },
  '5047-en': { nome: 'Custom Printed Badges', type: 'badgeEn' },
  '202': { nome: 'Biglietti da visita a rilievo', type: 'businessCardRilievo',
    formats: [
      { label: 'Quadrato 5,5×5,5 cm', papers: [
        { label: 'gr. 350 offset', tiers: [{qty:250,price:72},{qty:500,price:92},{qty:1000,price:121},{qty:2500,price:211},{qty:5000,price:355},{qty:10000,price:681}] },
      ] },
      { label: 'Orizzontale 5,5×8,5 cm', papers: [
        { label: 'gr. 300 patinata opaca', tiers: [{qty:100,price:49},{qty:500,price:87},{qty:1000,price:99},{qty:2500,price:184},{qty:5000,price:308},{qty:10000,price:578},{qty:20000,price:1122}] },
        { label: 'gr. 350 offset', tiers: [{qty:250,price:72},{qty:500,price:92},{qty:1000,price:121},{qty:2500,price:211},{qty:5000,price:355},{qty:10000,price:681}] },
        { label: 'gr. 400 patinata opaca', tiers: [{qty:100,price:53},{qty:500,price:83},{qty:1000,price:119},{qty:2500,price:232},{qty:5000,price:424},{qty:10000,price:807},{qty:20000,price:1578}] },
      ] },
      { label: 'Verticale 5,5×8,5 cm', papers: [
        { label: 'gr. 300 patinata opaca', tiers: [{qty:100,price:49},{qty:500,price:87},{qty:1000,price:99},{qty:2500,price:184},{qty:5000,price:308},{qty:10000,price:578},{qty:20000,price:1122}] },
        { label: 'gr. 350 offset', tiers: [{qty:250,price:72},{qty:500,price:92},{qty:1000,price:121},{qty:2500,price:211},{qty:5000,price:355},{qty:10000,price:681}] },
        { label: 'gr. 400 patinata opaca', tiers: [{qty:100,price:53},{qty:500,price:83},{qty:1000,price:119},{qty:2500,price:232},{qty:5000,price:424},{qty:10000,price:807},{qty:20000,price:1578}] },
      ] },
      { label: 'Orizzontale 9×5 cm', papers: [
        { label: 'gr. 350 offset', tiers: [{qty:250,price:72},{qty:500,price:92},{qty:1000,price:121},{qty:2500,price:211},{qty:5000,price:355},{qty:10000,price:681}] },
      ] },
      { label: 'Verticale 5×9 cm', papers: [
        { label: 'gr. 350 offset', tiers: [{qty:250,price:72},{qty:500,price:92},{qty:1000,price:121},{qty:2500,price:211},{qty:5000,price:355},{qty:10000,price:681}] },
      ] },
    ] },
  '205': { nome: 'Biglietti da visita con oro/argento lucido', type: 'businessCardRilievo',
    colorChoices: ['Oro Lucido','Argento Lucido'],
    formats: [
      { label: 'Quadrato 5,5×5,5 cm', papers: [
        { label: 'gr. 300 patinata opaca', tiers: [{qty:100,price:68},{qty:250,price:94},{qty:500,price:116},{qty:1000,price:125},{qty:2500,price:132},{qty:5000,price:196},{qty:7500,price:271},{qty:10000,price:347}] },
        { label: 'gr. 400 patinata opaca', tiers: [{qty:100,price:75},{qty:250,price:102},{qty:500,price:122},{qty:1000,price:142},{qty:2500,price:132},{qty:5000,price:173},{qty:7500,price:226},{qty:10000,price:281}] },
      ] },
      { label: 'Orizzontale 8,5×5,5 cm', papers: [
        { label: 'gr. 300 patinata opaca', tiers: [{qty:100,price:86},{qty:250,price:115},{qty:500,price:142},{qty:1000,price:156},{qty:2500,price:176},{qty:5000,price:279},{qty:7500,price:396},{qty:10000,price:511}] },
        { label: 'gr. 400 patinata opaca', tiers: [{qty:100,price:94},{qty:250,price:125},{qty:500,price:151},{qty:1000,price:179},{qty:2500,price:176},{qty:5000,price:241},{qty:7500,price:326},{qty:10000,price:410}] },
      ] },
      { label: 'Orizzontale 9×5 cm', papers: [
        { label: 'gr. 300 patinata opaca', tiers: [{qty:100,price:84},{qty:250,price:113},{qty:500,price:139},{qty:1000,price:153},{qty:2500,price:171},{qty:5000,price:271},{qty:7500,price:383},{qty:10000,price:494}] },
        { label: 'gr. 400 patinata opaca', tiers: [{qty:100,price:92},{qty:250,price:122},{qty:500,price:148},{qty:1000,price:175},{qty:2500,price:173},{qty:5000,price:233},{qty:7500,price:316},{qty:10000,price:397}] },
      ] },
    ] },
  '217': { nome: 'Forex PVC Stampato', type: 'forexPvc',
    formats: ['30×40 cm', '40×60 cm', '50×70 cm', '70×100 cm'],
    spessoreChoices: ['2 mm', '5 mm'],
    stampaChoices: ['1 lato', '2 lati'],
    consegnaChoices: ['1 Settimana', '2 gg Lavorativi'],
    // rates[spessoreIdx][stampaIdx][consegnaIdx] -> [30x40,40x60,50x70,70x100]
    rates: [
      [ [ [31,35,43,58], [65,69,76,93] ],   // 2mm, 1 lato: [1 sett, 2gg]
        [ [32,36,44,67], [66,70,77,102] ] ], // 2mm, 2 lati: [1 sett, 2gg]
      [ [ [33,38,48,67], [67,72,81,102] ],  // 5mm, 1 lato: [1 sett, 2gg]
        [ [34,39,49,70], [67,73,83,105] ] ], // 5mm, 2 lati: [1 sett, 2gg]
    ],
  },
  '5720': { nome: 'Adesivo PVC 42×10 cm', type: 'tiersDelivery',
    tiersByDelivery: [
      [{qty:50,price:121},{qty:100,price:155},{qty:250,price:175},{qty:500,price:220},{qty:1000,price:257},{qty:2500,price:499},{qty:5000,price:945},{qty:7500,price:1387},{qty:10000,price:1834}],
      [{qty:50,price:156},{qty:100,price:191},{qty:250,price:210},{qty:500,price:255},{qty:1000,price:292},{qty:2500,price:533},{qty:5000,price:1004},{qty:7500,price:1472},{qty:10000,price:1943}],
    ] },
  '211': { nome: 'Adesivi per uso interno 24H', type: 'adesivoInterno',
    larghezza: { min:5, max:31, default:21 },
    altezza: { min:5, max:44, default:15 },
    qty: { min:50, max:2000, default:50 },
    sagomaChoices: ['No', 'Si'],
    sagomaMultiplier: [1, 1.4],
  },
  '203': { nome: 'Adesivi Prespaziati Personalizzati', type: 'adesiviPrespaziati',
    base: { min:5, max:300, default:14 },
    altezza: { min:5, max:52, default:6 },
    copie: { min:1, default:1 },
    lavorazioni: [
      { label: 'Sagomatura semplice', mult: 1 },
      { label: 'Prespaziato semplice', mult: 1.2 },
      { label: 'Prespaziato complesso', mult: 1.3 },
    ],
  },
  '218': { nome: 'Biglietti da visita 24H', type: 'bv24h',
    larghezza: { min:55, max:105, default:55 },
    altezza: { min:55, max:148, default:85 },
    qty: { min:50, max:1000, default:100 },
    latiMultiplier: [1, 1.5],
    latiChoices: ['1 lato', '2 lati'],
    cartaMultiplier: [1, 1.5, 1.9],
    cartaChoices: ['300', '350', '400'],
    soggettiMultiplier: [1,1.85,2.7,3.55,4.4,5.25,6.1,6.95,7.8,8.65],
    soggettiChoices: [1,2,3,4,5,6,7,8,9,10],
  },
};

module.exports = { PRICING, ANGOLI_ARROTONDATI_TIERS, angoliArrotondatiPrice };
