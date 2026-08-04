(function () {
  'use strict';

  var CHAT_SRC   = '/chat/';
  var LABEL      = '对话工作台';
  var NAV_ID     = '__chat_nav_item__';
  var MAIL_LABEL = '邮箱';
  var MAIL_NAV_ID = '__mail_nav_item__';
  var SETTINGS_LABEL = '设置';
  var SETTINGS_NAV_ID = '__settings_nav_item__';
  var CHANNELS_SETTINGS_LABEL = '渠道';
  var CHANNELS_SETTINGS_PATH = '/settings/accounts/channels';
  var CHANNELS_SETTINGS_NAV_ID = '__settings_channels_nav_item__';
  var CHANNELS_SETTINGS_PAGE_ID = '__settings_channels_page__';
  var CHANNELS_SETTINGS_CARD_ID = '__settings_channels_card__';
  var IFRAME_ID  = '__chat_iframe__';
  var ACTIVE_KEY = '__chat_active__'; // 存当前激活视图：'chat' | 'mail'
  var AUTH_TOKEN = '';
  var HIDDEN_NAV_LABELS = ['Workflows', 'Workflow Runs', 'Workflow Versions', '工作流', '自动化'];
  // 对话工作台（聊天气泡）与邮箱（信封）两个入口共用同一个 iframe，靠 URL 的 view 参数切换。
  var CHAT_SVG = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
  var MAIL_SVG = '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>';
  var SETTINGS_SVG = '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>';
  var CHANNELS_SVG = '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>';

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

  function isSettingsPage() {
    return window.location.pathname.indexOf('/settings') === 0;
  }

  function isChannelsSettingsPage() {
    return window.location.pathname === CHANNELS_SETTINGS_PATH;
  }

  function removeInjectedNavItems() {
    [NAV_ID, MAIL_NAV_ID].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var wrapper = el.closest('[data-chat-nav-wrapper="1"]') || el.parentElement;
      if (wrapper && wrapper !== document.body) wrapper.remove();
      else el.remove();
    });
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
    [[ 'chat', NAV_ID ], [ 'mail', MAIL_NAV_ID ], [ 'settings', SETTINGS_NAV_ID ]].forEach(function (pair) {
      var el = document.getElementById(pair[1]);
      if (!el) return;
      var active = pair[0] === 'settings' ? isSettingsPage() && !isChatVisible() : view === pair[0] && !isSettingsPage();
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
          a.id !== SETTINGS_NAV_ID &&
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
      if (el.id === NAV_ID || el.id === MAIL_NAV_ID || el.id === SETTINGS_NAV_ID) return;
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
      if (opts.href) {
        hideChat();
        if (window.location.pathname !== opts.href) window.location.href = opts.href;
        return;
      }
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

  function removeChannelsSettingsPage() {
    var page = document.getElementById(CHANNELS_SETTINGS_PAGE_ID);
    if (page) page.remove();
  }

  function settingsDrawerRight() {
    var anchors = Array.from(document.querySelectorAll('a[href^="/settings/"]'));
    var right = 0;
    anchors.forEach(function (anchor) {
      var node = anchor;
      for (var i = 0; i < 8 && node && node !== document.body; i++) {
        var rect = node.getBoundingClientRect();
        var style = window.getComputedStyle(node);
        if (rect.height > window.innerHeight * 0.6 &&
            rect.width >= 160 && rect.width <= 420 &&
            rect.left < window.innerWidth * 0.5 &&
            style.display !== 'contents') {
          right = Math.max(right, rect.right);
        }
        node = node.parentElement;
      }
    });
    return right || 300;
  }

  function setSettingsChannelsActive() {
    var item = document.getElementById(CHANNELS_SETTINGS_NAV_ID);
    if (!item) return;
    var active = isChannelsSettingsPage();
    item.setAttribute('data-active', active ? '1' : '0');
    item.style.background = active ? 'var(--twenty-background-tertiary,rgba(0,0,0,.06))' : 'transparent';
    item.style.color = active ? 'var(--twenty-color-purple-50,#9333ea)' : '';
  }

  function buildSettingsChannelsNavItem(refAnchor) {
    var cs = window.getComputedStyle(refAnchor);
    var el = document.createElement('a');
    el.id = CHANNELS_SETTINGS_NAV_ID;
    el.href = CHANNELS_SETTINGS_PATH;
    el.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:' + cs.padding,
      'padding-left:32px',
      'border-radius:' + cs.borderRadius,
      'font-size:' + cs.fontSize,
      'font-weight:' + cs.fontWeight,
      'color:' + cs.color,
      'text-decoration:none',
      'width:100%',
      'box-sizing:border-box',
      'cursor:pointer',
      'transition:background .1s',
    ].join(';');

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
    svg.innerHTML = CHANNELS_SVG;
    var span = document.createElement('span');
    span.textContent = CHANNELS_SETTINGS_LABEL;
    span.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    el.appendChild(svg);
    el.appendChild(span);
    el.addEventListener('mouseenter', function () {
      if (el.getAttribute('data-active') !== '1') el.style.background = 'var(--twenty-background-tertiary,rgba(0,0,0,.06))';
    });
    el.addEventListener('mouseleave', function () {
      if (el.getAttribute('data-active') !== '1') el.style.background = 'transparent';
    });
    return el;
  }

  function ensureSettingsChannelsNav() {
    if (!isSettingsPage()) return;
    var emailAnchor = document.querySelector('a[href="/settings/accounts/emails"]');
    var accountAnchor = document.querySelector('a[href="/settings/accounts"]');
    var refAnchor = emailAnchor || accountAnchor;
    if (!refAnchor || !refAnchor.parentElement) return;
    var listEl = refAnchor.parentElement.parentElement || refAnchor.parentElement;
    var existing = document.getElementById(CHANNELS_SETTINGS_NAV_ID);
    var wrapper = existing ? existing.closest('[data-settings-channels-nav-wrapper="1"]') : null;
    if (!existing) {
      existing = buildSettingsChannelsNavItem(refAnchor);
      wrapper = document.createElement(refAnchor.parentElement.tagName);
      wrapper.className = refAnchor.parentElement.className;
      wrapper.setAttribute('data-settings-channels-nav-wrapper', '1');
      wrapper.appendChild(existing);
    }
    if (emailAnchor && emailAnchor.parentElement && wrapper.previousElementSibling !== emailAnchor.parentElement) {
      emailAnchor.parentElement.insertAdjacentElement('afterend', wrapper);
    } else if (!emailAnchor && accountAnchor && accountAnchor.parentElement && wrapper.previousElementSibling !== accountAnchor.parentElement) {
      accountAnchor.parentElement.insertAdjacentElement('afterend', wrapper);
    } else if (wrapper.parentElement !== listEl) {
      listEl.appendChild(wrapper);
    }
    setSettingsChannelsActive();
  }

  function statusLabel(status) {
    if (status === 'WORKING') return '已连接';
    if (status === 'SCAN_QR_CODE') return '等待扫码';
    if (status === 'STARTING') return '启动中';
    if (status === 'STOPPED') return '未启动';
    return status || '未知';
  }

  function formatNow() {
    var now = new Date();
    var pad = function (value) { return String(value).padStart(2, '0'); };
    return pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  }

  function setWaButtonBusy(root, selector, busyText, isBusy) {
    var button = root.querySelector(selector);
    if (!button) return;
    if (isBusy) {
      button.setAttribute('data-original-text', button.textContent || '');
      button.textContent = busyText;
      button.disabled = true;
      button.style.opacity = '0.65';
      button.style.cursor = 'wait';
      return;
    }
    button.textContent = button.getAttribute('data-original-text') || button.textContent;
    button.disabled = button.getAttribute('data-connected-disabled') === '1';
    button.style.opacity = button.disabled ? '0.5' : '';
    button.style.cursor = button.disabled ? 'not-allowed' : 'pointer';
  }

  function readChannelApiResponse(response, fallbackMessage) {
    return response.text().then(function (body) {
      var data = null;
      try {
        data = body ? JSON.parse(body) : {};
      } catch (_error) {
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          throw new Error('渠道服务暂时不可用，请稍后重试。');
        }
        throw new Error('渠道接口返回异常，请刷新页面后重试。');
      }
      if (!response.ok) {
        throw new Error(data && (data.error || data.detail) || fallbackMessage);
      }
      return data;
    }).catch(function (error) {
      if (error instanceof TypeError) {
        throw new Error('无法连接渠道服务，请检查网络后重试。');
      }
      throw error;
    });
  }

  function renderWhatsAppStatus(root, state) {
    var connected = state && state.connected;
    var recoverableQr = state && ['FAILED', 'STOPPED', 'STARTING'].indexOf(state.status) !== -1;
    var waitingQr = state && (state.qrAvailable || recoverableQr);
    root.querySelector('[data-wa-status]').textContent = state ? statusLabel(state.status) : '加载中';
    root.querySelector('[data-wa-status]').style.background = connected ? '#dcfce7' : waitingQr ? '#fef3c7' : '#f4f4f5';
    root.querySelector('[data-wa-status]').style.color = connected ? '#166534' : waitingQr ? '#92400e' : '#52525b';
    root.querySelector('[data-wa-phone]').textContent = connected ? (state.phone || state.accountId || '-') : '-';
    root.querySelector('[data-wa-name]').textContent = connected ? (state.displayName || '-') : '-';
    root.querySelector('[data-wa-session]').textContent = state ? state.session : 'default';
    root.querySelector('[data-wa-updated]').textContent = '最后刷新 ' + formatNow();
    var startButton = root.querySelector('[data-wa-start]');
    if (startButton) {
      startButton.setAttribute('data-connected-disabled', connected ? '1' : '0');
      startButton.disabled = connected;
      startButton.style.opacity = connected ? '0.5' : '';
      startButton.style.cursor = connected ? 'not-allowed' : 'pointer';
      startButton.title = connected ? '已连接时不需要重新生成二维码' : '重启 WhatsApp 会话并生成新的二维码';
    }
    var codeButton = root.querySelector('[data-wa-code]');
    var phoneInput = root.querySelector('[data-wa-phone-input]');
    if (codeButton) {
      codeButton.setAttribute('data-connected-disabled', connected ? '1' : '0');
      codeButton.disabled = connected;
      codeButton.style.opacity = connected ? '0.5' : '';
      codeButton.style.cursor = connected ? 'not-allowed' : 'pointer';
      codeButton.title = connected ? '已连接时不需要生成配对码' : '生成 WhatsApp 手机号配对码';
    }
    if (phoneInput) phoneInput.disabled = connected;
    root.querySelector('[data-wa-help]').textContent = connected
      ? '该 WhatsApp 已可在对话工作台收发消息。'
      : waitingQr
        ? (state.status === 'FAILED' ? '当前会话异常，系统会自动重新生成二维码。请稍等几秒后扫码。' : '请用 WhatsApp 手机端扫描下方二维码，完成后页面会自动刷新状态。')
        : '如未显示二维码，请点击“启动/刷新二维码”。';
    var qrBox = root.querySelector('[data-wa-qr-box]');
    qrBox.style.display = waitingQr ? 'block' : 'none';
    if (waitingQr) {
      var qr = root.querySelector('[data-wa-qr]');
      qr.onerror = function () {
        root.querySelector('[data-wa-error]').textContent = '二维码生成中，请点击“启动/刷新二维码”或稍后刷新状态';
      };
      qr.onload = function () {
        root.querySelector('[data-wa-error]').textContent = '';
      };
      qr.src = '/conv-api/channel-accounts/whatsapp/qr?t=' + Date.now();
    }
  }

  function loadWhatsAppStatus(root) {
    root.querySelector('[data-wa-error]').textContent = '';
    return window.fetch('/conv-api/channel-accounts/whatsapp/status', { credentials: 'same-origin' })
      .then(function (response) { return readChannelApiResponse(response, '状态加载失败'); })
      .then(function (data) { renderWhatsAppStatus(root, data); })
      .catch(function (error) {
        root.querySelector('[data-wa-error]').textContent = error.message || '状态加载失败';
      });
  }

  function renderChannelsSettingsPage() {
    if (!isChannelsSettingsPage()) {
      removeChannelsSettingsPage();
      return;
    }
    var existing = document.getElementById(CHANNELS_SETTINGS_PAGE_ID);
    if (existing) {
      existing.style.left = settingsDrawerRight() + 'px';
      return;
    }
    var root = document.createElement('div');
    root.id = CHANNELS_SETTINGS_PAGE_ID;
    root.style.cssText = [
      'position:fixed',
      'top:0',
      'right:0',
      'bottom:0',
      'left:' + settingsDrawerRight() + 'px',
      'z-index:90',
      'background:var(--twenty-background-primary,#fff)',
      'overflow:auto',
      'padding:32px 40px',
      'box-sizing:border-box',
      'font-family:inherit',
      'color:var(--twenty-font-color-primary,#18181b)',
    ].join(';');
    root.innerHTML =
      '<div style="max-width:760px">' +
        '<div style="font-size:13px;color:#71717a;margin-bottom:12px">账户 / 渠道</div>' +
        '<h1 style="font-size:22px;line-height:1.3;margin:0 0 8px;font-weight:700">渠道</h1>' +
        '<p style="font-size:13px;color:#71717a;margin:0 0 24px">绑定当前用户自己的外部沟通渠道。当前先支持 WhatsApp。</p>' +
        '<div style="border:1px solid #e4e4e7;border-radius:8px;background:#fff;overflow:hidden">' +
          '<div style="display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid #f0f0f1">' +
            '<div style="width:38px;height:38px;border-radius:50%;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;font-weight:800">W</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:15px;font-weight:700">WhatsApp</div>' +
              '<div data-wa-help style="font-size:12.5px;color:#71717a;margin-top:2px">正在加载绑定状态...</div>' +
            '</div>' +
            '<span data-wa-status style="font-size:12px;font-weight:700;border-radius:999px;padding:4px 9px;background:#f4f4f5;color:#52525b">加载中</span>' +
          '</div>' +
          '<div style="padding:18px 20px;display:grid;grid-template-columns:150px 1fr;gap:12px;font-size:13px">' +
            '<div style="color:#71717a">绑定号码</div><div data-wa-phone>-</div>' +
            '<div style="color:#71717a">显示名称</div><div data-wa-name>-</div>' +
            '<div style="color:#71717a">会话标识</div><div data-wa-session>default</div>' +
          '</div>' +
          '<div data-wa-qr-box style="display:none;padding:0 20px 18px">' +
            '<div style="display:flex;align-items:center;gap:20px;padding:16px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa;width:max-content;max-width:100%">' +
              '<img data-wa-qr alt="WhatsApp QR" style="width:220px;height:220px;object-fit:contain;background:#fff;border:1px solid #e4e4e7;border-radius:6px" />' +
              '<div style="max-width:260px;font-size:12.5px;color:#71717a;line-height:1.65">打开 WhatsApp 手机端，进入“已关联的设备”，扫描二维码完成绑定。二维码过期后点击刷新。</div>' +
            '</div>' +
          '</div>' +
          '<div data-wa-pair-box style="padding:0 20px 18px">' +
            '<div style="border:1px solid #e4e4e7;border-radius:8px;background:#fff;padding:14px 16px">' +
              '<div style="font-size:13px;font-weight:700;margin-bottom:8px">手机号配对</div>' +
              '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                '<input data-wa-phone-input placeholder="输入带国家区号的号码，如 8613800000000（仅示例）" style="height:32px;width:340px;max-width:100%;border:1px solid #d4d4d8;border-radius:6px;padding:0 10px;font-size:12.5px;box-sizing:border-box" />' +
                '<button data-wa-code style="height:32px;padding:0 12px;border-radius:6px;border:1px solid #16a34a;background:#16a34a;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">生成配对码</button>' +
              '</div>' +
              '<div data-wa-code-result style="display:none;margin-top:12px;padding:12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0">' +
                '<div style="font-size:12px;color:#166534;margin-bottom:6px">在 WhatsApp 手机端：已关联的设备 -> 关联设备 -> 改用手机号关联，然后输入：</div>' +
                '<div data-wa-code-value style="font-size:24px;line-height:1.2;font-weight:800;letter-spacing:1px;color:#14532d"></div>' +
                '<div style="font-size:12px;color:#166534;margin-top:6px">请在生成后 60 秒内输入配对码，超过 60 秒将失效，需重新生成。</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid #f0f0f1">' +
            '<button data-wa-refresh style="height:30px;padding:0 12px;border-radius:6px;border:1px solid #d4d4d8;background:#fff;color:#3f3f46;font-size:12.5px;font-weight:600;cursor:pointer">刷新状态</button>' +
            '<button data-wa-start style="height:30px;padding:0 12px;border-radius:6px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">启动/刷新二维码</button>' +
            '<span data-wa-updated style="font-size:12px;color:#71717a"></span>' +
            '<span data-wa-error style="font-size:12px;color:#dc2626"></span>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector('[data-wa-refresh]').addEventListener('click', function () {
      setWaButtonBusy(root, '[data-wa-refresh]', '刷新中...', true);
      loadWhatsAppStatus(root).finally(function () {
        setWaButtonBusy(root, '[data-wa-refresh]', '刷新中...', false);
      });
    });
    root.querySelector('[data-wa-start]').addEventListener('click', function () {
      root.querySelector('[data-wa-error]').textContent = '';
      setWaButtonBusy(root, '[data-wa-start]', '生成中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp/restart', { method: 'POST', credentials: 'same-origin' })
        .then(function (response) { return readChannelApiResponse(response, '二维码生成失败'); })
        .then(function () { return loadWhatsAppStatus(root); })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '启动失败'; })
        .finally(function () {
          setWaButtonBusy(root, '[data-wa-start]', '生成中...', false);
        });
    });
    root.querySelector('[data-wa-code]').addEventListener('click', function () {
      var phoneInput = root.querySelector('[data-wa-phone-input]');
      var resultBox = root.querySelector('[data-wa-code-result]');
      var codeValue = root.querySelector('[data-wa-code-value]');
      root.querySelector('[data-wa-error]').textContent = '';
      resultBox.style.display = 'none';
      codeValue.textContent = '';
      setWaButtonBusy(root, '[data-wa-code]', '生成中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp/request-code', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phoneInput.value }),
      })
        .then(function (response) { return readChannelApiResponse(response, '配对码生成失败'); })
        .then(function (data) {
          codeValue.textContent = data.code || '-';
          resultBox.style.display = 'block';
          return loadWhatsAppStatus(root);
        })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '配对码生成失败'; })
        .finally(function () {
          setWaButtonBusy(root, '[data-wa-code]', '生成中...', false);
        });
    });
    loadWhatsAppStatus(root);
    if (!window.__settingsChannelsPoller) {
      window.__settingsChannelsPoller = window.setInterval(function () {
        var page = document.getElementById(CHANNELS_SETTINGS_PAGE_ID);
        if (page && isChannelsSettingsPage()) loadWhatsAppStatus(page);
      }, 6000);
    }
  }

  function ensureSettingsAccountsChannelsCard() {
    if (window.location.pathname !== '/settings/accounts') {
      var stale = document.getElementById(CHANNELS_SETTINGS_CARD_ID);
      if (stale) stale.remove();
      return;
    }
    if (document.getElementById(CHANNELS_SETTINGS_CARD_ID)) return;
    var sections = Array.from(document.querySelectorAll('h2, [role="heading"]'));
    var settingsHeading = sections.find(function (el) { return (el.textContent || '').trim() === 'Settings'; });
    if (!settingsHeading) return;
    var section = settingsHeading.closest('section') || settingsHeading.parentElement;
    if (!section) return;
    var cardsHost = Array.from(section.querySelectorAll('div')).find(function (el) {
      var rect = el.getBoundingClientRect();
      return rect.width > 300 && rect.height > 40 && window.getComputedStyle(el).display === 'flex';
    });
    if (!cardsHost) return;
    var card = document.createElement('div');
    card.id = CHANNELS_SETTINGS_CARD_ID;
    card.style.cssText = 'border:1px solid #e4e4e7;border-radius:8px;padding:16px;min-width:220px;flex:1;cursor:pointer;background:#fff;color:#71717a';
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;color:#3f3f46;font-weight:600">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + CHANNELS_SVG + '</svg>' +
        '<span style="flex:1">渠道</span><span style="color:#a1a1aa">›</span>' +
      '</div>' +
      '<div style="padding-left:32px;margin-top:8px;font-size:13px">绑定 WhatsApp 等外部沟通渠道。</div>';
    card.addEventListener('click', function () { window.location.href = CHANNELS_SETTINGS_PATH; });
    cardsHost.appendChild(card);
  }

  function tryInsert() {
    hideDisabledNativeNavItems();
    if (isSettingsPage()) {
      removeInjectedNavItems();
      ensureSettingsChannelsNav();
      ensureSettingsAccountsChannelsCard();
      renderChannelsSettingsPage();
      return;
    }
    removeChannelsSettingsPage();

    var navAnchors = Array.from(document.querySelectorAll('a[href]')).filter(function (a) {
      var href = a.getAttribute('href') || '';
      return href.match(/^\/(people|companies|opportunities|notes|tasks|messages)/) ||
             href.match(/^\/objects\//);
    });

    if (navAnchors.length === 0) return;

    var refAnchor = navAnchors[0];
    var container = refAnchor.parentElement;
    if (!container) return;

    // Find the ul/div that holds multiple peer nav items
    var listEl = container;
    if (container.children.length < 2 && container.parentElement) {
      listEl = container.parentElement;
      container = refAnchor.parentElement; // keep ref for cloning wrapper
    }

    if (!isSettingsPage() && !document.getElementById(NAV_ID)) {
      var insertBeforeNode = container;
      [
        { navId: NAV_ID, label: LABEL, svg: CHAT_SVG, view: 'chat' },
        { navId: MAIL_NAV_ID, label: MAIL_LABEL, svg: MAIL_SVG, view: 'mail' },
      ].forEach(function (opts) {
        var item = buildNavItem(refAnchor, opts);
        var wrapper = document.createElement(container.tagName);
        wrapper.className = container.className;
        wrapper.setAttribute('data-chat-nav-wrapper', '1');
        wrapper.appendChild(item);
        listEl.insertBefore(wrapper, insertBeforeNode);
      });
    }

    var settingsItem = document.getElementById(SETTINGS_NAV_ID);
    var settingsWrapper = settingsItem ? settingsItem.closest('[data-chat-nav-wrapper="1"]') : null;
    if (!settingsItem) {
      settingsItem = buildNavItem(refAnchor, {
        navId: SETTINGS_NAV_ID,
        label: SETTINGS_LABEL,
        svg: SETTINGS_SVG,
        href: '/settings/profile',
      });
      settingsWrapper = document.createElement(container.tagName);
      settingsWrapper.className = container.className;
      settingsWrapper.setAttribute('data-chat-nav-wrapper', '1');
      settingsWrapper.appendChild(settingsItem);
    }
    if (settingsWrapper && settingsWrapper.parentElement !== listEl) listEl.appendChild(settingsWrapper);
    else if (settingsWrapper && settingsWrapper.nextElementSibling) listEl.appendChild(settingsWrapper);

    setupNavInterception();

    // Pre-create iframe. Keep it hidden, but load it once so the first open is faster.
    getOrCreateIframe();
    setNavActive(getActiveView());
  }

  // ── resize: keep iframe filling the content area ──────────────────────────

  window.addEventListener('resize', function () {
    var iframe = document.getElementById(IFRAME_ID);
    if (iframe && iframe.style.display !== 'none') {
      applyIframeSize(iframe);
    }
  });

  // ── 线索转客户：线索列表顶部「转客户」按钮（放在 +New opportunity 左侧）──────────
  var CONVERT_BTN_ID = '__lead_convert_top_btn__';
  var CONVERT_MODAL_ID = '__lead_convert_modal__';

  function isOpportunityListPage() {
    return window.location.pathname.indexOf('/objects/opportunities') === 0;
  }

  // 读取当前被勾选的线索行。Twenty 表格行为 [data-selectable-id] 的 div（非 tr），
  // 选中态体现为行内 checkbox 被勾选；同时兼容 aria-selected / data-selected 兜底。
  function getSelectedOpportunities() {
    var picked = [];
    Array.from(document.querySelectorAll('[data-selectable-id]')).forEach(function (row) {
      var id = row.getAttribute('data-selectable-id') || '';
      if (!id) return;
      var cb = row.querySelector('input[type="checkbox"]');
      var selected = (cb && cb.checked) ||
        row.getAttribute('aria-selected') === 'true' ||
        row.getAttribute('data-selected') === 'true';
      if (!selected) return;
      picked.push({ id: id, name: '线索 ' + id.slice(0, 8) });
    });
    return picked;
  }

  function convertToast(type, msg, timeoutMs) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:100003', 'padding:10px 18px', 'border-radius:8px', 'font-size:13px', 'font-weight:500',
      'color:#fff', 'box-shadow:0 6px 24px rgba(0,0,0,.2)', 'max-width:86vw',
      'background:' + (type === 'ok' ? '#1f9d5f' : '#e1262b'),
    ].join(';');
    document.body.appendChild(el);
    window.setTimeout(function () { el.remove(); }, timeoutMs || 3200);
  }

  function convertErrorMessage(status, data) {
    if (!data || typeof data !== 'object') return '请求失败，HTTP ' + status;
    if (data.code === 'PRODUCT_REQUIRED') return '请先填写「客户需求产品」，再执行转客户。';
    if (data.detail) return String(data.detail);
    if (data.error) return String(data.error);
    if (data.code) return '错误码：' + data.code;
    return '请求失败，HTTP ' + status;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function openConvertResultModal(summary) {
    var failures = summary.failures || [];
    if (!failures.length) return;
    var overlay = document.createElement('div');
    overlay.id = CONVERT_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(560px,100%);max-height:min(620px,90vh);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    var rows = failures.map(function (item) {
      return '<div style="padding:10px 0;border-top:1px solid #eee">' +
        '<div style="font-size:12.5px;font-weight:700;color:#222">' + escapeHtml(item.name || item.id || '未命名线索') + '</div>' +
        '<div style="margin-top:4px;font-size:12px;line-height:1.55;color:#b42318;white-space:pre-wrap">' + escapeHtml(item.reason || '未知失败原因') + '</div>' +
      '</div>';
    }).join('');
    card.innerHTML =
      '<div style="padding:16px 18px 10px">' +
        '<div style="font-size:15px;font-weight:700;color:#111">部分线索转客户失败</div>' +
        '<div style="margin-top:8px;font-size:12.5px;line-height:1.6;color:#555">' +
          '成功新建 <b>' + summary.created + '</b> 条，更新 <b>' + summary.updated + '</b> 条，失败 <b>' + failures.length + '</b> 条。请按以下原因修正后重试。' +
        '</div>' +
      '</div>' +
      '<div style="padding:0 18px;overflow:auto;flex:1">' + rows + '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px;border-top:1px solid #eee">' +
        '<button data-act="close" style="padding:7px 14px;border-radius:6px;border:none;background:#1f2937;color:#fff;cursor:pointer;font-size:12px;font-weight:700">知道了</button>' +
      '</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeConvertModal(); });
    card.querySelector('[data-act="close"]').addEventListener('click', closeConvertModal);
    document.body.appendChild(overlay);
  }

  function closeConvertModal() {
    var m = document.getElementById(CONVERT_MODAL_ID);
    if (m) m.remove();
  }

  function runConvert(items, onProgress) {
    var created = 0, updated = 0, personIds = [], failures = [];
    var chain = Promise.resolve();
    items.forEach(function (item, idx) {
      chain = chain.then(function () {
        onProgress(idx + 1, items.length);
        return window.fetch('/conv-api/opportunities/' + encodeURIComponent(item.id) + '/convert-to-person', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (data) {
            if (!r.ok) {
              failures.push({ id: item.id, name: item.name, reason: convertErrorMessage(r.status, data) });
              return;
            }
            if (data && data.personId) personIds.push(data.personId);
            if (data && data.created) created++; else updated++;
          });
        }).catch(function (error) {
          failures.push({ id: item.id, name: item.name, reason: error.message || '网络请求失败' });
        });
      });
    });
    return chain.then(function () { return { created: created, updated: updated, failed: failures.length, failures: failures, personIds: personIds }; });
  }

  function openConvertModal(items) {
    closeConvertModal();
    var overlay = document.createElement('div');
    overlay.id = CONVERT_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';

    var card = document.createElement('div');
    card.style.cssText = 'width:min(420px,100%);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;';

    var preview = items.slice(0, 5).map(function (it) { return '· ' + escapeHtml(it.name); }).join('<br>');
    var more = items.length > 5 ? '<br>… 等共 ' + items.length + ' 条' : '';
    card.innerHTML =
      '<div style="padding:16px 18px 10px">' +
        '<div style="font-size:15px;font-weight:700;color:#111">确认转为客户？</div>' +
        '<div style="margin-top:8px;font-size:12.5px;line-height:1.6;color:#555">' +
          '将把选中的 <b>' + items.length + '</b> 条线索同步/关联到客户(People)，按字段映射写入并生成关联编码。' +
          '<div style="margin-top:8px;color:#777">' + preview + more + '</div>' +
          '<div style="margin-top:8px;color:#a15c00">要求线索已填写「客户需求产品」，未填写的会被跳过并提示。</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px;border-top:1px solid #eee">' +
        '<button data-act="cancel" style="padding:7px 14px;border-radius:6px;border:1px solid #ddd;background:#fff;color:#555;cursor:pointer;font-size:12px;font-weight:600">取消</button>' +
        '<button data-act="ok" style="padding:7px 14px;border-radius:6px;border:none;background:#1f9d5f;color:#fff;cursor:pointer;font-size:12px;font-weight:700">确认转客户</button>' +
      '</div>';

    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeConvertModal(); });
    card.querySelector('[data-act="cancel"]').addEventListener('click', closeConvertModal);
    var okBtn = card.querySelector('[data-act="ok"]');
    okBtn.addEventListener('click', function () {
      okBtn.disabled = true;
      okBtn.textContent = '处理中…';
      runConvert(items, function (done, total) { okBtn.textContent = '处理中… ' + done + '/' + total; })
        .then(function (sum) {
          closeConvertModal();
          var parts = [];
          if (sum.created) parts.push('新建 ' + sum.created);
          if (sum.updated) parts.push('更新 ' + sum.updated);
          if (sum.failed) parts.push('失败/跳过 ' + sum.failed);
          if (sum.failed) {
            openConvertResultModal(sum);
          } else {
            convertToast('ok', '转客户完成：' + (parts.join('，') || '无变化'), 3200);
          }
          // 转成功后跳到客户列表。Twenty 记录详情无法整页深链(会 404，正常记录亦然)，
          // 故跳列表；刚转的客户 updatedAt 最新、默认排在靠前，销售一眼可见。
          if ((sum.personIds || []).length > 0 && !sum.failed) {
            window.setTimeout(function () { window.location.href = '/objects/people'; }, 700);
          }
        });
    });
    document.body.appendChild(overlay);
  }

  // 优先锚定顶部可见的「New Opportunity」按钮，让「转客户」与新建按钮并排。
  // 部分 Twenty 版本/屏幕宽度会隐藏该按钮，此时再回退到第二行的「过滤」按钮。
  function findToolbarAnchor() {
    var cands = document.querySelectorAll('button, [role="button"]');
    var newButtons = [];
    for (var i = 0; i < cands.length; i++) {
      var newBtn = cands[i];
      if (newBtn.id === CONVERT_BTN_ID || newBtn.getAttribute('data-lead-convert-top') === '1') continue;
      var newText = (newBtn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^(\+\s*)?New Opportunity$/i.test(newText)) continue;
      var newRect = newBtn.getBoundingClientRect();
      if (newRect.top >= 0 &&
          newRect.bottom <= window.innerHeight &&
          newRect.width > 0 &&
          newRect.height > 0) {
        newButtons.push(newBtn);
      }
    }
    if (newButtons.length > 0) {
      newButtons.sort(function (a, b) {
        var ar = a.getBoundingClientRect();
        var br = b.getBoundingClientRect();
        return ar.top - br.top || br.right - ar.right;
      });
      return newButtons[0];
    }

    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (el.id === CONVERT_BTN_ID || el.getAttribute('data-lead-convert-top') === '1') continue;
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t !== '过滤' && t !== '筛选' && !/^Filter$/i.test(t)) continue;
      var r = el.getBoundingClientRect();
      if (r.top > 0 && r.top < 120 && r.width > 0) return el;
    }
    return null;
  }

  function ensureConvertTopButton() {
    if (!isOpportunityListPage() || isChatVisible()) {
      var stale = document.getElementById(CONVERT_BTN_ID);
      if (stale) stale.remove();
      return;
    }
    var anchor = findToolbarAnchor();
    if (!anchor || !anchor.parentElement) return;

    var existing = document.getElementById(CONVERT_BTN_ID);
    if (existing) {
      // Twenty SPA 会在视图切换时替换顶部容器；锚点变化后把按钮重新放回正确位置。
      if (existing.parentElement !== anchor.parentElement || existing.nextElementSibling !== anchor) {
        anchor.parentElement.insertBefore(existing, anchor);
      }
      return;
    }

    var h = Math.round(anchor.getBoundingClientRect().height) || 26;
    var btn = document.createElement('button');
    btn.id = CONVERT_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('data-lead-convert-top', '1');
    btn.textContent = '转客户';
    btn.style.cssText = [
      'display:inline-flex', 'align-items:center', 'justify-content:center',
      'height:' + h + 'px', 'margin-right:8px', 'padding:0 12px', 'flex-shrink:0',
      'border-radius:6px', 'border:1px solid #1f9d5f', 'background:#1f9d5f', 'color:#fff',
      'font-size:12px', 'font-weight:600', 'font-family:inherit',
      'cursor:pointer', 'white-space:nowrap',
    ].join(';');
    btn.addEventListener('click', function () {
      var sel = getSelectedOpportunities();
      if (sel.length === 0) { convertToast('error', '请先勾选要转客户的线索'); return; }
      openConvertModal(sel);
    });
    anchor.parentElement.insertBefore(btn, anchor);
  }

  // ── boot ──────────────────────────────────────────────────────────────────

  installAuthCapture();

  function tick() { tryInsert(); ensureConvertTopButton(); }

  var observer = new MutationObserver(tick);
  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'complete') {
    tick();
  } else {
    window.addEventListener('load', tick);
  }

  // Twenty is a SPA: sidebar nodes can be replaced after navigation, role changes,
  // or metadata refreshes. Keep a low-frequency fallback so our entry survives
  // those rerenders without requiring a full browser refresh.
  setInterval(tick, 2000);

})();
