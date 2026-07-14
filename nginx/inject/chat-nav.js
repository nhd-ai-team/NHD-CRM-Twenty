(function () {
  'use strict';

  var CHAT_SRC   = '/chat/';
  var LABEL      = '对话工作台';
  var NAV_ID     = '__chat_nav_item__';
  var IFRAME_ID  = '__chat_iframe__';
  var ACTIVE_KEY = '__chat_active__';

  // ── iframe management ──────────────────────────────────────────────────────

  function getOrCreateIframe() {
    var existing = document.getElementById(IFRAME_ID);
    if (existing) return existing;

    var iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = CHAT_SRC;
    iframe.style.cssText = [
      'position:fixed',
      'top:0',
      'right:0',
      'bottom:0',
      'left:0',
      'width:100%',
      'height:100%',
      'border:none',
      'z-index:100',
      'display:none',
      'background:var(--twenty-background-primary,#fff)',
    ].join(';');
    document.body.appendChild(iframe);
    return iframe;
  }

  // Measure the sidebar width by finding our nav item's sidebar ancestor
  function getSidebarLeft() {
    var navItem = document.getElementById(NAV_ID);
    if (!navItem) return 0;
    // Walk up until we find the sidebar panel (usually the first fixed/tall ancestor)
    var el = navItem;
    for (var i = 0; i < 8; i++) {
      el = el.parentElement;
      if (!el) break;
      var rect = el.getBoundingClientRect();
      var style = window.getComputedStyle(el);
      // Sidebar is tall (>60% viewport) and not the whole body
      if (rect.height > window.innerHeight * 0.6 &&
          rect.width < window.innerWidth * 0.5 &&
          rect.left === 0) {
        return rect.right;
      }
    }
    // Fallback: use the nav item's own right edge clamped to a reasonable width
    var nr = navItem.closest('[style*="position"]') || navItem.parentElement;
    return nr ? Math.min(nr.getBoundingClientRect().right, 300) : 240;
  }

  function showChat() {
    sessionStorage.setItem(ACTIVE_KEY, '1');
    var iframe = getOrCreateIframe();
    var left = getSidebarLeft();
    iframe.style.left = left + 'px';
    iframe.style.display = 'block';
    setNavActive(true);
  }

  function hideChat() {
    sessionStorage.removeItem(ACTIVE_KEY);
    var iframe = document.getElementById(IFRAME_ID);
    if (iframe) iframe.style.display = 'none';
    setNavActive(false);
  }

  function isChatVisible() {
    var iframe = document.getElementById(IFRAME_ID);
    return iframe && iframe.style.display !== 'none';
  }

  // ── nav item active styling ────────────────────────────────────────────────

  function setNavActive(active) {
    var el = document.getElementById(NAV_ID);
    if (!el) return;
    el.setAttribute('data-active', active ? '1' : '0');
    el.style.background = active
      ? 'var(--twenty-background-tertiary,rgba(0,0,0,.06))'
      : 'transparent';
    el.style.color = active
      ? 'var(--twenty-color-purple-50,#9333ea)'
      : '';
  }

  // ── intercept other nav clicks to hide chat ────────────────────────────────

  function setupNavInterception() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      // Is this a Twenty internal nav link (not our chat link)?
      if (a.id !== NAV_ID &&
          !href.startsWith('/chat') &&
          (href.match(/^\/(people|companies|opportunities|notes|tasks|messages|settings|objects)/) ||
           href.match(/^\/[a-z]/) && !href.startsWith('//'))) {
        if (isChatVisible()) hideChat();
      }
    }, true);
  }

  // ── build and insert nav item ──────────────────────────────────────────────

  function buildNavItem(refAnchor) {
    var cs = window.getComputedStyle(refAnchor);

    var el = document.createElement('div');
    el.id = NAV_ID;
    el.role = 'button';
    el.tabIndex = 0;
    el.setAttribute('data-active', '0');
    el.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:' + cs.padding,
      'border-radius:' + cs.borderRadius,
      'font-size:' + cs.fontSize,
      'font-weight:' + cs.fontWeight,
      'color:' + cs.color,
      'cursor:pointer',
      'width:100%',
      'box-sizing:border-box',
      'background:transparent',
      'transition:background .1s',
      'user-select:none',
    ].join(';');

    // Chat bubble SVG matching Twenty's icon size
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.cssText = 'flex-shrink:0;';
    svg.innerHTML = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';

    var span = document.createElement('span');
    span.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    span.textContent = LABEL;

    el.appendChild(svg);
    el.appendChild(span);

    el.addEventListener('mouseenter', function () {
      if (el.getAttribute('data-active') !== '1') {
        el.style.background = 'var(--twenty-background-tertiary,rgba(0,0,0,.06))';
      }
    });
    el.addEventListener('mouseleave', function () {
      if (el.getAttribute('data-active') !== '1') {
        el.style.background = 'transparent';
      }
    });
    el.addEventListener('click', function () {
      if (isChatVisible()) {
        hideChat();
      } else {
        showChat();
      }
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') el.click();
    });

    return el;
  }

  function tryInsert() {
    if (document.getElementById(NAV_ID)) return;

    var navAnchors = Array.from(document.querySelectorAll('a[href]')).filter(function (a) {
      var href = a.getAttribute('href') || '';
      return href.match(/^\/(people|companies|opportunities|notes|tasks|messages)/) ||
             href.match(/^\/objects\//);
    });

    if (navAnchors.length === 0) return;

    var refAnchor = navAnchors[navAnchors.length - 1];
    var container = refAnchor.parentElement;
    if (!container) return;

    // Find the ul/div that holds multiple peer nav items
    var listEl = container;
    if (container.children.length < 2 && container.parentElement) {
      listEl = container.parentElement;
      container = refAnchor.parentElement; // keep ref for cloning wrapper
    }

    var item = buildNavItem(refAnchor);
    var wrapper = document.createElement(container.tagName);
    wrapper.className = container.className;
    wrapper.appendChild(item);
    listEl.appendChild(wrapper);

    setupNavInterception();

    // Pre-create iframe (keeps it warm; won't load until shown)
    getOrCreateIframe();
  }

  // ── boot ──────────────────────────────────────────────────────────────────

  var observer = new MutationObserver(tryInsert);
  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'complete') {
    tryInsert();
  } else {
    window.addEventListener('load', tryInsert);
  }

  var stopInterval = setInterval(function () {
    if (document.getElementById(NAV_ID)) {
      observer.disconnect();
      clearInterval(stopInterval);
    }
  }, 2000);

})();
