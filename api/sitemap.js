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

module.exports = (req, res) => {
  const out = [];
  for (const [loc, f, p] of STATIC) out.push(url(loc, CONTENT_UPDATED, f, p));
  for (const p of list(PRODUCTS, 'products')) if (p.published !== false) out.push(url('/bracelets/' + encodeURIComponent(p.slug), later(p.modified, CONTENT_UPDATED), 'monthly', '0.8'));
  for (const s of list(STONES, 'stones')) out.push(url('/stones/' + encodeURIComponent(s.slug), CONTENT_UPDATED, 'monthly', '0.7'));
  for (const p of list(POSTS, 'posts')) out.push(url('/journal/' + encodeURIComponent(p.slug), later(p.modified || p.date, CONTENT_UPDATED), 'yearly', '0.5'));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + out.join('\n') + '\n</urlset>\n');
};
