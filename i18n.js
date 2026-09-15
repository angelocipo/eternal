/* Bilingual IT/EN switch.
   Any element with data-en gets its text swapped; the Italian original is
   captured into data-it on first run so the swap is reversible.
   Also handles data-en-title / data-en-placeholder / data-en-aria for attributes.
   Survives React re-renders (Design Components) via a MutationObserver, and
   fires "ts:langchange" so page logic can retranslate its own dynamic strings. */
(function () {
  var KEY = 'ecj_lang';
  var DEFAULT = 'en';
  var ATTRS = [
    ['data-en-title', 'title', 'data-it-title'],
    ['data-en-placeholder', 'placeholder', 'data-it-placeholder'],
    ['data-en-aria', 'aria-label', 'data-it-aria'],
  ];

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      if (v === 'en' || v === 'it') return v;
      return DEFAULT;
    } catch (e) { return DEFAULT; }
  }
  function write(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) {}
  }

  var lang = read();
  var applying = false;

  function translate(root) {
    var nodes = root.querySelectorAll('[data-en]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.hasAttribute('data-it')) el.setAttribute('data-it', el.textContent);
      var next = lang === 'en' ? el.getAttribute('data-en') : el.getAttribute('data-it');
      if (el.textContent !== next) el.textContent = next;
    }
    for (var a = 0; a < ATTRS.length; a++) {
      var enAttr = ATTRS[a][0], target = ATTRS[a][1], itAttr = ATTRS[a][2];
      var list = root.querySelectorAll('[' + enAttr + ']');
      for (var j = 0; j < list.length; j++) {
        var node = list[j];
        if (!node.hasAttribute(itAttr)) node.setAttribute(itAttr, node.getAttribute(target) || '');
        var val = lang === 'en' ? node.getAttribute(enAttr) : node.getAttribute(itAttr);
        if (node.getAttribute(target) !== val) node.setAttribute(target, val);
      }
    }
  }

  function paintButtons() {
    var btns = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var on = b.getAttribute('data-lang') === lang;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.style.background = on ? 'var(--color-accent)' : 'transparent';
      b.style.color = on ? 'var(--color-bg)' : 'var(--color-neutral-700)';
      b.style.fontWeight = on ? '800' : '600';
    }
  }

  function apply() {
    if (applying) return;
    applying = true;
    translate(document);
    paintButtons();
    document.documentElement.lang = lang;
    applying = false;
  }

  function set(next) {
    if (next === lang) return;
    lang = next;
    write(lang);
    apply();
    window.dispatchEvent(new CustomEvent('ts:langchange', { detail: { lang: lang } }));
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-lang]') : null;
    if (!btn) return;
    e.preventDefault();
    set(btn.getAttribute('data-lang') === 'en' ? 'en' : 'it');
  });

  window.tsLang = function () { return lang; };

  function watch() {
    apply();
    var pending = null;
    var obs = new MutationObserver(function () {
      if (applying || pending) return;
      pending = requestAnimationFrame(function () { pending = null; apply(); });
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }
})();
