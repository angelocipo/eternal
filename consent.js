/* Cookie consent — Garante privacy (linee guida cookie 2021) + Google Consent Mode v2.
   GA4 parte subito in stato "denied" (ping anonimi, nessun cookie) e passa a "granted" solo
   dopo l'accettazione; il Pixel Meta viene caricato solo dopo l'accettazione.
   La scelta vive in localStorage sotto ts_cookie_consent ('granted' | 'denied').
   Riapri il banner con: window.tsCookiePreferences()
   Configurazione per pagina sul tag:
     <script defer src="consent.js" data-ga="G-XXXX" data-fbq="123456"></script> */
(function () {
  var KEY = 'ts_cookie_consent';
  var me = document.currentScript;
  var GA = (me && me.getAttribute('data-ga')) || '';
  var FBQ = (me && me.getAttribute('data-fbq')) || '';

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  // Consent Mode v2: GA is loaded immediately with every storage denied. In that state it sends
  // cookieless pings only — no identifiers, no profiling — and Google uses them for modelled
  // conversions. "Accetta" upgrades the same tag to granted.
  function loadGA() {
    if (!GA || window.__gaInit) return;
    window.__gaInit = 1;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
      functionality_storage: 'denied',
      personalization_storage: 'denied',
      security_storage: 'granted',
      wait_for_update: 500,
    });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GA);
  }

  function grantGA() {
    loadGA();
    if (!GA) return;
    window.gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
      functionality_storage: 'granted',
      personalization_storage: 'granted',
    });
  }

  function loadTrackers() {
    grantGA();
    if (FBQ && !window.__fbqInit) {
      window.__fbqInit = 1;
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', FBQ);
      window.fbq('track', 'PageView');
    }
  }

  function styleBtn(el, primary) {
    el.style.cssText = 'font:600 13px/1 Archivo,system-ui,sans-serif;padding:8px 14px;border:1px solid ' +
      (primary ? '#201e1d' : 'transparent') + ';background:' + (primary ? '#201e1d' : 'transparent') +
      ';color:' + (primary ? '#f3f2f2' : '#605d5d') + ';cursor:pointer;white-space:nowrap;';
  }

  function banner() {
    if (document.getElementById('ts-consent')) return;
    var wrap = document.createElement('div');
    wrap.id = 'ts-consent';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Preferenze cookie');
    wrap.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;max-width:420px;' +
      'background:#f3f2f2;border:1px solid #201e1d;padding:14px 16px;display:flex;gap:12px;' +
      'align-items:center;flex-wrap:wrap;';

    var txt = document.createElement('div');
    txt.style.cssText = 'font:400 12.5px/1.5 Archivo,system-ui,sans-serif;color:#201e1d;flex:1 1 200px;';
    txt.innerHTML = 'Cookie di statistica e marketing, attivi solo col tuo consenso. ' +
      '<a href="privacy-policy.dc.html" style="color:#ec3013;">Informativa</a>';

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;flex-wrap:nowrap;';

    var no = document.createElement('button');
    no.type = 'button'; no.textContent = 'Rifiuta'; styleBtn(no, false);
    no.onclick = function () { write('denied'); wrap.remove(); };

    var yes = document.createElement('button');
    yes.type = 'button'; yes.textContent = 'Accetta'; styleBtn(yes, true);
    yes.onclick = function () { write('granted'); wrap.remove(); loadTrackers(); };

    actions.appendChild(no); actions.appendChild(yes);
    wrap.appendChild(txt); wrap.appendChild(actions);
    (document.body || document.documentElement).appendChild(wrap);
  }

  window.tsCookiePreferences = function () { write(''); banner(); };

  var choice = read();
  loadGA(); // sempre, in stato denied — Consent Mode v2
  if (choice === 'granted') { loadTrackers(); return; }
  if (choice === 'denied') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner);
  else banner();
})();
