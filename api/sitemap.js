// Vercel serverless function — /sitemap.xml, generated on request from the same data files the
// site reads, so new products, posts and stones appear automatically.
// lastmod: a post's own date when it has one, otherwise CONTENT_UPDATED (bump it when pages change).
const PRODUCTS = require('../data/products.json');
const POSTS = require('../data/posts.json');
const STONES = require('../data/stones.json');

const SITE = 'https://www.eternalcity.jewelry';
const CONTENT_UPDATED = '2026-10-30';
const STATIC = [
  ['/', 'weekly', '1.0'], ['/collection.html', 'weekly', '0.9'], ['/shop.html', 'weekly', '0.8'],
  ['/compendium.html', 'monthly', '0.8'], ['/journal.html', 'weekly', '0.7'], ['/about.html', 'monthly', '0.6'],
  ['/size-guide.html', 'yearly', '0.5'], ['/care-guide.html', 'yearly', '0.5'], ['/contact.html', 'yearly', '0.5'],
  ['/selling-conditions.html', 'yearly', '0.3'], ['/privacy-policy.html', 'yearly', '0.3'],
];
const list = (d, k) => (Array.isArray(d) ? d : d[k] || Object.values(d));
const later = (a, b) => (a && /^\d{4}-\d{2}-\d{2}/.test(a) && a.slice(0, 10) > b ? a.slice(0, 10) : b);
const url = (loc, lastmod, freq, pr) =>
  `  <url>\n    <loc>${SITE}${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pr}</priority>\n  </url>`;

// /merchant-feed.xml (vercel.json → /api/sitemap?feed=merchant): Google Merchant Center product
// feed, built from the same products.json, so prices and new pieces stay in sync on their own.
const xml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (t) => String(t || '').replace(/\\n|\n/g, ' ').replace(/<[^>]*>/g, ' ').replace(/More info here\.?/gi, '')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const absImg = (u) => (/^https?:\/\//.test(u) ? String(u) : SITE + '/' + String(u).replace(/^\.?\//, ''));
function gcat(p) {
  const all = [p.name, ...(p.cats || []), ...(p.tags || [])].join(' ').toLowerCase();
  if (p.loose) return '188';
  if (/necklace set|bracelet necklace/.test(all)) return '188';
  if (/pendant/.test(all)) return '192';
  if (/necklace/.test(all)) return '196';
  return '191';
}
function merchantFeed() {
  const seen = new Set();
  const items = [];
  for (const p of list(PRODUCTS, 'products')) {
    if (p.published === false || p.noShipping) continue;
    const imgs = (p.images || []).filter((u) => !/\.avif$/i.test(u));
    if (!imgs.length) continue;
    // Merchant Center ids max 50 chars: long slugs get a stable short hash instead of being cut.
    const raw = String(p.sku || p.slug);
    let id = raw.length <= 50 && !seen.has(raw) ? raw : 'ecj-' + require('crypto').createHash('md5').update(p.slug).digest('hex').slice(0, 16);
    if (seen.has(id)) continue;
    seen.add(id);
    const regular = Number(p.regular != null ? p.regular : p.price);
    const sale = p.sale != null && Number(p.sale) < regular ? Number(p.sale) : null;
    const desc = plain(p.desc) || plain(p.short) || plain(p.name);
    items.push(['    <item>',
      `      <g:id>${xml(id)}</g:id>`,
      `      <g:title>${xml(plain(p.name).slice(0, 150))}</g:title>`,
      `      <g:description>${xml(desc.slice(0, 5000))}</g:description>`,
      `      <g:link>${SITE}/bracelets/${encodeURIComponent(p.slug)}</g:link>`,
      `      <g:image_link>${xml(absImg(imgs[0]))}</g:image_link>`,
      ...imgs.slice(1, 11).map((u) => `      <g:additional_image_link>${xml(absImg(u))}</g:additional_image_link>`),
      `      <g:availability>${p.inStock ? 'in_stock' : 'out_of_stock'}</g:availability>`,
      `      <g:price>${regular.toFixed(2)} EUR</g:price>`,
      ...(sale != null ? [`      <g:sale_price>${sale.toFixed(2)} EUR</g:sale_price>`] : []),
      '      <g:condition>new</g:condition>',
      '      <g:brand>Eternal City Jewelry</g:brand>',
      '      <g:identifier_exists>no</g:identifier_exists>',
      `      <g:google_product_category>${gcat(p)}</g:google_product_category>`,
      ...((p.cats || []).length ? [`      <g:product_type>${xml((p.cats || []).join(' > ').slice(0, 750))}</g:product_type>`] : []),
      '    </item>'].join('\n'));
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n' +
    '    <title>Eternal City Jewelry</title>\n    <link>' + SITE + '/</link>\n    <description>Handmade gemstone jewelry from Rome</description>\n' +
    items.join('\n') + '\n  </channel>\n</rss>\n';
}

module.exports = (req, res) => {
  if (req.query && req.query.feed === 'merchant') {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.end(merchantFeed());
  }
  const out = [];
  for (const [loc, f, p] of STATIC) out.push(url(loc, CONTENT_UPDATED, f, p));
  for (const p of list(PRODUCTS, 'products')) if (p.published !== false) out.push(url('/bracelets/' + encodeURIComponent(p.slug), later(p.modified, CONTENT_UPDATED), 'monthly', '0.8'));
  for (const s of list(STONES, 'stones')) out.push(url('/stones/' + encodeURIComponent(s.slug), CONTENT_UPDATED, 'monthly', '0.7'));
  // Only Journal posts with text (same rule as the Journal page); empty posts are not listed.
  for (const p of list(POSTS, 'posts')) if (p.lead || (p.paras && p.paras.length)) out.push(url('/journal/' + encodeURIComponent(p.slug), later(p.modified || p.date, CONTENT_UPDATED), 'yearly', '0.5'));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + out.join('\n') + '\n</urlset>\n');
};
