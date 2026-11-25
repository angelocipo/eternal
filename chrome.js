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
  // favicon on every page that loads chrome.js (replaces any older icon link)
  (function () {
    var h = document.head; if (!h) return;
    Array.prototype.forEach.call(h.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]'), function (l) { l.remove(); });
    [['icon', 'image/png', '/img/favicon-32.png', '32x32'], ['icon', 'image/png', '/img/favicon.png', '512x512'], ['apple-touch-icon', '', '/img/apple-touch-icon.png', '180x180']].forEach(function (d) {
      var l = document.createElement('link'); l.rel = d[0]; if (d[1]) l.type = d[1]; l.href = d[2]; l.sizes = d[3]; h.appendChild(l);
    });
  })();
  var LOGO = 'img/logo-ecj-header.png';
  var CART_HREF = 'checkout.html';

  // ---- the menu: edit here only ------------------------------------------------
  var NAV = [
    { key: 'bracelet', href: 'collection.html?type=bracelet', en: 'Bracelets', it: 'Bracciali' },
    { key: 'necklace', href: 'collection.html?type=necklace', en: 'Necklaces', it: 'Collane' },
    { key: 'pendant', href: 'collection.html?type=pendant', en: 'Pendants', it: 'Ciondoli' },
    { key: 'stone', href: 'collection.html?type=stone', en: 'Loose stones', it: 'Pietre sciolte' },
    { key: 'compendium', href: 'compendium.html', en: 'Compendium', it: 'Compendio' },
  ];

  var FOOTER = [
    { href: '/', en: 'Home', it: 'Home' },
    { href: 'compendium.html', en: 'Compendium', it: 'Compendio' },
    { href: 'journal.html', en: 'Journal', it: 'Diario' },
    { href: 'about.html', en: 'About', it: 'Chi siamo' },
    { href: 'contact.html', en: 'Contact', it: 'Contatti' },
    { href: 'size-guide.html', en: 'Size guide', it: 'Guida taglie' },
    { href: 'care-guide.html', en: 'Care guide', it: 'Cura' },
    { href: 'selling-conditions.html', en: 'Selling conditions', it: 'Condizioni di vendita' },
    { href: 'privacy-policy.html', en: 'Privacy', it: 'Privacy' },
  ];

  var TAGLINE = { en: 'Handcrafted Natural Gemstone Bracelets \u00b7 Rome, Italy', it: 'Bracciali artigianali in pietre naturali \u00b7 Roma, Italia' };

  // Maintenance notice: set on to false to remove it from every page.
  var MAINT = {
    on: false,
    en: 'Site in maintenance',
    it: 'Sito in manutenzione',
  };
  // ------------------------------------------------------------------------------

  var GOLD = '#cfd3da';
  var MUTED = '#a3abba';
  var ORANGE = '#d06f2b'; // accent, same as the homepage
  var LINE = 'rgba(185,190,200,', NAVBG = 'rgba(14,21,36,.96)', MAINTBG = '#1a2540';
  if (window.ECJ_PALETTE === 'gold') { GOLD = '#d4b572'; MUTED = '#b3ac9c'; LINE = 'rgba(198,166,103,'; NAVBG = 'rgba(21,18,13,.96)'; MAINTBG = '#221c12'; }
  var cartCount = 0;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  var MAINT_KEY = 'ecj-maintenance-dismissed';

  function maintDismissed() {
    try { return localStorage.getItem(MAINT_KEY) === '1'; } catch (e) { return false; }
  }

  function maintHtml() {
    if (!MAINT.on || maintDismissed()) return '';
    return '<div data-ecj-chrome="maint" style="background:' + MAINTBG + ';border-bottom:1px solid ' + LINE + '.22);">' +
      '<div style="max-width:1240px;margin:0 auto;padding:10px 28px;display:flex;align-items:center;justify-content:center;gap:16px;">' +
        '<span data-en="' + esc(MAINT.en) + '" data-it="' + esc(MAINT.it) + '" style="font-size:15px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:' + GOLD + ';text-align:center;">' + esc(MAINT.en) + '</span>' +
        '<button type="button" data-ecj-maint-close aria-label="Close" style="flex:0 0 auto;cursor:pointer;border:none;background:transparent;color:' + MUTED + ';font-family:inherit;line-height:0;padding:4px;">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function navHtml(current) {
    var links = NAV.map(function (n) {
      var on = n.key === current;
      return '<a href="' + esc(n.href) + '"' + (on ? ' aria-current="page"' : '') +
        ' data-en="' + esc(n.en) + '" data-it="' + esc(n.it) + '"' +
        ' style="color:' + (on ? GOLD : MUTED) + ';text-decoration:none;">' + esc(n.en) + '</a>';
    }).join('');

    return maintHtml() + '<nav data-ecj-chrome="nav" style="position:sticky;top:0;z-index:30;background:' + NAVBG + ';backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid ' + LINE + '.16);">' +
      '<div style="max-width:1240px;margin:0 auto;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;">' +
        '<a href="/" style="display:block;flex:0 0 auto;"><img src="' + LOGO + '" alt="Eternal City Jewelry" style="height:40px;width:auto;display:block;"></a>' +
        '<div style="display:flex;gap:22px;flex-wrap:wrap;font-size:11px;letter-spacing:.2em;text-transform:uppercase;">' + links + '</div>' +
        '<div style="display:flex;align-items:center;gap:16px;flex:0 0 auto;">' +
          '<button type="button" data-ecj-search aria-label="Search stones" title="Search stones" style="cursor:pointer;border:none;background:transparent;color:' + MUTED + ';padding:4px;line-height:0;">' +
            '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.6-3.6"></path></svg>' +
          '</button>' +
          '<a href="' + CART_HREF + '" data-ecj-cart style="display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:' + MUTED + ';text-decoration:none;cursor:pointer;">' +
            '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path></svg>' +
            '<span data-en="Cart" data-it="Carrello">Cart</span>' +
            '<span data-ecj-cart-count style="color:' + ORANGE + ';">(' + cartCount + ')</span>' +
          '</a>' +
          '<span style="display:flex;border:1px solid ' + LINE + '.3);border-radius:2px;overflow:hidden;">' +
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

    return '<div data-ecj-chrome="footer" style="border-top:1px solid ' + LINE + '.16);text-align:center;padding:56px 28px;">' +
      '<img src="img/logo-ecj-stacked.png" alt="Eternal City Jewelry" style="width:100%;max-width:200px;height:auto;display:block;margin:0 auto;">' +
      '<span aria-hidden="true" style="display:block;width:6px;height:6px;background:' + ORANGE + ';transform:rotate(45deg);margin:18px auto 0;"></span>' +
      '<div data-en="' + esc(TAGLINE.en) + '" data-it="' + esc(TAGLINE.it) + '" style="font-size:10.5px;letter-spacing:.3em;text-transform:uppercase;color:' + GOLD + ';margin-top:16px;">' + esc(TAGLINE.en) + '</div>' +
      newsletterHtml() +
      '<div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;margin-top:26px;font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;">' + links + '</div>' +
    '</div>';
  }

  // Newsletter signup (footer of every page). Sends to /api/newsletter, which emails a
  // confirmation link: nobody is on the list until they click it (double opt-in).
  function newsletterHtml() {
    return '<form id="newsletter" data-ecj-newsletter novalidate style="max-width:460px;margin:34px auto 0;">' +
      '<div data-en="Newsletter" data-it="Newsletter" style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:24px;color:#e6e9ee;">Newsletter</div>' +
      '<div data-en="New pieces and journal stories from Rome, once a week." data-it="Nuovi gioielli e storie del diario da Roma, una volta a settimana." style="font-size:13px;color:' + MUTED + ';margin-top:6px;">New pieces and journal stories from Rome, once a week.</div>' +
      '<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;justify-content:center;">' +
        '<input type="email" name="email" required autocomplete="email" aria-label="Email" placeholder="Your email" data-en-placeholder="Your email" data-it-placeholder="La tua email" style="flex:1 1 220px;min-width:0;background:transparent;border:1px solid ' + LINE + '.32);border-radius:2px;color:#eef0f4;font-family:inherit;font-size:14px;padding:12px 14px;outline:none;">' +
        '<input type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;">' +
        '<button type="submit" data-en="Subscribe" data-it="Iscriviti" style="flex:0 0 auto;cursor:pointer;border:none;background:' + GOLD + ';color:#0e1524;font-family:inherit;font-size:11px;letter-spacing:.22em;text-transform:uppercase;padding:12px 22px;border-radius:2px;">Subscribe</button>' +
      '</div>' +
      '<div data-ecj-newsletter-msg role="status" aria-live="polite" style="font-size:13px;color:' + GOLD + ';margin-top:12px;min-height:1px;"></div>' +
      '<div style="font-size:11.5px;color:#6f7889;margin-top:8px;line-height:1.6;"><span data-en="We will send a confirmation email. Unsubscribe at any time." data-it="Ti invieremo un\u2019email di conferma. Puoi disiscriverti quando vuoi.">We will send a confirmation email. Unsubscribe at any time.</span> <a href="privacy-policy.html" data-en="Privacy" data-it="Privacy" style="color:' + MUTED + ';">Privacy</a></div>' +
    '</form>';
  }

  // Newsletter popup: appears shortly after the page opens and fades away by itself after
  // 10 seconds (it stays while the visitor is typing in it). Shown at most once every 7 days,
  // never again after subscribing, and never on checkout / thank-you / review pages.
  var NL_KEY = 'ecj-nl-popup';
  var NL_DELAY = 1500, NL_SHOW = 10000, NL_GAP = 7 * 24 * 3600 * 1000;
  function nlPopupAllowed() {
    if (/checkout|grazie|review|api\//.test(location.pathname)) return false;
    try {
      var v = localStorage.getItem(NL_KEY);
      if (v === 'subscribed') return false;
      if (v && Date.now() - Number(v) < NL_GAP) return false;
    } catch (e) {}
    return true;
  }
  function nlPopupHtml() {
    return '<button type="button" data-ecj-nlpop-close aria-label="Close" style="position:absolute;top:8px;right:8px;cursor:pointer;border:none;background:transparent;color:' + MUTED + ';line-height:0;padding:6px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>' +
      '<form data-ecj-newsletter novalidate>' +
        '<div data-en="Newsletter" data-it="Newsletter" style="font-size:10.5px;letter-spacing:.3em;text-transform:uppercase;color:' + ORANGE + ';">Newsletter</div>' +
        '<div data-en="Stones with a soul, every week" data-it="Pietre con un’anima, ogni settimana" style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:24px;line-height:1.15;color:#eef0f4;margin-top:6px;">Stones with a soul, every week</div>' +
        '<div data-en="New pieces and journal stories from Rome, once a week." data-it="Nuovi gioielli e storie del diario da Roma, una volta a settimana." style="font-size:12.5px;color:' + MUTED + ';margin-top:6px;line-height:1.5;">New pieces and journal stories from Rome, once a week.</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          '<input type="email" name="email" required autocomplete="email" aria-label="Email" placeholder="Your email" data-en-placeholder="Your email" data-it-placeholder="La tua email" style="flex:1 1 auto;min-width:0;background:transparent;border:1px solid ' + LINE + '.32);border-radius:2px;color:#eef0f4;font-family:inherit;font-size:14px;padding:10px 12px;outline:none;">' +
          '<input type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;">' +
          '<button type="submit" data-en="Subscribe" data-it="Iscriviti" style="flex:0 0 auto;cursor:pointer;border:none;background:' + GOLD + ';color:#0e1524;font-family:inherit;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;padding:10px 14px;border-radius:2px;">Subscribe</button>' +
        '</div>' +
        '<div data-ecj-newsletter-msg role="status" aria-live="polite" style="font-size:12.5px;color:' + GOLD + ';margin-top:10px;min-height:1px;"></div>' +
        '<div style="font-size:11px;color:#6f7889;margin-top:4px;line-height:1.5;"><span data-en="Confirmation by email. Unsubscribe at any time." data-it="Conferma via email. Puoi disiscriverti quando vuoi.">Confirmation by email. Unsubscribe at any time.</span> <a href="privacy-policy.html" data-en="Privacy" data-it="Privacy" style="color:' + MUTED + ';">Privacy</a></div>' +
      '</form>' +
      '<div data-ecj-nlpop-bar aria-hidden="true" style="position:absolute;left:0;bottom:0;height:2px;width:100%;background:' + ORANGE + ';transform-origin:left;"></div>';
  }
  function closeNlPopup(fast) {
    var o = document.getElementById('ecj-nlpop');
    if (!o || o.getAttribute('data-closing')) return;
    o.setAttribute('data-closing', '1');
    clearTimeout(o._t);
    o.style.transition = 'opacity ' + (fast ? '.3s' : '1.2s') + ' ease, transform ' + (fast ? '.3s' : '1.2s') + ' ease';
    o.style.opacity = '0';
    o.style.transform = 'translateY(8px)';
    setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, fast ? 320 : 1250);
  }
  function openNlPopup() {
    if (document.getElementById('ecj-nlpop') || !nlPopupAllowed()) return;
    try { localStorage.setItem(NL_KEY, String(Date.now())); } catch (e) {}
    var o = document.createElement('div');
    o.id = 'ecj-nlpop';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-label', 'Newsletter');
    o.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483001;width:340px;max-width:calc(100vw - 32px);box-sizing:border-box;' +
      'background:' + NAVBG + ';border:1px solid ' + LINE + '.25);border-top:2px solid ' + ORANGE + ';padding:20px 20px 18px;box-shadow:0 18px 50px rgba(0,0,0,.45);' +
      'font-family:Jost,\'Helvetica Neue\',Arial,sans-serif;opacity:0;transform:translateY(12px);transition:opacity .5s ease,transform .5s ease;overflow:hidden;';
    o.innerHTML = nlPopupHtml();
    document.body.appendChild(o);
    var bar = o.querySelector('[data-ecj-nlpop-bar]');
    requestAnimationFrame(function () {
      o.style.opacity = '1'; o.style.transform = 'none';
      if (bar) { bar.style.transition = 'transform ' + NL_SHOW + 'ms linear'; bar.style.transform = 'scaleX(0)'; }
    });
    // 10-second timer; paused while the visitor is typing, restarted when they leave the field.
    function arm() { clearTimeout(o._t); o._t = setTimeout(function () { closeNlPopup(false); }, NL_SHOW); }
    arm();
    o.addEventListener('focusin', function () { clearTimeout(o._t); if (bar) { bar.style.transition = 'none'; bar.style.opacity = '0'; } });
    o.addEventListener('focusout', function () { setTimeout(function () { if (!o.contains(document.activeElement) && !o.getAttribute('data-done')) arm(); }, 50); });
    o.addEventListener('click', function (e) { if (e.target.closest('[data-ecj-nlpop-close]')) closeNlPopup(true); });
  }
  // After a successful signup (popup or footer) the popup never shows again.
  window.ecjNewsletterDone = function (form) {
    try { localStorage.setItem(NL_KEY, 'subscribed'); } catch (e) {}
    var o = document.getElementById('ecj-nlpop');
    if (o && form && o.contains(form)) { o.setAttribute('data-done', '1'); clearTimeout(o._t); setTimeout(function () { closeNlPopup(false); }, 5000); }
  };

  function nlMsg(form, en, it) {
    var m = form.querySelector('[data-ecj-newsletter-msg]');
    var it_ = typeof window.tsLang === 'function' && window.tsLang() === 'it';
    if (m) m.textContent = it_ ? it : en;
  }
  document.addEventListener('submit', function (e) {
    var form = e.target && e.target.closest ? e.target.closest('[data-ecj-newsletter]') : null;
    if (!form) return;
    e.preventDefault();
    var email = (form.email.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { nlMsg(form, 'Please enter a valid email address.', 'Inserisci un indirizzo email valido.'); return; }
    var btn = form.querySelector('button'); if (btn) btn.disabled = true;
    nlMsg(form, 'Sending\u2026', 'Invio\u2026');
    fetch('/api/newsletter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, company: form.company.value, source: location.pathname, lang: (typeof window.tsLang === 'function' ? window.tsLang() : 'en') }),
    }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); }).then(function (x) {
      if (x.d && x.d.ok) { form.email.value = ''; if (window.ecjNewsletterDone) window.ecjNewsletterDone(form); nlMsg(form, 'Almost done: check your inbox and click the link to confirm.', 'Quasi fatto: controlla la tua casella e clicca il link per confermare.'); }
      else if (x.s === 429) nlMsg(form, 'Too many attempts. Please try again later.', 'Troppi tentativi. Riprova pi\u00f9 tardi.');
      else if (x.d && x.d.error === 'invalid_email') nlMsg(form, 'Please enter a valid email address.', 'Inserisci un indirizzo email valido.');
      else nlMsg(form, 'Something went wrong. Please try again later.', 'Qualcosa \u00e8 andato storto. Riprova pi\u00f9 tardi.');
    }).catch(function () { nlMsg(form, 'Something went wrong. Please try again later.', 'Qualcosa \u00e8 andato storto. Riprova pi\u00f9 tardi.'); })
      .then(function () { if (btn) btn.disabled = false; });
  });

  // Stone search (magnifier in the menu): searches data/stones.json by name, meaning and
  // alternative names, and links to /stones/<slug>. With nothing typed it lists every stone.
  var stonesList = null;
  function fold(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function loadStones() {
    if (stonesList) return Promise.resolve(stonesList);
    return fetch('/data/stones.json').then(function (r) { return r.json(); }).then(function (d) {
      var l = Array.isArray(d) ? d : (d.stones || []);
      stonesList = l.filter(function (x) { return x && x.slug && x.name; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (x) { return { slug: x.slug, name: x.name, meaning: x.meaning || '', img: x.img || '', key: fold([x.name, x.slug, x.meaning, (x.match || []).join(' ')].join(' ')) }; });
      return stonesList;
    });
  }
  function searchResults(q) {
    var box = document.querySelector('[data-ecj-search-results]');
    if (!box) return;
    if (!stonesList) { box.innerHTML = '<div style="padding:14px 4px;color:' + MUTED + ';">\u2026</div>'; return; }
    var words = fold(q).split(' ').filter(Boolean);
    var hits = stonesList.filter(function (x) { return words.every(function (w) { return x.key.indexOf(w) > -1; }); });
    if (!hits.length) { box.innerHTML = '<div style="padding:14px 4px;color:' + MUTED + ';">No stones found \u00b7 Nessuna pietra trovata</div>'; return; }
    box.innerHTML = hits.map(function (x) {
      return '<a href="/stones/' + encodeURIComponent(x.slug) + '" style="display:flex;align-items:center;gap:14px;padding:10px 4px;border-bottom:1px solid ' + LINE + '.12);text-decoration:none;">' +
        (x.img ? '<img src="/' + esc(String(x.img).replace(/^\.?\//, '')) + '" alt="" loading="lazy" style="width:42px;height:42px;object-fit:cover;border-radius:50%;flex:0 0 auto;">' : '') +
        '<span><span style="display:block;color:' + GOLD + ';font-size:15px;">' + esc(x.name) + '</span>' +
        (x.meaning ? '<span style="display:block;color:' + MUTED + ';font-size:12px;margin-top:2px;">' + esc(x.meaning) + '</span>' : '') + '</span></a>';
    }).join('');
  }
  function closeSearch() { var o = document.getElementById('ecj-search'); if (o) o.parentNode.removeChild(o); }
  function openSearch() {
    if (document.getElementById('ecj-search')) return;
    var o = document.createElement('div');
    o.id = 'ecj-search';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-label', 'Search stones');
    o.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(6,10,18,.72);display:flex;justify-content:center;align-items:flex-start;padding:70px 16px 16px;';
    o.innerHTML = '<div data-ecj-search-panel style="width:100%;max-width:560px;max-height:calc(100vh - 100px);display:flex;flex-direction:column;background:' + NAVBG + ';border:1px solid ' + LINE + '.25);border-top:2px solid ' + ORANGE + ';padding:18px 20px;box-shadow:0 20px 60px rgba(0,0,0,.5);">' +
      '<div style="display:flex;align-items:center;gap:10px;border-bottom:1px solid ' + LINE + '.3);padding-bottom:10px;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="' + ORANGE + '" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.6-3.6"></path></svg>' +
        '<input type="text" enterkeyhint="search" data-ecj-search-input placeholder="Search stones \u00b7 Cerca pietre" autocomplete="off" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:' + GOLD + ';font-family:inherit;font-size:17px;padding:4px 0;">' +
        '<button type="button" data-ecj-search-close aria-label="Close" style="cursor:pointer;border:none;background:transparent;color:' + MUTED + ';line-height:0;padding:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>' +
      '</div>' +
      '<div data-ecj-search-results style="overflow-y:auto;margin-top:6px;"></div></div>';
    document.body.appendChild(o);
    var input = o.querySelector('[data-ecj-search-input]');
    input.addEventListener('input', function () { searchResults(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var a = o.querySelector('[data-ecj-search-results] a'); if (a) location.href = a.href; }
    });
    o.addEventListener('click', function (e) { if (!e.target.closest('[data-ecj-search-panel]') || e.target.closest('[data-ecj-search-close]')) closeSearch(); });
    searchResults('');
    loadStones().then(function () { searchResults(input.value); }, function () {
      var box = o.querySelector('[data-ecj-search-results]'); if (box) box.innerHTML = '<div style="padding:14px 4px;color:' + MUTED + ';">Search unavailable</div>';
    });
    setTimeout(function () { input.focus(); }, 30);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSearch(); });

  // Small orange accents on every page: active/hover menu links, footer links, text selection, keyboard focus.
  var CSS = '[data-ecj-chrome="nav"] [data-ecj-search]:hover,#ecj-search a:hover span span:first-child{color:' + ORANGE + ' !important;}'
    + '#ecj-search input::placeholder{color:' + MUTED + ';opacity:.7;}'
    + '[data-ecj-chrome="nav"] a[data-en]:hover,[data-ecj-chrome="footer"] a:hover{color:' + ORANGE + ' !important;}'
    + '[data-ecj-newsletter] input[type=email]:focus{border-color:' + ORANGE + ' !important;}[data-ecj-newsletter] input::placeholder{color:#6f7889;}[data-ecj-newsletter] button:disabled{opacity:.6;cursor:default;}'
    + '[data-ecj-chrome="nav"] a[aria-current]{box-shadow:inset 0 -2px 0 ' + ORANGE + ';padding-bottom:5px;}'
    + '::selection{background:' + ORANGE + ';color:#fff;}'
    + 'h1 em,h2 em{color:' + ORANGE + ';}'
    + 'a:focus-visible,button:focus-visible{outline:2px solid ' + ORANGE + ' !important;outline-offset:3px;}'
    + '@media(max-width:820px){'
    + '[data-ecj-chrome="nav"] > div{padding:10px 16px !important;gap:10px !important;row-gap:10px !important;}'
    + '[data-ecj-chrome="nav"] img{height:20px !important;}'
    + '[data-ecj-chrome="nav"] a[data-en]{font-size:10px !important;}'
    + '[data-ecj-chrome="nav"] > div > div:nth-child(2){gap:12px !important;order:3;width:100%;justify-content:center;}'
    + '[data-ecj-chrome="nav"] > div > div:last-child{gap:10px !important;}'
    + '}'
    + '#ecj-nlpop input[type=email]:focus{border-color:' + ORANGE + ' !important;}#ecj-nlpop input::placeholder{color:#6f7889;}'
    + '@media(max-width:600px){#ecj-nlpop{left:16px !important;right:16px !important;width:auto !important;bottom:auto !important;top:12px !important;}}'
    + '@media(max-width:480px){'
    + '[data-ecj-chrome="nav"] > div{padding:8px 12px !important;}'
    + '[data-ecj-chrome="nav"] > div > div:nth-child(2){gap:9px !important;letter-spacing:.12em !important;}'
    + '[data-ecj-chrome="nav"] a[data-en]{font-size:9.5px !important;}'
    + '[data-ecj-chrome="nav"] [data-ecj-cart] span[data-en]{display:none;}'
    + '#ecj-search{padding-top:56px !important;}'
    + '[data-ecj-chrome="maint"] > div{padding:8px 12px !important;gap:8px !important;}'
    + '[data-ecj-chrome="maint"] span{font-size:12.5px !important;letter-spacing:.18em !important;}'
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
    var close = e.target.closest ? e.target.closest('[data-ecj-maint-close]') : null;
    if (close) {
      try { localStorage.setItem(MAINT_KEY, '1'); } catch (err) {}
      var bars = document.querySelectorAll('[data-ecj-chrome="maint"]');
      for (var k = 0; k < bars.length; k++) bars[k].parentNode.removeChild(bars[k]);
      return;
    }
    if (e.target.closest && e.target.closest('[data-ecj-search]')) { e.preventDefault(); openSearch(); return; }
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
    setTimeout(openNlPopup, NL_DELAY);
    // Design Components stream their markup in, so the placeholders can appear late.
    new MutationObserver(fill).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
