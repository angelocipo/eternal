// Vercel serverless function — serves product.html / post.html / category.html with the
// <title>, meta description, canonical, Open Graph and (for products) JSON-LD already in the
// HTML, so search engines and social previews see them without running JavaScript.
// The page itself is unchanged: same template file, same client-side rendering.
// Routed from vercel.json: /bracelets/<slug> → type=product, /journal/<slug> → type=post,
// /stones/<slug> → type=category. A <base href="/"> keeps the page's relative
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
// Static listing pages served through this function too (vercel.json: ?__page=<name>), only so
// crawlers get real links instead of template placeholders. Their <head> tags stay as written.
const STATIC = {
  collection: 'collection.dc.html', shop: 'Eternal-City-Shop.dc.html', journal: 'Journal.dc.html',
  lemurian: 'Lemurian-Category.dc.html', 'size-guide': 'Eternal-City-Size-Guide.dc.html',
};

const list = (d, k) => (Array.isArray(d) ? d : d[k] || Object.values(d));
const products = list(PRODUCTS, 'products');
const posts = list(POSTS, 'posts');
const stones = list(STONES, 'stones');

const cache = {};
function readFile(name) {
  if (!cache[name]) cache[name] = fs.readFileSync(path.join(process.cwd(), name), 'utf8');
  return cache[name];
}
function template(type) { return readFile(FILES[type]); }

// Inside <x-dc>, park template URLs (href="{{ … }}", src="{{ … }}") in data-dc-* attributes:
// crawlers without JavaScript no longer see them as broken links/images, and support.js
// (dcRestoreAttrs) puts them back before rendering, so visitors see no difference.
function parkTemplateUrls(html) {
  const a = html.indexOf('<x-dc>'), b = html.lastIndexOf('</x-dc>');
  if (a < 0 || b < a) return html;
  const mid = html.slice(a, b).replace(/\s(href|src|poster)="([^"]*\{\{[^"]*)"/g,
    (m, attr, val) => ` ${attr}="${attr === 'href' ? '#' : 'data:,'}" data-dc-${attr}="${val}"`);
  return html.slice(0, a) + mid + html.slice(b);
}

// Plain-HTML links and images for crawlers that don't run JavaScript (shown only without JS).
const rel = (u) => (!u ? '' : /^https?:\/\//.test(u) ? u : '/' + String(u).replace(/^\.?\//, ''));
const textPosts = () => posts.filter((x) => x.lead || (x.paras && x.paras.length));
function linkList(items) {
  return items.length ? '<ul>' + items.map(([href, label]) => `<li><a href="${esc(href)}">${esc(plain(label))}</a></li>`).join('') + '</ul>' : '';
}
function imgTags(list, alt) {
  return list.filter(Boolean).map((u) => `<img src="${esc(rel(u))}" alt="${esc(plain(alt))}" loading="lazy">`).join('');
}
function crawlBlock(type, key) {
  if (type === 'product') {
    const p = products.find((x) => x.slug === key);
    if (!p) return '';
    const cat = (p.cats || [])[0];
    const more = products.filter((x) => x !== p && x.published !== false && cat && (x.cats || []).includes(cat)).slice(0, 8);
    return imgTags((p.images || []).filter((u) => !/^https?:/.test(u)).slice(0, 6), p.name) +
      linkList([['/collection.html', 'The Collection'], ...more.map((x) => ['/bracelets/' + encodeURIComponent(x.slug), x.name])]);
  }
  if (type === 'post') {
    const list = textPosts();
    const i = list.findIndex((x) => x.slug === key);
    const p = posts.find((x) => x.slug === key);
    if (!p) return '';
    const old = p.oldLogo || [];
    const pics = [p.image, ...(p.images || [])].filter((u, j, a) => u && a.indexOf(u) === j && !old.includes(u));
    const links = [];
    if (i > 0) links.push(['/journal/' + encodeURIComponent(list[i - 1].slug), list[i - 1].title]);
    if (i > -1 && i < list.length - 1) links.push(['/journal/' + encodeURIComponent(list[i + 1].slug), list[i + 1].title]);
    links.push([p.stone ? '/collection.html?stone=' + encodeURIComponent(p.stone) : '/collection.html', 'Shop the collection']);
    links.push(['/journal.html', 'Journal'], ['/compendium.html', 'All stones']);
    return imgTags(pics.slice(0, 5), p.title) + linkList(links);
  }
  const st = stones.find((x) => x.slug === key);
  if (!st) return '';
  const items = stoneProducts(st);
  return imgTags([st.img], st.name) + linkList([...items.map((x) => ['/bracelets/' + encodeURIComponent(x.slug), x.name]), ['/compendium.html', 'All stones']]);
}
function staticCrawlBlock(page) {
  if (page === 'journal') return linkList(textPosts().map((x) => ['/journal/' + encodeURIComponent(x.slug), x.title]));
  if (page === 'size-guide') return linkList([['/collection.html', 'The Collection']]);
  const pub = products.filter((x) => x.published !== false);
  const list = page === 'lemurian' ? pub.filter((x) => /lemurian/i.test(x.name + ' ' + (x.cats || []).join(' '))) : pub;
  return linkList(list.map((x) => ['/bracelets/' + encodeURIComponent(x.slug), x.name]));
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
  return `${SITE}/stones/${k}`;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/bracelets?|necklaces?|jewelry|pendants?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
// Same matching rule as category.dc.html, so the schema lists exactly the products shown.
function stoneProducts(stone) {
  if (stone.showProducts === false) return [];
  const key = norm(stone.name);
  const keys = [key, ...(stone.match || []).map(norm)];
  const otherKeys = new Set(stones.filter((x) => x !== stone).map((x) => norm(x.name)));
  return products.filter((p) => p.published !== false).filter((p) =>
    [...(p.cats || []), ...(p.tags || [])].map(norm).some((h) => h && (keys.some((k) => h.includes(k)) || (key.includes(h) && !otherKeys.has(h)))));
}
function crumbs(items) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) };
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
      ogType: 'product', noindex: p.published === false, h1: plain(p.name),
      ld: [ld, crumbs([['Home', SITE + '/'], ['Collection', SITE + '/collection.html'], [plain(p.name), canonical]])],
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
    return { title: `${heading} — ${BRAND}`, description, canonical, image, ogType: 'article', h1: heading,
      ld: [ld, crumbs([['Home', SITE + '/'], ['Journal', SITE + '/journal.html'], [heading, canonical]])] };
  }
  const s = stones.find((x) => x.slug === key);
  if (!s) return null;
  const intro = Array.isArray(s.intro) ? s.intro.map((i) => i.text || '').join(' ') : s.intro;
  const name = plain(s.name);
  const title = `${name} Bracelets & Jewelry, Handmade in Rome | ${BRAND}`;
  const description = clip([s.sub, intro].filter(Boolean).join(' '));
  const items = stoneProducts(s);
  const page = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${name} Bracelets & Jewelry`,
    description, url: canonical, isPartOf: { '@type': 'WebSite', name: BRAND, url: SITE + '/' },
    mainEntity: { '@type': 'ItemList', numberOfItems: items.length,
      itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: urlFor('product', p.slug), name: plain(p.name) })) },
  };
  return { title, description, canonical, image: abs(s.img), ogType: 'website', h1: `${name} Bracelets & Jewelry`,
    ld: [page, crumbs([['Home', SITE + '/'], ['Compendium', SITE + '/compendium.html'], [name, canonical]])] };
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
    ...[].concat(m.ld || []).map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`),
  ];
  return t.filter(Boolean).join('\n');
}

module.exports = (req, res) => {
  const page = req.query.__page;
  if (page) {
    if (!STATIC[page]) { res.statusCode = 404; return res.end('Not found'); }
    let html;
    try { html = parkTemplateUrls(readFile(STATIC[page])); } catch (e) { res.statusCode = 500; return res.end('Template missing'); }
    const block = staticCrawlBlock(page);
    if (block) html = html.replace('<body>', '<body>\n<noscript>' + block + '</noscript>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
    return res.end(html);
  }
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
      noscript = `<noscript><h1>${esc(m.h1 || m.title)}</h1><p>${esc(m.description)}</p>${crawlBlock(type, String(key))}</noscript>`;
    }
    else { status = 404; head = `<title>Not found — ${BRAND}</title>\n<meta name="robots" content="noindex">`; }
  } else if (type !== 'product') {
    head = `<link rel="canonical" href="${SITE}/${type === 'post' ? 'journal' : 'compendium'}.html">`;
  }

  html = parkTemplateUrls(html);
  html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="/">' + (head ? '\n' + head : ''));
  if (noscript) html = html.replace('<body>', '<body>\n' + noscript);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  res.end(html);
};
