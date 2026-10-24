/* Privacy notice — informational only. The site sets no tracking or marketing cookies,
   so no consent choice is needed; this shows a one-line notice once and remembers dismissal.
   Usage: <script defer src="consent.js"></script> */
(function () {
  var KEY = 'ecj_privacy_notice';
  try { if (localStorage.getItem(KEY)) return; } catch (e) {}
  function show() {
    if (document.getElementById('ecj-privacy')) return;
    var w = document.createElement('div');
    w.id = 'ecj-privacy';
    w.setAttribute('role', 'note');
    var NV = window.ECJ_PALETTE !== 'gold';
    w.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;max-width:340px;' +
      'background:' + (NV ? 'rgba(14,21,36,.94)' : 'rgba(21,18,13,.94)') + ';border:1px solid ' + (NV ? '#2c3a57' : '#3a3122') + ';padding:10px 12px 10px 14px;' +
      'display:flex;gap:12px;align-items:center;font:400 12px/1.5 Avenir,Nunito,system-ui,sans-serif;' +
      'color:' + (NV ? '#bcc2cd' : '#c9bfae') + ';opacity:0;transform:translateY(6px);transition:opacity .4s,transform .4s;';
    w.innerHTML = '<span style="flex:1">No tracking cookies. We only use what is needed to process your order. ' +
      '<a href="privacy-policy.html" style="color:' + (NV ? '#cfd3da' : '#d4b572') + ';text-decoration:underline;text-underline-offset:2px;">Privacy</a></span>';
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.style.cssText = 'background:none;border:0;color:' + (NV ? '#cfd3da' : '#d4b572') + ';font:300 18px/1 system-ui;cursor:pointer;padding:4px 6px;min-width:28px;min-height:28px;';
    x.onclick = function () {
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
      w.style.opacity = '0';
      setTimeout(function () { w.remove(); }, 400);
    };
    w.appendChild(x);
    (document.body || document.documentElement).appendChild(w);
    setTimeout(function () { w.style.opacity = '1'; w.style.transform = 'none'; }, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})();
