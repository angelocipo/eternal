/* Shared site chrome for Eternal City Jewelry — the equivalent of a PHP include.
   Every page carries only two placeholders:

     <div data-ecj-nav="compendium"></div>     (value = current section, optional)
     <div data-ecj-footer></div>

   and loads this file in <helmet>. Change the menu here, it changes everywhere.

   Cart: renders as a link to CART_HREF. A page with its own cart drawer can set
   window.ecjCartHandler = fn before/after load — the click then calls that instead,
   and window.ecjSetCartCount(n) updates the number.

   i18n.js translates the injected markup on its own (it watches the DOM), so every
   label below carries data-en / data-it. */
(function () {
  var LOGO = 'img/logo-ecj-white.webp';
  var CART_HREF = 'checkout.dc.html';

  // ---- the menu: edit here only ------------------------------------------------
  var NAV = [
    { key: 'bracelet', href: 'collection.dc.html?type=bracelet', en: 'Bracelets', it: 'Bracciali' },
    { key: 'necklace', href: 'collection.dc.html?type=necklace', en: 'Necklaces', it: 'Collane' },
    { key: 'pendant', href: 'collection.dc.html?type=pendant', en: 'Pendants', it: 'Ciondoli' },
    { key: 'stone', href: 'collection.dc.html?type=stone', en: 'Loose stones', it: 'Pietre sciolte' },
    { key: 'compendium', href: 'Compendium.dc.html', en: 'Compendium', it: 'Compendio' },
  ];

  var FOOTER = [
    { href: 'index.dc.html', en: 'Home', it: 'Home' },
    { href: 'Compendium.dc.html', en: 'Compendium', it: 'Compendio' },
    { href: 'Journal.dc.html', en: 'Journal', it: 'Diario' },
    { href: 'about.dc.html', en: 'About', it: 'Chi siamo' },
    { href: 'contact.dc.html', en: 'Contact', it: 'Contatti' },
    { href: 'Eternal-City-Size-Guide.dc.html', en: 'Size guide', it: 'Guida taglie' },
    { href: 'Eternal-City-Care-Guide.dc.html', en: 'Care guide', it: 'Cura' },
    { href: 'privacy-policy.dc.html', en: 'Privacy', it: 'Privacy' },
  ];

  var TAGLINE = { en: 'Handcrafted Natural Gemstone Bracelets \u00b7 Rome, Italy', it: 'Bracciali artigianali in pietre naturali \u00b7 Roma, Italia' };
  // ------------------------------------------------------------------------------

  var GOLD = '#d4b572';
  var MUTED = '#b3ac9c';
  var cartCount = 0;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function navHtml(current) {
    var links = NAV.map(function (n) {
      var on = n.key === current;
      return '<a href="' + esc(n.href) + '"' + (on ? ' aria-current="page"' : '') +
        ' data-en="' + esc(n.en) + '" data-it="' + esc(n.it) + '"' +
        ' style="color:' + (on ? GOLD : MUTED) + ';text-decoration:none;">' + esc(n.en) + '</a>';
    }).join('');

    return '<nav data-ecj-chrome="nav" style="position:sticky;top:0;z-index:30;background:rgba(21,18,13,.96);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(198,166,103,.16);">' +
      '<div style="max-width:1240px;margin:0 auto;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;">' +
        '<a href="index.dc.html" style="display:block;flex:0 0 auto;"><img src="' + LOGO + '" alt="Eternal City Jewelry" style="height:26px;width:auto;display:block;"></a>' +
        '<div style="display:flex;gap:22px;flex-wrap:wrap;font-size:11px;letter-spacing:.2em;text-transform:uppercase;">' + links + '</div>' +
        '<div style="display:flex;align-items:center;gap:16px;flex:0 0 auto;">' +
          '<a href="' + CART_HREF + '" data-ecj-cart style="display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:' + MUTED + ';text-decoration:none;cursor:pointer;">' +
            '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path></svg>' +
            '<span data-en="Cart" data-it="Carrello">Cart</span>' +
            '<span data-ecj-cart-count style="color:' + GOLD + ';">(' + cartCount + ')</span>' +
          '</a>' +
          '<span style="display:flex;border:1px solid rgba(198,166,103,.3);border-radius:2px;overflow:hidden;">' +
            '<button type="button" data-lang="it" style="cursor:pointer;border:none;background:transparent;color:' + MUTED + ';font-family:inherit;font-size:10px;letter-spacing:.14em;padding:7px 10px;">IT</button>' +
            '<button type="button" data-lang="en" style="cursor:pointer;border:none;background:transparent;color:' + MUTED + ';font-family:inherit;font-size:10px;letter-spacing:.14em;padding:7px 10px;">EN</button>' +
          '</span>' +
        '</div>' +
      '</div>' +
    '</nav>';
  }

  function footerHtml() {
    var links = FOOTER.map(function (l) {
      return '<a href="' + esc(l.href) + '" data-en="' + esc(l.en) + '" data-it="' + esc(l.it) + '" style="color:' + MUTED + ';text-decoration:none;">' + esc(l.en) + '</a>';
    }).join('');

    return '<div data-ecj-chrome="footer" style="border-top:1px solid rgba(198,166,103,.16);text-align:center;padding:56px 28px;">' +
      '<img src="' + LOGO + '" alt="Eternal City Jewelry" style="width:100%;max-width:300px;height:auto;display:block;margin:0 auto;">' +
      '<div data-en="' + esc(TAGLINE.en) + '" data-it="' + esc(TAGLINE.it) + '" style="font-size:10.5px;letter-spacing:.3em;text-transform:uppercase;color:' + GOLD + ';margin-top:16px;">' + esc(TAGLINE.en) + '</div>' +
      '<div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;margin-top:26px;font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;">' + links + '</div>' +
    '</div>';
  }

  var CSS = '@media(max-width:820px){'
    + '[data-ecj-chrome="nav"] > div{padding:10px 16px !important;gap:10px !important;row-gap:10px !important;}'
    + '[data-ecj-chrome="nav"] img{height:20px !important;}'
    + '[data-ecj-chrome="nav"] a[data-en]{font-size:10px !important;}'
    + '[data-ecj-chrome="nav"] > div > div:nth-child(2){gap:12px !important;order:3;width:100%;justify-content:center;}'
    + '[data-ecj-chrome="nav"] > div > div:last-child{gap:10px !important;}'
    + '}'
    + '@media(max-width:480px){'
    + '[data-ecj-chrome="nav"] > div{padding:8px 12px !important;}'
    + '[data-ecj-chrome="nav"] > div > div:nth-child(2){gap:9px !important;letter-spacing:.12em !important;}'
    + '[data-ecj-chrome="nav"] a[data-en]{font-size:9.5px !important;}'
    + '[data-ecj-chrome="nav"] [data-ecj-cart] span[data-en]{display:none;}'
    + '[data-ecj-chrome="footer"]{padding:36px 20px !important;}'
    + '[data-ecj-chrome="footer"] > div:last-child{gap:14px !important;font-size:10.5px !important;}'
    + '}';

  function injectCss() {
    if (document.getElementById('ecj-chrome-css')) return;
    var s = document.createElement('style');
    s.id = 'ecj-chrome-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function fill() {
    injectCss();
    var navs = document.querySelectorAll('[data-ecj-nav]');
    for (var i = 0; i < navs.length; i++) {
      if (navs[i].firstElementChild) continue;
      navs[i].innerHTML = navHtml(navs[i].getAttribute('data-ecj-nav') || '');
    }
    var foots = document.querySelectorAll('[data-ecj-footer]');
    for (var j = 0; j < foots.length; j++) {
      if (foots[j].firstElementChild) continue;
      foots[j].innerHTML = footerHtml();
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-ecj-cart]') : null;
    if (!el || typeof window.ecjCartHandler !== 'function') return;
    e.preventDefault();
    window.ecjCartHandler(e);
  });

  window.ecjSetCartCount = function (n) {
    cartCount = Number(n) || 0;
    var s = document.querySelectorAll('[data-ecj-cart-count]');
    for (var i = 0; i < s.length; i++) s[i].textContent = '(' + cartCount + ')';
  };

  function start() {
    fill();
    // Design Components stream their markup in, so the placeholders can appear late.
    new MutationObserver(fill).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
