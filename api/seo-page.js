// Vercel serverless function — serves product.html / post.html / category.html with the
// <title>, meta description, canonical, Open Graph and (for products) JSON-LD already in the
// HTML, so search engines and social previews see them without running JavaScript.
// The page itself is unchanged: same template file, same client-side rendering.
// Routed from vercel.json: /bracelets/<slug> → type=product, /journal/<slug> → type=post,
// /category.html?stone=<slug> → type=category. A <base href="/"> keeps the page's relative
// asset paths working on the nested clean URLs.

const fs = require('fs');
const path = require('path');
const PRODUCTS = require('../data/products.json');
const POSTS = require('../data/posts.json');
const STONES = require('../data/stones.json');

const SITE = 'https://www.eternalcity.jewelry';
const BRAND = 'Eternal City Jewelry';
const FILES = { product: 'product.dc.html', post: 'Post.dc.html', category: 'category.dc.html' };
const PAGES = { product: 'product.html', post: 'post.html', category: 'category.html' };
const KEY = { product: 'slug', post: 'slug', category: 'stone' };

const list = (d, k) => (Array.isArray(d) ? d : d[k] || Object.values(d));
const products = list(PRODUCTS, 'products');
const posts = list(POSTS, 'posts');
const stones = list(STONES, 'stones');

const cache = {};
function template(type) {
  if (!cache[type]) cache[type] = fs.readFileSync(path.join(process.cwd(), FILES[type]), 'utf8');
  return cache[type];
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function decode(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function plain(s) {
  return decode(String(s || '').replace(/<[^>]+>/g, ' '))
    .replace(/\\n|\n/g, ' ')
    .replace(/What is [^?]{1,60}\? More info here\.?/gi, '')
    .replace(/More about [^.]{1,60} here\.?/gi, '')
    .replace(/Check out our complete collection here\.?/gi, '')
    .replace(/\(Due to [^)]*\)?/gi, '')
    .replace(/\s+/g, ' ').trim();
}
function clip(s, n = 155) {
  s = plain(s);
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:.\s]+$/, '') + '…';
}
function abs(u) {
  if (!u) return '';
  u = typeof u === 'string' ? u : u.src || u.url || '';
  if (!u) return '';
  return /^https?:\/\//.test(u) ? u : SITE + '/' + u.replace(/^\.?\//, '');
}

function urlFor(type, key) {
  const k = encodeURIComponent(key);
  if (type === 'product') return `${SITE}/bracelets/${k}`;
  if (type === 'post') return `${SITE}/journal/${k}`;
  return `${SITE}/${PAGES[type]}?${KEY[type]}=${k}`;
}

function meta(type, key) {
  const canonical = urlFor(type, key);
  if (type === 'product') {
    const p = products.find((x) => x.slug === key);
    if (!p) return null;
    const image = abs((p.images || [])[0]);
    const price = p.sale != null ? p.sale : p.price;
    const ld = {
      '@context': 'https://schema.org', '@type': 'Product', name: plain(p.name),
      description: clip(p.short || p.desc, 300), sku: p.sku || p.slug, url: canonical,
      brand: { '@type': 'Brand', name: BRAND },
      image: (p.images || []).slice(0, 5).map(abs).filter(Boolean),
      offers: {
        '@type': 'Offer', url: canonical, priceCurrency: 'EUR', price: String(price),
        availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
    };
    return {
      title: `${plain(p.name)} — ${BRAND}`, description: clip(p.short || p.desc), canonical, image,
      ogType: 'product', noindex: p.published === false, ld, h1: plain(p.name),
    };
  }
  if (type === 'post') {
    const p = posts.find((x) => x.slug === key);
    if (!p) return null;
    const title = plain(p.title);
    const heading = title.charAt(0).toUpperCase() + title.slice(1);
    const description = clip(p.lead || p.subtitle || (p.paras || [])[0]);
    const image = abs(p.image || (p.images || [])[0]);
    const ld = {
      '@context': 'https://schema.org', '@type': 'Article', headline: heading, description,
      url: canonical, mainEntityOfPage: canonical, image: image ? [image] : undefined,
      datePublished: p.date || undefined,
      author: { '@type': 'Organization', name: BRAND, url: SITE },
      publisher: { '@type': 'Organization', name: BRAND, logo: { '@type': 'ImageObject', url: SITE + '/img/logo-ecj-header.png' } },
    };
    return { title: `${heading} — ${BRAND}`, description, canonical, image, ogType: 'article', ld, h1: heading };
  }
  const s = stones.find((x) => x.slug === key);
  if (!s) return null;
  const intro = Array.isArray(s.intro) ? s.intro.map((i) => i.text || '').join(' ') : s.intro;
  return {
    title: `${plain(s.name)} Bracelets — Handmade in Rome — ${BRAND}`,
    description: clip([s.sub, intro].filter(Boolean).join(' ')), canonical,
    image: abs(s.img), ogType: 'website', h1: `${plain(s.name)} Bracelets`,
  };
}

function tags(m) {
  const t = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}">`,
    `<link rel="canonical" href="${esc(m.canonical)}">`,
    `<meta property="og:site_name" content="${BRAND}">`,
    `<meta property="og:type" content="${m.ogType}">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${esc(m.canonical)}">`,
    m.image && `<meta property="og:image" content="${esc(m.image)}">`,
    `<meta name="twitter:card" content="${m.image ? 'summary_large_image' : 'summary'}">`,
    m.noindex && `<meta name="robots" content="noindex, follow">`,
    m.ld && `<script type="application/ld+json">${JSON.stringify(m.ld).replace(/</g, '\\u003c')}</script>`,
  ];
  return t.filter(Boolean).join('\n');
}

module.exports = (req, res) => {
  const type = FILES[req.query.type] ? req.query.type : null;
  if (!type) { res.statusCode = 404; return res.end('Not found'); }
  let html;
  try { html = template(type); } catch (e) { res.statusCode = 500; return res.end('Template missing'); }

  const key = req.query[KEY[type]];
  let status = 200;
  let head = '';
  let noscript = '';
  if (key) {
    const m = meta(type, String(key));
    if (m) {
      head = tags(m);
      noscript = `<noscript><h1>${esc(m.h1 || m.title)}</h1><p>${esc(m.description)}</p></noscript>`;
    }
    else { status = 404; head = `<title>Not found — ${BRAND}</title>\n<meta name="robots" content="noindex">`; }
  } else if (type !== 'product') {
    head = `<link rel="canonical" href="${SITE}/${type === 'post' ? 'journal' : 'compendium'}.html">`;
  }

  html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="/">' + (head ? '\n' + head : ''));
  if (noscript) html = html.replace('<body>', '<body>\n' + noscript);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  res.end(html);
};
