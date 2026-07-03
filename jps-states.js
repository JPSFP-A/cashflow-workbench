/* jps-states.js — JPS platform shared UI states
 * Provides spinner, empty state, toast, and button-loading helpers.
 * Requires jps-theme.css for styling.
 *
 * Usage:
 *   <script src="shared/jps-states.js"></script>
 *
 *   JpsStates.spinner(el)              // replace el content with spinner
 *   JpsStates.empty(el, title, sub)    // replace el content with empty state
 *   JpsStates.clear(el)               // clear spinner/empty, restore el
 *   JpsStates.toast(msg, type, ms)     // show toast (type: info|success|warn|error)
 *   JpsStates.btnLoad(btn, label)      // disable btn + show spinner
 *   JpsStates.btnRestore(btn)          // re-enable btn, restore original label
 */
(function (root) {
  'use strict';

  /* ---- Toast ---- */
  var _toastContainer = null;

  function getToastContainer() {
    if (!_toastContainer) {
      _toastContainer = document.getElementById('jps-toast-container');
      if (!_toastContainer) {
        _toastContainer = document.createElement('div');
        _toastContainer.id = 'jps-toast-container';
        _toastContainer.setAttribute('role', 'status');
        _toastContainer.setAttribute('aria-live', 'polite');
        _toastContainer.setAttribute('aria-atomic', 'false');
        document.body.appendChild(_toastContainer);
      }
    }
    return _toastContainer;
  }

  function toast(msg, type, ms) {
    type = type || 'info';
    ms   = ms   || (type === 'error' ? 6000 : 3500);

    var t = document.createElement('div');
    t.className = 'jps-toast jps-toast-' + type;
    t.setAttribute('role', 'alert');

    var msgEl = document.createElement('span');
    msgEl.className = 'jps-toast-msg';
    msgEl.textContent = msg;

    var closeBtn = document.createElement('button');
    closeBtn.className = 'jps-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '×';

    t.appendChild(msgEl);
    t.appendChild(closeBtn);
    getToastContainer().appendChild(t);

    function dismiss() {
      t.classList.add('hiding');
      t.addEventListener('animationend', function () { if (t.parentNode) t.parentNode.removeChild(t); }, { once: true });
    }

    closeBtn.addEventListener('click', dismiss);
    var timer = setTimeout(dismiss, ms);
    closeBtn.addEventListener('click', function () { clearTimeout(timer); });
  }

  /* ---- Spinner ---- */
  function spinner(el, label) {
    if (!el) return;
    el._jpsOrigContent = el.innerHTML;
    var wrap = document.createElement('div');
    wrap.className = 'jps-spinner-wrap';
    var s = document.createElement('span');
    s.className = 'jps-spinner';
    s.setAttribute('role', 'status');
    s.setAttribute('aria-label', label || 'Loading');
    wrap.appendChild(s);
    if (label) {
      var txt = document.createElement('span');
      txt.textContent = label;
      txt.setAttribute('aria-hidden', 'true');
      wrap.appendChild(txt);
    }
    el.innerHTML = '';
    el.appendChild(wrap);
  }

  /* ---- Empty state ---- */
  function empty(el, title, sub, icon) {
    if (!el) return;
    icon  = icon  || '📭';
    title = title || 'No data';
    var e = document.createElement('div');
    e.className = 'jps-empty';
    e.setAttribute('role', 'status');
    e.innerHTML =
      '<div class="jps-empty-icon" aria-hidden="true">' + icon + '</div>' +
      '<div class="jps-empty-title">' + escHtml(title) + '</div>' +
      (sub ? '<div class="jps-empty-sub">' + escHtml(sub) + '</div>' : '');
    el.innerHTML = '';
    el.appendChild(e);
  }

  /* ---- Clear (restore original content) ---- */
  function clear(el) {
    if (!el) return;
    if (el._jpsOrigContent !== undefined) {
      el.innerHTML = el._jpsOrigContent;
      delete el._jpsOrigContent;
    }
  }

  /* ---- Button loading state ---- */
  function btnLoad(btn, loadingLabel) {
    if (!btn) return;
    btn._jpsOrigLabel    = btn.textContent;
    btn._jpsOrigDisabled = btn.disabled;
    btn.disabled = true;
    btn.classList.add('jps-btn-loading');
    if (loadingLabel) btn.textContent = loadingLabel;
  }

  function btnRestore(btn) {
    if (!btn) return;
    btn.disabled = btn._jpsOrigDisabled || false;
    btn.classList.remove('jps-btn-loading');
    if (btn._jpsOrigLabel !== undefined) btn.textContent = btn._jpsOrigLabel;
    delete btn._jpsOrigLabel;
    delete btn._jpsOrigDisabled;
  }

  /* ---- Helpers ---- */
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ---- Modal auto-wirer ----
   * Watches for any modal becoming visible (Treasury: .modal-overlay.open,
   * Sales: .modal-bg.sh) and adds ARIA, focus trap, Escape key, body scroll lock.
   * Zero changes needed in individual apps. */

  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  var _activeTrap   = null;   // the inner .modal element being trapped
  var _triggerEl    = null;   // element that had focus before modal opened
  var _escHandler   = null;
  var _trapHandler  = null;

  function getInner(overlay) {
    return overlay.querySelector('.modal,[role="dialog"]') || overlay;
  }

  function getFocusable(el) {
    return Array.from(el.querySelectorAll(FOCUSABLE)).filter(function (n) {
      return !n.closest('[hidden]') && getComputedStyle(n).display !== 'none';
    });
  }

  function trapFocus(e) {
    if (!_activeTrap) return;
    var nodes = getFocusable(_activeTrap);
    if (!nodes.length) return;
    var first = nodes[0], last = nodes[nodes.length - 1];
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }

  function findCloseBtn(el) {
    return el.querySelector('.modal-close,[aria-label="Close"],[data-modal-close]');
  }

  function activateTrap(overlay) {
    if (_activeTrap) return;                          // already trapped
    _triggerEl   = document.activeElement;
    var inner    = getInner(overlay);
    _activeTrap  = inner;

    inner.setAttribute('role', 'dialog');
    inner.setAttribute('aria-modal', 'true');
    if (!inner.hasAttribute('aria-label') && !inner.hasAttribute('aria-labelledby')) {
      var heading = inner.querySelector('h2,h3,h4,.modal-title,[id*="title"]');
      if (heading) {
        if (!heading.id) heading.id = 'jps-modal-title-' + Date.now();
        inner.setAttribute('aria-labelledby', heading.id);
      }
    }

    document.body.style.overflow = 'hidden';
    _trapHandler = trapFocus;
    document.addEventListener('keydown', _trapHandler);

    _escHandler = function (e) {
      if (e.key !== 'Escape') return;
      var btn = findCloseBtn(inner) || findCloseBtn(overlay);
      if (btn) btn.click();
    };
    document.addEventListener('keydown', _escHandler);

    var nodes = getFocusable(inner);
    if (nodes.length) {
      setTimeout(function () { nodes[0].focus(); }, 16);
    }
  }

  function deactivateTrap() {
    if (!_activeTrap) return;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _trapHandler);
    document.removeEventListener('keydown', _escHandler);
    _activeTrap = null;
    if (_triggerEl && typeof _triggerEl.focus === 'function') {
      setTimeout(function () { _triggerEl.focus(); }, 16);
    }
    _triggerEl = null;
  }

  function isModalOpen(el) {
    return el.classList.contains('open') || el.classList.contains('sh');
  }

  function scanModals(root) {
    var candidates = (root || document).querySelectorAll('.modal-overlay,.modal-bg,[role="dialog"]');
    var found = false;
    candidates.forEach(function (el) {
      if (isModalOpen(el)) { activateTrap(el); found = true; }
    });
    if (!found) deactivateTrap();
  }

  var _observer = new MutationObserver(function (mutations) {
    var relevant = mutations.some(function (m) {
      return m.type === 'attributes' && m.attributeName === 'class' &&
             (m.target.classList.contains('modal-overlay') ||
              m.target.classList.contains('modal-bg') ||
              m.target.getAttribute('role') === 'dialog');
    });
    if (relevant) scanModals();
  });

  function initModalWirer() {
    _observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    scanModals();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModalWirer);
  } else {
    initModalWirer();
  }

  root.JpsStates = { toast: toast, spinner: spinner, empty: empty, clear: clear, btnLoad: btnLoad, btnRestore: btnRestore };
})(window);
