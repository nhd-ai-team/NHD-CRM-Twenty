(function () {
  'use strict';

  var CHAT_SRC   = '/chat/';
  var LABEL      = '对话工作台';
  var NAV_ID     = '__chat_nav_item__';
  var MAIL_LABEL = '邮箱';
  var MAIL_NAV_ID = '__mail_nav_item__';
  var IFRAME_ID  = '__chat_iframe__';
  var ACTIVE_KEY = '__chat_active__'; // 存当前激活视图：'chat' | 'mail'
  var AUTH_TOKEN = '';
  var HIDDEN_NAV_LABELS = ['Workflows', '工作流', '自动化'];
  // 对话工作台（聊天气泡）与邮箱（信封）两个入口共用同一个 iframe，靠 URL 的 view 参数切换。
  var CHAT_SVG = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
  var MAIL_SVG = '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>';

  function rememberAuthToken(token) {
    if (token && token.split('.').length === 3) AUTH_TOKEN = token;
  }

  function extractBearer(value) {
    var auth = String(value || '');
    return auth.toLowerCase().indexOf('bearer ') === 0 ? auth.slice(7).trim() : '';
  }

  function getHeaderValue(headers, name) {
    if (!headers) return '';
    try {
      if (typeof headers.get === 'function') return headers.get(name) || '';
      var lower = name.toLowerCase();
      if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i++) {
          if (String(headers[i][0]).toLowerCase() === lower) return headers[i][1];
        }
      }
      for (var key in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lower) return headers[key];
      }
    } catch (e) {}
    return '';
  }

  function installAuthCapture() {
    if (window.__chatAuthCaptureInstalled) return;
    window.__chatAuthCaptureInstalled = true;

    var originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function () {
        try {
          var input = arguments[0];
          var init = arguments[1] || {};
          var token = extractBearer(getHeaderValue(init.headers, 'authorization'));
          if (!token && input && input.headers) token = extractBearer(getHeaderValue(input.headers, 'authorization'));
          rememberAuthToken(token);
        } catch (e) {}
        return originalFetch.apply(this, arguments);
      };
    }

    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function () {
      this.__chatRequestUrl = arguments[1] || '';
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (String(name || '').toLowerCase() === 'authorization') rememberAuthToken(extractBearer(value));
      return originalSetRequestHeader.apply(this, arguments);
    };
  }

  // ── iframe management ──────────────────────────────────────────────────────

  function getCookie(name) {
    var prefix = name + '=';
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part.indexOf(prefix) === 0) return part.slice(prefix.length);
    }
    return '';
  }

  function getTwentyAccessToken() {
    return AUTH_TOKEN || getTokenFromValue(getCookie('tokenPair')) || getTokenFromWebStorage(window.sessionStorage) || getTokenFromWebStorage(window.localStorage);
  }

  function decodeJwtPayload(token) {
    try {
      var payload = token.split('.')[1];
      if (!payload) return null;
      return JSON.parse(window.atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) {
      return null;
    }
  }

  function getTokenFromValue(value) {
    try {
      var raw = decodeURIComponent(String(value || ''));
      if (!raw) return '';
      if (raw.split('.').length === 3) return raw;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.accessToken && parsed.accessToken.token) return parsed.accessToken.token;
      if (parsed && parsed.tokenPair && parsed.tokenPair.accessToken && parsed.tokenPair.accessToken.token) return parsed.tokenPair.accessToken.token;
      if (parsed && parsed.token && String(parsed.token).split('.').length === 3) return parsed.token;
    } catch (e) {
      if (String(value || '').split('.').length === 3) return String(value || '');
    }
    return '';
  }

  function getTokenFromWebStorage(storage) {
    try {
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        var token = getTokenFromValue(storage.getItem(key));
        var payload = token ? decodeJwtPayload(token) : null;
        if (payload && payload.workspaceId) return token;
      }
    } catch (e) {}
    return '';
  }

  function postAuthTokenToIframe(iframe) {
    var token = getTwentyAccessToken();
    if (!token || !iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({ type: 'twenty-auth-token', token: token }, window.location.origin);
    } catch (e) {}
  }

  function getViewSrc(view) {
    var token = getTwentyAccessToken();
    var hash = token ? '#twentyAccessToken=' + encodeURIComponent(token) : '';
    if (view === 'mail') hash += (hash ? '&' : '#') + 'view=mail';
    return CHAT_SRC + hash;
  }

  function getActiveView() {
    return sessionStorage.getItem(ACTIVE_KEY) || '';
  }

  function getOrCreateIframe() {
    var existing = document.getElementById(IFRAME_ID);
    if (existing) return existing;

    var iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = getViewSrc(getActiveView() || 'chat');
    iframe.style.cssText = [
      'position:fixed',
      'top:0',
      'right:0',
      'bottom:0',
      'left:0',
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

  function applyIframeSize(iframe) {
    var left = getSidebarLeft();
    iframe.style.position = 'fixed';
    iframe.style.top = '0';
    iframe.style.left = left + 'px';
    // Must use explicit width/height — right:0/bottom:0 doesn't stretch iframes reliably
    iframe.style.width = (window.innerWidth - left) + 'px';
    iframe.style.height = window.innerHeight + 'px';
  }

  function showView(view) {
    sessionStorage.setItem(ACTIVE_KEY, view);
    var iframe = getOrCreateIframe();
    var src = getViewSrc(view);
    // 切换视图需重载 iframe（SPA 重读 hash 的 view 参数）
    if (iframe.getAttribute('src') !== src) iframe.src = src;
    applyIframeSize(iframe);
    iframe.style.display = 'block';
    postAuthTokenToIframe(iframe);
    window.setTimeout(function () { postAuthTokenToIframe(iframe); }, 800);
    setNavActive(view);
  }

  function hideChat() {
    sessionStorage.removeItem(ACTIVE_KEY);
    var iframe = document.getElementById(IFRAME_ID);
    if (iframe) iframe.style.display = 'none';
    setNavActive('');
  }

  function isChatVisible() {
    var iframe = document.getElementById(IFRAME_ID);
    return iframe && iframe.style.display !== 'none';
  }

  // ── nav item active styling ────────────────────────────────────────────────

  function setNavActive(view) {
    [[ 'chat', NAV_ID ], [ 'mail', MAIL_NAV_ID ]].forEach(function (pair) {
      var el = document.getElementById(pair[1]);
      if (!el) return;
      var active = view === pair[0];
      el.setAttribute('data-active', active ? '1' : '0');
      el.style.background = active
        ? 'var(--twenty-background-tertiary,rgba(0,0,0,.06))'
        : 'transparent';
      el.style.color = active
        ? 'var(--twenty-color-purple-50,#9333ea)'
        : '';
    });
  }

  // ── intercept other nav clicks to hide chat ────────────────────────────────

  function setupNavInterception() {
    if (window.__chatNavInterceptionInstalled) return;
    window.__chatNavInterceptionInstalled = true;
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

  // ── hide native nav items disabled for this workspace ─────────────────────

  function textLooksLikeDisabledNav(text) {
    var normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return HIDDEN_NAV_LABELS.indexOf(normalized) !== -1;
  }

  function hrefLooksLikeDisabledNav(href) {
    return /^\/workflows(\/|$)/.test(href || '') ||
      /^\/objects\/workflows(\/|$)/.test(href || '');
  }

  function sidebarRowFor(el) {
    var node = el;
    for (var i = 0; i < 6 && node && node !== document.body; i++) {
      var rect = node.getBoundingClientRect();
      var style = window.getComputedStyle(node);
      if (rect.left <= 320 &&
          rect.width > 80 && rect.width <= 360 &&
          rect.height >= 24 && rect.height <= 56 &&
          style.display !== 'contents') {
        return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function hideDisabledNativeNavItems() {
    var selectors = 'a[href],button,[role="button"]';
    Array.from(document.querySelectorAll(selectors)).forEach(function (el) {
      if (el.id === NAV_ID || el.id === MAIL_NAV_ID) return;
      var href = el.getAttribute('href') || '';
      if (!hrefLooksLikeDisabledNav(href) && !textLooksLikeDisabledNav(el.textContent)) return;
      var rect = el.getBoundingClientRect();
      // Only target the left CRM sidebar. Do not hide content inside detail pages.
      if (rect.left > 360 || rect.width > 420) return;
      var row = sidebarRowFor(el);
      row.style.display = 'none';
      row.setAttribute('data-chat-hidden-native-nav', '1');
    });
  }

  // ── build and insert nav item ──────────────────────────────────────────────

  function buildNavItem(refAnchor, opts) {
    var cs = window.getComputedStyle(refAnchor);

    var el = document.createElement('div');
    el.id = opts.navId;
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
    svg.innerHTML = opts.svg;

    var span = document.createElement('span');
    span.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    span.textContent = opts.label;

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
      // 点当前已激活的入口 → 收起；否则切到该视图
      if (isChatVisible() && getActiveView() === opts.view) {
        hideChat();
      } else {
        showView(opts.view);
      }
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') el.click();
    });

    return el;
  }

  function tryInsert() {
    hideDisabledNativeNavItems();
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

    [
      { navId: NAV_ID, label: LABEL, svg: CHAT_SVG, view: 'chat' },
      { navId: MAIL_NAV_ID, label: MAIL_LABEL, svg: MAIL_SVG, view: 'mail' },
    ].forEach(function (opts) {
      var item = buildNavItem(refAnchor, opts);
      var wrapper = document.createElement(container.tagName);
      wrapper.className = container.className;
      wrapper.appendChild(item);
      listEl.appendChild(wrapper);
    });

    setupNavInterception();

    // Pre-create iframe. Keep it hidden, but load it once so the first open is faster.
    getOrCreateIframe();
  }

  // ── resize: keep iframe filling the content area ──────────────────────────

  window.addEventListener('resize', function () {
    var iframe = document.getElementById(IFRAME_ID);
    if (iframe && iframe.style.display !== 'none') {
      applyIframeSize(iframe);
    }
  });

  // ── boot ──────────────────────────────────────────────────────────────────

  installAuthCapture();

  var observer = new MutationObserver(tryInsert);
  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'complete') {
    tryInsert();
  } else {
    window.addEventListener('load', tryInsert);
  }

  // Twenty is a SPA: sidebar nodes can be replaced after navigation, role changes,
  // or metadata refreshes. Keep a low-frequency fallback so our entry survives
  // those rerenders without requiring a full browser refresh.
  setInterval(tryInsert, 2000);

})();
