(function () {
  'use strict';

  // 版本戳：硬刷新后对照 window.__NHD_VERSION__ 即可确认当前执行的是哪一版。
  window.__NHD_VERSION__ = '20260813-nav-fix-v8';

  var CHAT_SRC   = '/chat/?v=20260813-chat-ui-auth-fix';
  var LABEL      = '对话工作台';
  var NAV_ID     = '__chat_nav_item__';
  var MAIL_LABEL = '邮箱';
  var MAIL_NAV_ID = '__mail_nav_item__';
  var SETTINGS_LABEL = '设置';
  var SETTINGS_NAV_ID = '__settings_nav_item__';
  var ACCOUNTS_SETTINGS_NAV_ID = '__settings_accounts_nav_item__';
  var EMAILS_SETTINGS_NAV_ID = '__settings_emails_nav_item__';
  var CHANNELS_SETTINGS_LABEL = '渠道';
  var CHANNELS_SETTINGS_PATH = '/settings/profile#channels';
  var CHANNELS_SETTINGS_NAV_ID = '__settings_channels_nav_item__';
  var CALENDARS_SETTINGS_NAV_ID = '__settings_calendars_nav_item__';
  var WORKSPACE_SETTINGS_NAV_ID = '__settings_workspace_nav_item__';
  var OBJECTS_SETTINGS_NAV_ID = '__settings_objects_nav_item__';
  var MEMBERS_SETTINGS_NAV_ID = '__settings_members_nav_item__';
  var API_SETTINGS_NAV_ID = '__settings_api_nav_item__';
  var CHANNELS_SETTINGS_PAGE_ID = '__settings_channels_page__';
  var EMAILS_SETTINGS_CARD_ID = '__settings_emails_card__';
  var CHANNELS_SETTINGS_CARD_ID = '__settings_channels_card__';
  var WEBSITE_RELATED_MODAL_ID = '__website_related_modal__';
  // 权限管理（仅管理员可见）
  var RBAC_SETTINGS_LABEL = '权限';
  var RBAC_SETTINGS_PATH = '/settings/accounts/permissions';
  var RBAC_SETTINGS_NAV_ID = '__settings_rbac_nav_item__';
  var RBAC_SETTINGS_PAGE_ID = '__settings_rbac_page__';
  var RBAC_SETTINGS_CARD_ID = '__settings_rbac_card__';
  var RBAC_ADMIN = null; // 缓存：当前用户是否管理员
  var IFRAME_ID  = '__chat_iframe__';
  var ACTIVE_KEY = '__chat_active__'; // 存当前激活视图：'chat' | 'mail'
  var AUTH_TOKEN = '';
  var HIDDEN_NAV_LABELS = ['Workflows', 'Workflow Runs', 'Workflow Versions', '工作流', '自动化'];
  // 对话工作台（聊天气泡）与邮箱（信封）两个入口共用同一个 iframe，靠 URL 的 view 参数切换。
  var CHAT_SVG = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
  var MAIL_SVG = '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>';
  var SETTINGS_SVG = '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>';
  var ACCOUNTS_SVG = '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>';
  var EMAILS_SVG = '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>';
  var CHANNELS_SVG = '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>';
  var CALENDAR_SVG = '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>';
  var DATABASE_SVG = '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>';
  var USERS_SVG = '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';
  var KEY_SVG = '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>';

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

  function findWebsiteUrl(value) {
    if (!value || typeof value !== 'object') return '';
    if (value.guanWangLianJie && typeof value.guanWangLianJie === 'object') {
      return String(value.guanWangLianJie.primaryLinkUrl || '').trim();
    }
    for (var key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      var found = findWebsiteUrl(value[key]);
      if (found) return found;
    }
    return '';
  }

  function websiteMutationObject(query) {
    var match = String(query || '').match(/\b(?:create|update)(Opportunity|Person|XiangMu)\b/);
    if (!match) return '';
    return { Opportunity: 'opportunity', Person: 'person', XiangMu: 'xiangMu' }[match[1]] || '';
  }

  function closeWebsiteRelatedModal() {
    var existing = document.getElementById(WEBSITE_RELATED_MODAL_ID);
    if (existing) existing.remove();
  }

  function showWebsiteRelatedModal(context, result) {
    closeWebsiteRelatedModal();
    var overlay = document.createElement('div');
    overlay.id = WEBSITE_RELATED_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100003;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(520px,100%);max-height:min(620px,90vh);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:auto;font-family:inherit;color:#18181b;';
    var rows = (result.related || []).map(function (item) {
      return '<div style="display:grid;grid-template-columns:64px 1fr;gap:10px;padding:9px 0;border-top:1px solid #f0f0f1">' +
        '<span style="font-size:12px;color:#7c3aed;font-weight:700">' + escapeHtml(item.objectLabel || '') + '</span>' +
        '<span style="font-size:12.5px;color:#3f3f46">' + escapeHtml(item.name || '未命名') + '</span>' +
      '</div>';
    }).join('');
    card.innerHTML =
      '<div style="padding:18px 20px 12px">' +
        '<div style="font-size:16px;font-weight:700">检测到相关记录</div>' +
        '<div style="margin-top:8px;font-size:13px;line-height:1.65;color:#52525b">官网域名 <b>' + escapeHtml(result.domain || '') + '</b> 已用于以下记录。当前保存已成功，是否将这些记录归入同一客户类别？</div>' +
        '<div style="margin-top:12px">' + rows + '</div>' +
        '<div style="margin-top:10px;padding:10px 12px;border-radius:6px;background:#fafafa;font-size:12px;line-height:1.6;color:#71717a">确认后只建立客户分类关系，不会合并、删除记录，也不会覆盖原有字段或业务链编码。</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:13px 20px 17px;border-top:1px solid #eee">' +
        '<button data-related-cancel style="height:32px;padding:0 14px;border-radius:6px;border:1px solid #d4d4d8;background:#fff;color:#52525b;cursor:pointer;font-size:12.5px;font-weight:600">暂不归类</button>' +
        '<button data-related-confirm style="height:32px;padding:0 14px;border-radius:6px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;cursor:pointer;font-size:12.5px;font-weight:700">确认归为同类</button>' +
      '</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) closeWebsiteRelatedModal(); });
    card.querySelector('[data-related-cancel]').addEventListener('click', closeWebsiteRelatedModal);
    var confirmButton = card.querySelector('[data-related-confirm]');
    confirmButton.addEventListener('click', function () {
      confirmButton.disabled = true;
      confirmButton.textContent = '归类中...';
      window.fetch('/conv-api/customer-websites/group', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.error || data.detail || '归类失败');
          return data;
        });
      }).then(function (data) {
        closeWebsiteRelatedModal();
        convertToast('ok', '已将 ' + data.count + ' 条记录归为同类', 3200);
      }).catch(function (error) {
        confirmButton.disabled = false;
        confirmButton.textContent = '确认归为同类';
        convertToast('error', error.message || '相关记录归类失败', 4200);
      });
    });
    document.body.appendChild(overlay);
  }

  function checkWebsiteRelatedRecords(context) {
    window.fetch('/conv-api/customer-websites/check', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || data.detail || '官网重复检查失败');
        return data;
      });
    }).then(function (data) {
      if (data.requiresConfirmation) showWebsiteRelatedModal(context, data);
    }).catch(function (error) {
      convertToast('error', error.message || '官网重复检查失败', 4200);
    });
  }

  function inspectWebsiteMutation(input, init, response) {
    try {
      var url = typeof input === 'string' ? input : input && input.url;
      if (!url || String(url).indexOf('/graphql') === -1 || !init || typeof init.body !== 'string') return;
      var requestBody = JSON.parse(init.body);
      var objectName = websiteMutationObject(requestBody.query);
      var websiteUrl = findWebsiteUrl(requestBody.variables);
      if (!objectName || !websiteUrl) return;
      response.clone().json().then(function (payload) {
        if (payload.errors || !payload.data) return;
        var recordId = requestBody.variables && requestBody.variables.id;
        if (!recordId) {
          for (var key in payload.data) {
            if (payload.data[key] && payload.data[key].id) { recordId = payload.data[key].id; break; }
          }
        }
        if (!recordId) return;
        window.setTimeout(function () {
          checkWebsiteRelatedRecords({ objectName: objectName, recordId: recordId, websiteUrl: websiteUrl });
        }, 150);
      }).catch(function () {});
    } catch (e) {}
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
        var result = originalFetch.apply(this, arguments);
        var input = arguments[0];
        var init = arguments[1] || {};
        return result.then(function (response) {
          inspectWebsiteMutation(input, init, response);
          return response;
        });
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
    var candidates = [
      AUTH_TOKEN,
      getTokenFromValue(getCookie('tokenPair')),
      getTokenFromWebStorage(window.sessionStorage),
      getTokenFromWebStorage(window.localStorage),
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (isUsableAccessToken(candidates[i])) return candidates[i];
    }
    return '';
  }

  function getTwentyAuthHeaders(extra) {
    var token = getTwentyAccessToken();
    var headers = extra || {};
    if (token) {
      headers['X-Twenty-Access-Token'] = token;
      var payload = decodeJwtPayload(token);
      if (payload && payload.sub) headers['X-Twenty-User-Id'] = payload.sub;
    }
    return headers;
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

  function isUsableAccessToken(token) {
    var payload = token ? decodeJwtPayload(token) : null;
    if (!payload || !payload.workspaceId) return false;
    var now = Math.floor(Date.now() / 1000);
    return typeof payload.exp !== 'number' || payload.exp > now + 30;
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
        if (isUsableAccessToken(token)) return token;
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

  function refreshIframeAuthToken() {
    Array.from(document.querySelectorAll('iframe[data-chat-view]')).forEach(function (iframe) {
      if (iframe.style.display !== 'none') postAuthTokenToIframe(iframe);
    });
  }

  function getViewSrc(view) {
    var token = getTwentyAccessToken();
    var hash = token ? '#twentyAccessToken=' + encodeURIComponent(token) : '';
    if (view === 'mail') hash += (hash ? '&' : '#') + 'view=mail';
    if (view === 'history') hash += (hash ? '&' : '#') + 'view=history';
    return CHAT_SRC + hash;
  }

  function getActiveView() {
    return sessionStorage.getItem(ACTIVE_KEY) || '';
  }

  function isSettingsPage() {
    return window.location.pathname.indexOf('/settings') === 0;
  }

  function isChannelsSettingsPage() {
    return window.location.pathname === '/settings/accounts/channels' ||
      (window.location.pathname === '/settings/profile' && window.location.hash === '#channels');
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

  function getIframeId(view) {
    return IFRAME_ID + '_' + (view || 'chat');
  }

  function getOrCreateIframe(view) {
    view = view || 'chat';
    var existing = document.getElementById(getIframeId(view));
    if (existing) return existing;

    var iframe = document.createElement('iframe');
    iframe.id = getIframeId(view);
    iframe.setAttribute('data-chat-view', view);
    iframe.src = getViewSrc(view);
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
      // 宽度上限放宽到 80%，兼容被拖宽的侧栏/窄视口抽屉，否则 iframe 会从 left:0
      // 起铺、把左侧菜单整块盖住（看起来就像"菜单不见了"）。
      if (rect.height > window.innerHeight * 0.6 &&
          rect.width < window.innerWidth * 0.8 &&
          rect.left === 0) {
        return rect.right;
      }
    }
    // Fallback: use the nav item's own right edge clamped to a reasonable width
    var nr = navItem.closest('[style*="position"]') || navItem.parentElement;
    var clamp = Math.max(300, Math.round(window.innerWidth * 0.5));
    return nr ? Math.min(nr.getBoundingClientRect().right, clamp) : 240;
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
    // 离开设置态时立即清理所有 fixed 覆盖层（渠道/RBAC 面板），
    // 不等 tick()/tryInsert() 的周期性延迟，避免面板残留在 chat/mail 视图上。
    removeChannelsSettingsPage();
    removeRbacSettingsPage();
    Array.from(document.querySelectorAll('iframe[data-chat-view]')).forEach(function (item) {
      item.style.display = 'none';
    });
    var iframe = getOrCreateIframe(view);
    applyIframeSize(iframe);
    iframe.style.display = 'block';
    postAuthTokenToIframe(iframe);
    window.setTimeout(function () { postAuthTokenToIframe(iframe); }, 800);
    setNavActive(view);
  }

  function hideChat() {
    sessionStorage.removeItem(ACTIVE_KEY);
    // 同上：收起时清理设置面板覆盖层
    removeChannelsSettingsPage();
    removeRbacSettingsPage();
    Array.from(document.querySelectorAll('iframe[data-chat-view]')).forEach(function (iframe) {
      iframe.style.display = 'none';
    });
    setNavActive('');
  }

  function isChatVisible() {
    return Array.from(document.querySelectorAll('iframe[data-chat-view]')).some(function (iframe) {
      return iframe.style.display !== 'none';
    });
  }

  // ── nav item active styling ────────────────────────────────────────────────

  function setNavActive(view) {
    [[ 'chat', NAV_ID ], [ 'mail', MAIL_NAV_ID ], [ 'settings', SETTINGS_NAV_ID ]].forEach(function (pair) {
      var el = document.getElementById(pair[1]);
      if (!el) return;
      var active;
      if (pair[0] === 'settings') {
        active = isSettingsPage() && !isChatVisible();
      } else {
        // 对话工作台/邮箱：激活条件统一为「当前视图匹配」且「处于聊天态或非原生页面」，
        // 与原生左侧菜单共用同一套「当前路由=高亮项」逻辑，避免两套机制并存。
        active = view === pair[0] && (isChatVisible() || !isSettingsPage());
      }
      el.setAttribute('data-active', active ? '1' : '0');
      el.style.background = active
        ? 'var(--twenty-background-tertiary,rgba(0,0,0,.06))'
        : 'transparent';
      el.style.color = active
        ? 'var(--twenty-color-purple-50,#9333ea)'
        : '';
      // 统一选中态：当我们自建入口激活时，清掉原生左侧菜单同组项的 .active，
      // 避免出现「原生项 + 自建项」同时高亮、两套机制不一致的问题。
      if (active) {
        var list = el.closest('[data-chat-nav-wrapper="1"]');
        list = list ? list.parentElement : el.parentElement;
        if (list) {
          Array.from(list.querySelectorAll('a.active')).forEach(function (a) {
            a.classList.remove('active');
          });
        }
      }
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
      if (/^\/objects\/duiHuaLiShis(\/|$|\?)/.test(href || '') || /^\/objects\/duiHuaLiShi(\/|$|\?)/.test(href || '')) {
        e.preventDefault();
        showView('history');
        return;
      }
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

  function sidebarRowFor(el, maxWidth) {
    var limit = maxWidth || 360;
    var node = el;
    for (var i = 0; i < 6 && node && node !== document.body; i++) {
      var rect = node.getBoundingClientRect();
      var style = window.getComputedStyle(node);
      if (rect.left <= 320 &&
          rect.width > 80 && rect.width <= limit &&
          rect.height >= 24 && rect.height <= 72 &&
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
      // href 命中（工作流）时按导航同一把尺放宽宽度，兼容宽侧栏/抽屉布局；
      // 纯文本命中仍保持保守上限，避免误隐藏详情页里的同名文字。
      var byHref = hrefLooksLikeDisabledNav(href);
      var maxWidth = byHref ? navRowMaxWidth() : 420;
      if (rect.left > 360 || rect.width > maxWidth) return;
      var row = sidebarRowFor(el, maxWidth);
      row.style.display = 'none';
      row.setAttribute('data-chat-hidden-native-nav', '1');
    });
  }

  // 左侧导航行的宽度上限不能硬编码：侧栏宽度可被用户拖宽，窄视口下 Twenty 还会
  // 把导航切成接近全宽的抽屉。实测出现过导航项宽 699px 的布局，旧的 width<=360
  // 会让判定永久失配 → 自建入口既插不进去、又被当成"跑偏"删掉。
  function navRowMaxWidth() {
    return Math.max(360, window.innerWidth - 40);
  }

  function isLeftNavigationRect(rect) {
    return rect.left >= 0 &&
      rect.left <= 320 &&
      rect.top >= 60 &&
      rect.top < window.innerHeight - 10 &&
      rect.width >= 80 &&
      rect.width <= navRowMaxWidth() &&
      rect.height >= 22 &&
      rect.height <= 72;
  }

  // 仅排除我们自己的 iframe（防止递归识别其内链接）。
  // 注意：旧版这里还排除了 role=dialog / aria-modal / data-modal，但 Twenty 在打开
  // 设置/详情等模态时会给「整个应用壳或导航抽屉」打上这些属性，导致左导航锚点被误杀
  // → 菜单永久消失、只能刷新。所以这里只排除自家 iframe，导航锚点改用正向的
  // 「模块 href + 左对齐几何 + 文本」判定；命令面板链接几何不同不会被误当导航，
  // 且重复注入会被 getElementById 守卫拦掉，无害。
  function isInOverlayLayer(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('iframe[data-chat-view]');
  }

  function isLeftNavigationAnchor(anchor) {
    if (!anchor || !anchor.getBoundingClientRect) return false;
    if (isInOverlayLayer(anchor)) return false;
    var rect = anchor.getBoundingClientRect();
    if (!isLeftNavigationRect(rect)) return false;
    var text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    return !!text;
  }

  // 放开宽度上限后，用结构特征兜住误判：真正的左侧导航是「左边缘对齐、竖直排列」
  // 的一组同类锚点。取该组里最靠上的一个做插入参照。只有单个候选时退回旧的
  // 保守阈值（<=360），避免把主内容区的宽链接当成导航项。
  function pickNavRefAnchor(anchors) {
    if (!anchors || anchors.length === 0) return null;
    var groups = {};
    anchors.forEach(function (anchor) {
      var rect = anchor.getBoundingClientRect();
      var key = String(Math.round(rect.left / 8));
      if (!groups[key]) groups[key] = [];
      groups[key].push({ anchor: anchor, top: rect.top });
    });
    var best = null;
    Object.keys(groups).forEach(function (key) {
      if (!best || groups[key].length > best.length) best = groups[key];
    });
    if (best && best.length >= 2) {
      best.sort(function (a, b) { return a.top - b.top; });
      return best[0].anchor;
    }
    var only = anchors[0];
    return only.getBoundingClientRect().width <= 360 ? only : null;
  }

  // 删除判定必须比插入判定更宽松。两端共用同一把尺时，尺子一旦失配就会出现
  // 「删得掉、插不回」的死锁（宽 699px 布局下菜单永久消失，只能刷新页面）。
  // 这里只在明显跑到主内容区/视口外时才回收；宽高全 0 属于折叠隐藏态，要保留。
  function isClearlyMisplacedRect(rect) {
    if (rect.width === 0 && rect.height === 0) return false;
    return rect.left > 360 ||
      rect.height > 120 ||
      rect.top > window.innerHeight + 200;
  }

  function removeMisplacedInjectedNavItems() {
    [NAV_ID, MAIL_NAV_ID, SETTINGS_NAV_ID].forEach(function (id) {
      var item = document.getElementById(id);
      if (!item) return;
      var wrapper = item.closest('[data-chat-nav-wrapper="1"]') || item;
      var rect = wrapper.getBoundingClientRect();
      if (isClearlyMisplacedRect(rect)) wrapper.remove();
    });
  }

  // ── build and insert nav item ──────────────────────────────────────────────

  function buildNavItem(refAnchor, opts) {
    var cs = window.getComputedStyle(refAnchor);

    var el = document.createElement(opts.href ? 'a' : 'div');
    el.id = opts.navId;
    if (opts.href) {
      el.href = opts.href;
    } else {
      el.role = 'button';
    }
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
      'text-decoration:none',
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

  function isCustomManagedSettingsPage() {
    return window.location.pathname === '/settings/accounts' ||
      window.location.pathname.indexOf('/settings/accounts/') === 0 ||
      isChannelsSettingsPage();
  }

  function removeInjectedSettingsNavItems() {
    [
      ACCOUNTS_SETTINGS_NAV_ID,
      EMAILS_SETTINGS_NAV_ID,
      CHANNELS_SETTINGS_NAV_ID,
      CALENDARS_SETTINGS_NAV_ID,
      WORKSPACE_SETTINGS_NAV_ID,
      OBJECTS_SETTINGS_NAV_ID,
      MEMBERS_SETTINGS_NAV_ID,
      API_SETTINGS_NAV_ID,
      RBAC_SETTINGS_NAV_ID,
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var wrapper = el.closest('[data-settings-injected-nav-wrapper="1"], [data-settings-channels-nav-wrapper="1"]');
      if (wrapper) wrapper.remove();
      else el.remove();
    });
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
    item.style.color = 'var(--twenty-font-color-secondary,#52525b)';
    var svg = item.querySelector('svg');
    if (svg) svg.style.color = 'var(--twenty-font-color-secondary,#52525b)';
  }

  function buildSettingsNavAnchor(refAnchor, opts) {
    var cs = window.getComputedStyle(refAnchor);
    var el = document.createElement('a');
    el.id = opts.id;
    el.href = opts.href || '#';
    el.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:' + cs.padding,
      'padding-left:' + (opts.level === 2 ? '32px' : '0'),
      'border-radius:' + cs.borderRadius,
      'font-size:' + cs.fontSize,
      'font-weight:' + cs.fontWeight,
      'color:var(--twenty-font-color-secondary,#52525b)',
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
    svg.style.cssText = 'flex-shrink:0;color:var(--twenty-font-color-secondary,#52525b);';
    svg.innerHTML = opts.svg;
    var span = document.createElement('span');
    span.textContent = opts.label;
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

  function buildSettingsChannelsNavItem(refAnchor) {
    return buildSettingsNavAnchor(refAnchor, {
      id: CHANNELS_SETTINGS_NAV_ID,
      href: CHANNELS_SETTINGS_PATH,
      label: CHANNELS_SETTINGS_LABEL,
      svg: CHANNELS_SVG,
      level: 2,
    });
  }

  function ensureInjectedSettingsItem(refAnchor, afterEl, opts) {
    var nativeAnchor = opts.href ? document.querySelector('a[href="' + opts.href + '"]') : null;
    var existing = nativeAnchor || document.getElementById(opts.id);
    var wrapper = existing ? existing.closest('[data-settings-injected-nav-wrapper="1"], [data-settings-channels-nav-wrapper="1"]') : null;
    if (!existing) {
      existing = buildSettingsNavAnchor(refAnchor, opts);
      wrapper = document.createElement(refAnchor.parentElement.tagName);
      wrapper.className = refAnchor.parentElement.className;
      wrapper.setAttribute('data-settings-injected-nav-wrapper', '1');
      wrapper.appendChild(existing);
    }
    var anchorParent = nativeAnchor ? nativeAnchor.parentElement : wrapper;
    var target = wrapper || anchorParent;
    if (!target) return existing;
    var span = existing.querySelector('span');
    if (span && opts.label) span.textContent = opts.label;
    if (afterEl && target.previousElementSibling !== afterEl) afterEl.insertAdjacentElement('afterend', target);
    return existing;
  }

  function ensureSettingsChannelsNav() {
    if (!isSettingsPage()) return;
    function settingsAnchorByText(text) {
      return Array.from(document.querySelectorAll('a[href^="/settings/"]')).find(function (anchor) {
        return (anchor.textContent || '').replace(/\s+/g, ' ').trim() === text;
      }) || null;
    }
    var profileAnchor = document.querySelector('a[href="/settings/profile"]');
    var appearanceAnchor = document.querySelector('a[href="/settings/profile/appearance"]') || settingsAnchorByText('体验') || settingsAnchorByText('Appearance');
    var anySettingsAnchor = document.querySelector('a[href^="/settings/"]');
    var refAnchor = appearanceAnchor || profileAnchor || anySettingsAnchor;
    if (!refAnchor || !refAnchor.parentElement) return;
    var afterProfileGroup = appearanceAnchor && appearanceAnchor.parentElement ? appearanceAnchor.parentElement : refAnchor.parentElement;
    var accountsAnchor = ensureInjectedSettingsItem(refAnchor, afterProfileGroup, {
      id: ACCOUNTS_SETTINGS_NAV_ID,
      href: '/settings/accounts',
      label: '账户',
      svg: ACCOUNTS_SVG,
    });
    var accountsRow = accountsAnchor && accountsAnchor.parentElement;
    var emailAnchor = ensureInjectedSettingsItem(refAnchor, accountsRow, {
      id: EMAILS_SETTINGS_NAV_ID,
      href: '/settings/accounts/emails',
      label: '电子邮件',
      svg: EMAILS_SVG,
      level: 2,
    });
    var emailRow = emailAnchor && emailAnchor.parentElement;
    var channelsAnchor = ensureInjectedSettingsItem(refAnchor, emailRow || accountsRow, {
      id: CHANNELS_SETTINGS_NAV_ID,
      href: CHANNELS_SETTINGS_PATH,
      label: CHANNELS_SETTINGS_LABEL,
      svg: CHANNELS_SVG,
      level: 2,
    });
    var channelsRow = channelsAnchor && channelsAnchor.parentElement;
    var calendarAnchor = ensureInjectedSettingsItem(refAnchor, channelsRow || emailRow || accountsRow, {
      id: CALENDARS_SETTINGS_NAV_ID,
      href: '',
      label: '日历',
      svg: CALENDAR_SVG,
      level: 2,
    });
    var calendarRow = calendarAnchor && calendarAnchor.parentElement;
    var workspaceAnchor = ensureInjectedSettingsItem(refAnchor, calendarRow || channelsRow || emailRow || accountsRow, {
      id: WORKSPACE_SETTINGS_NAV_ID,
      href: '/settings/workspace',
      label: '常规',
      svg: SETTINGS_SVG,
    });
    var workspaceRow = workspaceAnchor && workspaceAnchor.parentElement;
    var objectsAnchor = ensureInjectedSettingsItem(refAnchor, workspaceRow, {
      id: OBJECTS_SETTINGS_NAV_ID,
      href: '/settings/objects',
      label: '数据模型',
      svg: DATABASE_SVG,
    });
    var objectsRow = objectsAnchor && objectsAnchor.parentElement;
    var membersAnchor = ensureInjectedSettingsItem(refAnchor, objectsRow, {
      id: MEMBERS_SETTINGS_NAV_ID,
      href: '/settings/workspace-members',
      label: '成员',
      svg: USERS_SVG,
    });
    var membersRow = membersAnchor && membersAnchor.parentElement;
    ensureInjectedSettingsItem(refAnchor, membersRow, {
      id: API_SETTINGS_NAV_ID,
      href: '/settings/api-keys',
      label: 'API 和 Webhooks',
      svg: KEY_SVG,
    });
    setSettingsChannelsActive();
  }

  // 在设置页（含「自定义布局」页）左侧导航尾部追加对话工作台/邮箱两个入口，
  // 使其与主导航表现一致、可被自定义布局界面看到。复用 buildNavItem 以保证
  // 点击行为（showView）和选中态（setNavActive）与主导航同一套机制。
  function ensureSettingsChatNav() {
    if (!isSettingsPage()) return;
    var refAnchor = document.querySelector('a[href^="/settings/"]');
    if (!refAnchor || !refAnchor.parentElement) return;
    var listEl = refAnchor.parentElement;
    [
      { navId: NAV_ID, label: LABEL, svg: CHAT_SVG, view: 'chat' },
      { navId: MAIL_NAV_ID, label: MAIL_LABEL, svg: MAIL_SVG, view: 'mail' },
    ].forEach(function (opts) {
      if (document.getElementById(opts.navId)) return;
      var item = buildNavItem(refAnchor, opts);
      var wrapper = document.createElement(listEl.tagName);
      wrapper.className = listEl.className;
      wrapper.setAttribute('data-chat-nav-wrapper', '1');
      wrapper.appendChild(item);
      listEl.appendChild(wrapper);
    });
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
    var binding = state && state.binding || {};
    var boundToCurrentUser = !!binding.boundToCurrentUser;
    var boundByOther = !!binding.boundByOther;
    var recoverableQr = state && ['FAILED', 'STOPPED', 'STARTING'].indexOf(state.status) !== -1;
    var waitingQr = state && (state.qrAvailable || recoverableQr);
    root.querySelector('[data-wa-status]').textContent = state ? statusLabel(state.status) : '加载中';
    root.querySelector('[data-wa-status]').style.background = connected ? '#dcfce7' : waitingQr ? '#fef3c7' : '#f4f4f5';
    root.querySelector('[data-wa-status]').style.color = connected ? '#166534' : waitingQr ? '#92400e' : '#52525b';
    root.querySelector('[data-wa-phone]').textContent = state ? (state.phone || '-') : '-';
    root.querySelector('[data-wa-name]').textContent = state ? (state.displayName || '-') : '-';
    root.querySelector('[data-wa-account-id]').textContent = state ? (state.accountId || '-') : '-';
    root.querySelector('[data-wa-binding]').textContent = boundToCurrentUser
      ? '已绑定到我的账号'
      : boundByOther
        ? '已被其他用户绑定：' + (binding.ownerName || '其他 CRM 用户')
        : connected
          ? '已连接，未绑定到 CRM 账号'
          : '未绑定';
    root.querySelector('[data-wa-updated]').textContent = '最后刷新 ' + formatNow();
    var startButton = root.querySelector('[data-wa-start]');
    if (startButton) {
      var startDisabled = connected || boundByOther;
      startButton.setAttribute('data-connected-disabled', startDisabled ? '1' : '0');
      startButton.disabled = startDisabled;
      startButton.style.opacity = startDisabled ? '0.5' : '';
      startButton.style.cursor = startDisabled ? 'not-allowed' : 'pointer';
      startButton.title = boundByOther ? '该 WhatsApp 已绑定到其他用户' : connected ? '已连接时不需要重新生成二维码' : '重启 WhatsApp 会话并生成新的二维码';
    }
    var codeButton = root.querySelector('[data-wa-code]');
    var phoneInput = root.querySelector('[data-wa-phone-input]');
    if (codeButton) {
      var codeDisabled = connected || boundByOther;
      codeButton.setAttribute('data-connected-disabled', codeDisabled ? '1' : '0');
      codeButton.disabled = codeDisabled;
      codeButton.style.opacity = codeDisabled ? '0.5' : '';
      codeButton.style.cursor = codeDisabled ? 'not-allowed' : 'pointer';
      codeButton.title = boundByOther ? '该 WhatsApp 已绑定到其他用户' : connected ? '已连接时不需要生成配对码' : '生成 WhatsApp 手机号配对码';
    }
    if (phoneInput) phoneInput.disabled = connected || boundByOther;
    var bindButton = root.querySelector('[data-wa-bind]');
    if (bindButton) {
      bindButton.disabled = !connected || boundToCurrentUser || boundByOther;
      bindButton.setAttribute('data-connected-disabled', bindButton.disabled ? '1' : '0');
      bindButton.style.opacity = bindButton.disabled ? '0.5' : '';
      bindButton.style.cursor = bindButton.disabled ? 'not-allowed' : 'pointer';
    }
    var unbindButton = root.querySelector('[data-wa-unbind]');
    if (unbindButton) {
      unbindButton.disabled = !boundToCurrentUser;
      unbindButton.setAttribute('data-connected-disabled', unbindButton.disabled ? '1' : '0');
      unbindButton.style.opacity = unbindButton.disabled ? '0.5' : '';
      unbindButton.style.cursor = unbindButton.disabled ? 'not-allowed' : 'pointer';
    }
    root.querySelector('[data-wa-help]').textContent = connected
      ? boundToCurrentUser
        ? '该 WhatsApp 已绑定到你的 CRM 账号，可在对话工作台收发消息。'
        : boundByOther
          ? '该 WhatsApp 已绑定到其他 CRM 用户，当前账号不能使用。'
          : '该 WhatsApp 已连接，但还未绑定到 CRM 账号。请点击“绑定到我的账号”。'
      : waitingQr
        ? (state.status === 'FAILED' ? '当前会话异常，系统会自动重新生成二维码。请稍等几秒后扫码。' : '请用 WhatsApp 手机端扫描下方二维码，完成后页面会自动刷新状态。')
        : '如未显示二维码，请点击“启动/刷新二维码”。';
    var qrBox = root.querySelector('[data-wa-qr-box]');
    qrBox.style.display = waitingQr ? 'block' : 'none';
    if (waitingQr) {
      loadWhatsAppQr(root);
    }
  }

  function loadWhatsAppQr(root) {
    var qr = root.querySelector('[data-wa-qr]');
    if (!qr) return;
    window.fetch('/conv-api/channel-accounts/whatsapp/qr?t=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    })
      .then(function (response) {
        if (!response.ok) return readChannelApiResponse(response, '二维码生成失败');
        return response.blob();
      })
      .then(function (blob) {
        if (!blob || !blob.type) return;
        if (qr.dataset.objectUrl) window.URL.revokeObjectURL(qr.dataset.objectUrl);
        var url = window.URL.createObjectURL(blob);
        qr.dataset.objectUrl = url;
        qr.src = url;
        root.querySelector('[data-wa-error]').textContent = '';
      })
      .catch(function (error) {
        root.querySelector('[data-wa-error]').textContent = error.message || '二维码生成中，请稍后刷新状态';
      });
  }

  function loadWhatsAppStatus(root) {
    root.querySelector('[data-wa-error]').textContent = '';
    return window.fetch('/conv-api/channel-accounts/whatsapp/status', { credentials: 'same-origin', headers: getTwentyAuthHeaders() })
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
            '<div style="color:#71717a">WhatsApp ID</div><div data-wa-account-id>-</div>' +
            '<div style="color:#71717a">CRM 绑定</div><div data-wa-binding>-</div>' +
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
            '<button data-wa-bind style="height:30px;padding:0 12px;border-radius:6px;border:1px solid #16a34a;background:#16a34a;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">绑定到我的账号</button>' +
            '<button data-wa-unbind style="height:30px;padding:0 12px;border-radius:6px;border:1px solid #dc2626;background:#fff;color:#dc2626;font-size:12.5px;font-weight:700;cursor:pointer">解绑</button>' +
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
      window.fetch('/conv-api/channel-accounts/whatsapp/restart', { method: 'POST', credentials: 'same-origin', headers: getTwentyAuthHeaders() })
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
        headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
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
    root.querySelector('[data-wa-bind]').addEventListener('click', function () {
      root.querySelector('[data-wa-error]').textContent = '';
      setWaButtonBusy(root, '[data-wa-bind]', '绑定中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp/bind', {
        method: 'POST',
        credentials: 'same-origin',
        headers: getTwentyAuthHeaders(),
      })
        .then(function (response) { return readChannelApiResponse(response, '绑定失败'); })
        .then(function () { return loadWhatsAppStatus(root); })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '绑定失败'; })
        .finally(function () {
          setWaButtonBusy(root, '[data-wa-bind]', '绑定中...', false);
        });
    });
    root.querySelector('[data-wa-unbind]').addEventListener('click', function () {
      if (!window.confirm('确认解绑当前 WhatsApp？解绑后该账号将不能继续在 CRM 中收发 WhatsApp，需要重新扫码或配对后再绑定。')) return;
      root.querySelector('[data-wa-error]').textContent = '';
      setWaButtonBusy(root, '[data-wa-unbind]', '解绑中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: getTwentyAuthHeaders(),
      })
        .then(function (response) { return readChannelApiResponse(response, '解绑失败'); })
        .then(function () { return loadWhatsAppStatus(root); })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '解绑失败'; })
        .finally(function () {
          setWaButtonBusy(root, '[data-wa-unbind]', '解绑中...', false);
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

  // ===== 权限管理（仅管理员） =====
  function loadRbacAdminStatus(cb) {
    if (RBAC_ADMIN !== null) { cb(RBAC_ADMIN); return; }
    window.fetch('/conv-api/rbac/members', { method: 'GET', credentials: 'same-origin', headers: getTwentyAuthHeaders() })
      .then(function (response) {
        RBAC_ADMIN = response.ok; // 200=管理员；403=非管理员
        cb(RBAC_ADMIN);
      })
      .catch(function () { RBAC_ADMIN = false; cb(false); });
  }

  function ensureSettingsAccountsRbacCard() {
    if (window.location.pathname !== '/settings/accounts') {
      var stale = document.getElementById(RBAC_SETTINGS_CARD_ID);
      if (stale) stale.remove();
      return;
    }
    if (document.getElementById(RBAC_SETTINGS_CARD_ID)) return;
    loadRbacAdminStatus(function (isAdmin) {
      if (!isAdmin) return; // 非管理员不显示权限卡片
      var sections = Array.from(document.querySelectorAll('h2, [role="heading"]'));
      var settingsHeading = sections.find(function (el) { var t = (el.textContent || '').trim(); return t === 'Settings' || t === '设置'; });
      if (!settingsHeading) return;
      var section = settingsHeading.closest('section') || settingsHeading.parentElement;
      if (!section) return;
      var cardsHost = Array.from(section.querySelectorAll('div')).find(function (el) {
        var rect = el.getBoundingClientRect();
        return rect.width > 300 && rect.height > 40 && window.getComputedStyle(el).display === 'flex';
      });
      if (!cardsHost) return;
      var card = document.createElement('div');
      card.id = RBAC_SETTINGS_CARD_ID;
      card.style.cssText = 'border:1px solid #e4e4e7;border-radius:8px;padding:16px;min-width:220px;flex:1;cursor:pointer;background:#fff;color:#71717a';
      card.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px;color:#3f3f46;font-weight:600">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>' +
          '<span style="flex:1">权限</span><span style="color:#a1a1aa">›</span>' +
        '</div>' +
        '<div style="padding-left:32px;margin-top:8px;font-size:13px">为成员分配角色：后台管理员 / 销售主管 / 销售。</div>';
      card.addEventListener('click', function () { window.location.href = RBAC_SETTINGS_PATH; });
      cardsHost.appendChild(card);
    });
  }

  function isRbacSettingsPage() {
    return window.location.pathname === RBAC_SETTINGS_PATH;
  }

  function removeRbacSettingsPage() {
    var page = document.getElementById(RBAC_SETTINGS_PAGE_ID);
    if (page) page.remove();
  }

  function renderRbacSettingsPage() {
    if (!isRbacSettingsPage()) {
      removeRbacSettingsPage();
      return;
    }
    var existing = document.getElementById(RBAC_SETTINGS_PAGE_ID);
    if (existing) {
      existing.style.left = settingsDrawerRight() + 'px';
      return;
    }
    var root = document.createElement('div');
    root.id = RBAC_SETTINGS_PAGE_ID;
    root.style.cssText = [
      'position:fixed', 'top:0', 'right:0', 'bottom:0',
      'left:' + settingsDrawerRight() + 'px', 'z-index:90',
      'background:var(--twenty-background-primary,#fff)', 'overflow:auto',
      'padding:32px 40px', 'box-sizing:border-box',
      'font-family:inherit', 'color:var(--twenty-font-color-primary,#18181b)',
    ].join(';');
    root.innerHTML =
      '<div style="max-width:820px">' +
        '<div style="font-size:13px;color:#71717a;margin-bottom:12px">账户 / 权限</div>' +
        '<h1 style="font-size:22px;line-height:1.3;margin:0 0 8px;font-weight:700">权限</h1>' +
        '<p style="font-size:13px;color:#71717a;margin:0 0 24px">为工作区成员分配角色。后台管理员可查看并操作全部会话；销售主管查看团队；销售仅看自己。</p>' +
        '<div data-rbac-loading style="font-size:13px;color:#71717a">正在加载成员与角色…</div>' +
        '<div data-rbac-error style="font-size:13px;color:#dc2626;display:none"></div>' +
        '<div data-rbac-list style="display:none;margin-top:8px"></div>' +
      '</div>';
    document.body.appendChild(root);
    loadRbacData(root);
  }

  function loadRbacData(root, attempt) {
    var listEl = root.querySelector('[data-rbac-list]');
    var loadingEl = root.querySelector('[data-rbac-loading]');
    var errorEl = root.querySelector('[data-rbac-error]');
    // 硬刷直达本页时，Twenty 可能还没把登录令牌写进 storage/cookie，
    // 令牌捕获也尚未拿到。此时先等待重试（最多约 5 秒），避免误报「登录已失效」。
    attempt = attempt || 0;
    if (!getTwentyAccessToken() && attempt < 10) {
      if (loadingEl) { loadingEl.style.display = 'block'; loadingEl.textContent = '正在等待登录状态…'; }
      setTimeout(function () { loadRbacData(root, attempt + 1); }, 500);
      return;
    }
    if (loadingEl) loadingEl.textContent = '正在加载成员与角色…';
    Promise.all([
      window.fetch('/conv-api/rbac/members', { method: 'GET', credentials: 'same-origin', headers: getTwentyAuthHeaders() }).then(function (r) { return readChannelApiResponse(r, '加载失败'); }),
      window.fetch('/conv-api/rbac/role-scopes', { method: 'GET', credentials: 'same-origin', headers: getTwentyAuthHeaders() }).then(function (r) { return readChannelApiResponse(r, '加载失败'); }),
    ]).then(function (results) {
      var members = results[0].members || [];
      var scopes = results[1].roles || [];
      loadingEl.style.display = 'none';
      listEl.style.display = 'block';
      renderRbacRows(root, members, scopes);
    }).catch(function (error) {
      loadingEl.style.display = 'none';
      errorEl.style.display = 'block';
      errorEl.textContent = error.message || '加载失败';
    });
  }

  function renderRbacRows(root, members, scopes) {
    var listEl = root.querySelector('[data-rbac-list]');
    var scopesByRole = {};
    scopes.forEach(function (s) { scopesByRole[s.role] = s; });
    var rows = members.map(function (m) {
      var options = scopes.map(function (s) {
        var selected = s.role === m.role ? ' selected' : '';
        return '<option value="' + escapeHtml(s.role) + '"' + selected + '>' + escapeHtml(roleLabel(s.role)) + '</option>';
      }).join('');
      return '<div style="display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid #f0f0f1;border-radius:8px;margin-bottom:8px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14px;font-weight:600">' + escapeHtml(m.name) + '</div>' +
          '<div style="font-size:12.5px;color:#71717a">' + escapeHtml(m.email || '-') + '</div>' +
          '<div data-rbac-scope style="font-size:12px;color:#52525b;margin-top:2px"></div>' +
        '</div>' +
        '<select data-rbac-role="' + escapeHtml(m.memberId) + '" style="height:32px;border:1px solid #d4d4d8;border-radius:6px;padding:0 8px;font-size:13px;background:#fff">' + options + '</select>' +
        '<button data-rbac-save="' + escapeHtml(m.memberId) + '" style="height:32px;padding:0 14px;border-radius:6px;border:1px solid #16a34a;background:#16a34a;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">保存</button>' +
        '<button data-rbac-reset="' + escapeHtml(m.memberId) + '" style="height:32px;padding:0 10px;border-radius:6px;border:1px solid #d4d4d8;background:#fff;color:#71717a;font-size:12.5px;cursor:pointer">重置</button>' +
        '<button data-rbac-pwd="' + escapeHtml(m.memberId) + '" style="height:32px;padding:0 10px;border-radius:6px;border:1px solid #d97706;background:#fff;color:#b45309;font-size:12.5px;cursor:pointer">重置密码</button>' +
      '</div>';
    }).join('');
    listEl.innerHTML = rows;
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-rbac-role]'), function (sel) {
      var memberId = sel.getAttribute('data-rbac-role');
      var member = members.find(function (m) { return m.memberId === memberId; });
      var scopeEl = sel.parentElement.querySelector('[data-rbac-scope]');
      if (scopeEl && member) scopeEl.textContent = (scopesByRole[member.role] && scopesByRole[member.role].description) || '';
      sel.addEventListener('change', function () {
        if (scopeEl) scopeEl.textContent = (scopesByRole[sel.value] && scopesByRole[sel.value].description) || '';
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-rbac-save]'), function (btn) {
      btn.addEventListener('click', function () {
        var memberId = btn.getAttribute('data-rbac-save');
        var sel = listEl.querySelector('[data-rbac-role="' + memberId + '"]');
        var role = sel && sel.value;
        setRbacButtonBusy(btn, true);
        window.fetch('/conv-api/rbac/roles/' + encodeURIComponent(memberId), {
          method: 'PUT', credentials: 'same-origin',
          headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ role: role }),
        })
          .then(function (response) { return readChannelApiResponse(response, '保存失败'); })
          .then(function () { root.querySelector('[data-rbac-error]').style.display = 'none'; })
          .catch(function (error) {
            var errorEl = root.querySelector('[data-rbac-error]');
            errorEl.style.display = 'block';
            errorEl.style.color = '#e1262b';
            errorEl.textContent = error.message || '保存失败';
          })
          .finally(function () { setRbacButtonBusy(btn, false); });
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-rbac-reset]'), function (btn) {
      btn.addEventListener('click', function () {
        var memberId = btn.getAttribute('data-rbac-reset');
        if (!window.confirm('确认将该成员的角色重置为默认的「销售」？')) return;
        setRbacButtonBusy(btn, true);
        window.fetch('/conv-api/rbac/roles/' + encodeURIComponent(memberId), {
          method: 'DELETE', credentials: 'same-origin', headers: getTwentyAuthHeaders(),
        })
          .then(function (response) { return readChannelApiResponse(response, '重置失败'); })
          .then(function () {
            var sel = listEl.querySelector('[data-rbac-role="' + memberId + '"]');
            if (sel) sel.value = 'sales';
            var scopeEl = sel && sel.parentElement.querySelector('[data-rbac-scope]');
            if (scopeEl) scopeEl.textContent = (scopesByRole['sales'] && scopesByRole['sales'].description) || '';
          })
          .catch(function (error) {
            var errorEl = root.querySelector('[data-rbac-error]');
            errorEl.style.display = 'block';
            errorEl.style.color = '#e1262b';
            errorEl.textContent = error.message || '重置失败';
          })
          .finally(function () { setRbacButtonBusy(btn, false); });
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-rbac-pwd]'), function (btn) {
      btn.addEventListener('click', function () {
        var memberId = btn.getAttribute('data-rbac-pwd');
        var member = members.find(function (m) { return m.memberId === memberId; });
        openResetPwdModal(root, member || { memberId: memberId, name: '', email: '' });
      });
    });
  }

  // 管理员为成员重置登录密码：小弹窗输入新密码 + 二次确认，前端先做 ≥8 位校验，
  // 提交到 POST /conv-api/rbac/members/:id/reset-password（后端 requireAdmin 二次把关）。
  function openResetPwdModal(root, member) {
    var existing = document.getElementById('__rbac_pwd_modal__');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = '__rbac_pwd_modal__';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100003;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(420px,100%);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);font-family:inherit;overflow:hidden';
    card.innerHTML =
      '<div style="padding:16px 18px 6px;font-size:15px;font-weight:700;color:#111">重置登录密码</div>' +
      '<div style="padding:0 18px;font-size:12.5px;color:#71717a">为 <b>' + escapeHtml(member.name || member.email || '该成员') + '</b>' + (member.email ? '（' + escapeHtml(member.email) + '）' : '') + ' 设置新的登录密码。重置后请把新密码线下告知本人。</div>' +
      '<div style="padding:14px 18px 4px">' +
        '<input type="password" data-pwd-1 placeholder="新密码（至少 8 位）" autocomplete="new-password" style="width:100%;box-sizing:border-box;height:36px;border:1px solid #d4d4d8;border-radius:6px;padding:0 10px;font-size:13px;margin-bottom:10px" />' +
        '<input type="password" data-pwd-2 placeholder="再次输入新密码" autocomplete="new-password" style="width:100%;box-sizing:border-box;height:36px;border:1px solid #d4d4d8;border-radius:6px;padding:0 10px;font-size:13px" />' +
        '<div data-pwd-err style="display:none;margin-top:8px;font-size:12px;color:#e1262b"></div>' +
      '</div>' +
      '<div style="padding:12px 18px 16px;display:flex;justify-content:flex-end;gap:10px">' +
        '<button data-pwd-cancel style="height:34px;padding:0 14px;border-radius:6px;border:1px solid #d4d4d8;background:#fff;color:#52525b;font-size:13px;cursor:pointer">取消</button>' +
        '<button data-pwd-submit style="height:34px;padding:0 16px;border-radius:6px;border:1px solid #d97706;background:#d97706;color:#fff;font-size:13px;font-weight:700;cursor:pointer">确认重置</button>' +
      '</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    card.querySelector('[data-pwd-cancel]').addEventListener('click', function () { overlay.remove(); });
    var errEl = card.querySelector('[data-pwd-err]');
    var submitBtn = card.querySelector('[data-pwd-submit]');
    function showErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
    submitBtn.addEventListener('click', function () {
      var p1 = card.querySelector('[data-pwd-1]').value || '';
      var p2 = card.querySelector('[data-pwd-2]').value || '';
      if (p1.length < 8) return showErr('新密码至少 8 位');
      if (p1 !== p2) return showErr('两次输入的密码不一致');
      errEl.style.display = 'none';
      setRbacButtonBusy(submitBtn, true);
      window.fetch('/conv-api/rbac/members/' + encodeURIComponent(member.memberId) + '/reset-password', {
        method: 'POST', credentials: 'same-origin',
        headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ newPassword: p1 }),
      })
        .then(function (response) { return readChannelApiResponse(response, '重置失败'); })
        .then(function () {
          overlay.remove();
          var okEl = root.querySelector('[data-rbac-error]');
          if (okEl) { okEl.style.display = 'block'; okEl.style.color = '#16a34a'; okEl.textContent = '已重置 ' + (member.name || member.email || '该成员') + ' 的登录密码，请线下告知新密码。'; }
        })
        .catch(function (error) {
          setRbacButtonBusy(submitBtn, false);
          showErr(error.message || '重置失败');
        });
    });
    document.body.appendChild(overlay);
    var first = card.querySelector('[data-pwd-1]');
    if (first) first.focus();
  }

  function roleLabel(role) {
    return ({ admin: '后台管理员', manager: '销售主管', sales: '销售', boss: '总经理' })[role] || role;
  }

  function setRbacButtonBusy(button, isBusy) {
    if (isBusy) {
      button.setAttribute('data-rbac-original', button.textContent || '');
      button.textContent = '保存中…';
      button.disabled = true;
      button.style.opacity = '0.65';
      button.style.cursor = 'wait';
      return;
    }
    button.textContent = button.getAttribute('data-rbac-original') || button.textContent;
    button.disabled = false;
    button.style.opacity = '';
    button.style.cursor = 'pointer';
  }

  function removeSettingsAccountsCards() {
    [EMAILS_SETTINGS_CARD_ID, CHANNELS_SETTINGS_CARD_ID].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  function findSettingsAccountsCardsHost() {
    var headings = Array.from(document.querySelectorAll('h1, h2, [role="heading"]'));
    var settingsHeading = headings.find(function (el) {
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return ['Settings', '设置', 'Accounts', 'Account', '账户', '账号'].indexOf(text) !== -1;
    });
    var section = settingsHeading && (settingsHeading.closest('section') || settingsHeading.parentElement);
    if (!section) section = document.querySelector('main') || document.querySelector('[role="main"]');
    if (!section) return null;
    return Array.from(section.querySelectorAll('div')).find(function (el) {
      var rect = el.getBoundingClientRect();
      var style = window.getComputedStyle(el);
      return rect.width > 300 && rect.height > 40 && style.display === 'flex';
    }) || section;
  }

  function buildSettingsAccountsCard(opts) {
    var card = document.createElement('div');
    card.id = opts.id;
    card.style.cssText = 'border:1px solid #e4e4e7;border-radius:8px;padding:16px;min-width:220px;flex:1;cursor:pointer;background:#fff;color:#71717a';
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;color:#3f3f46;font-weight:600">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + opts.svg + '</svg>' +
        '<span style="flex:1">' + opts.label + '</span><span style="color:#a1a1aa">›</span>' +
      '</div>' +
      '<div style="padding-left:32px;margin-top:8px;font-size:13px">' + opts.description + '</div>';
    card.addEventListener('click', function () { window.location.href = opts.href; });
    return card;
  }

  function ensureSettingsAccountsCards() {
    if (window.location.pathname !== '/settings/accounts') {
      removeSettingsAccountsCards();
      return;
    }
    if (document.getElementById(EMAILS_SETTINGS_CARD_ID) && document.getElementById(CHANNELS_SETTINGS_CARD_ID)) return;
    var cardsHost = findSettingsAccountsCardsHost();
    if (!cardsHost) return;
    if (!document.getElementById(EMAILS_SETTINGS_CARD_ID)) {
      cardsHost.appendChild(buildSettingsAccountsCard({
        id: EMAILS_SETTINGS_CARD_ID,
        href: '/settings/accounts/emails',
        label: '电子邮件',
        description: '绑定和管理 CRM 邮箱账号。',
        svg: EMAILS_SVG,
      }));
    }
    if (!document.getElementById(CHANNELS_SETTINGS_CARD_ID)) {
      cardsHost.appendChild(buildSettingsAccountsCard({
        id: CHANNELS_SETTINGS_CARD_ID,
        href: CHANNELS_SETTINGS_PATH,
        label: CHANNELS_SETTINGS_LABEL,
        description: '绑定 WhatsApp 等外部沟通渠道。',
        svg: CHANNELS_SVG,
      }));
    }
  }

  function tryInsert() {
    try { var _s = window.__NHD_STATE__; if (_s) { _s.lastTryInsertAt = Date.now(); _s.lastSettings = isSettingsPage(); } } catch (_) {}
    hideDisabledNativeNavItems();
    if (isSettingsPage()) {
      // 注入层兼容：在设置页（含「自定义布局」页）左侧导航也呈现对话工作台/邮箱，
      // 不再整体移除自建入口，避免它们从设置页左侧消失、无法进行自定义布局调整。
      ensureSettingsChatNav();
      ensureSettingsChannelsNav();
      setNavActive(getActiveView());
      if (isCustomManagedSettingsPage()) {
        ensureSettingsAccountsCards();
        ensureSettingsAccountsRbacCard();
        renderChannelsSettingsPage();
        renderRbacSettingsPage();
      } else {
        removeSettingsAccountsCards();
        removeChannelsSettingsPage();
        removeRbacSettingsPage();
      }
      return;
    }
    removeChannelsSettingsPage();
    removeRbacSettingsPage();

    removeMisplacedInjectedNavItems();

    var navAnchors = Array.from(document.querySelectorAll('a[href]')).filter(function (a) {
      var href = a.getAttribute('href') || '';
      if (!isLeftNavigationAnchor(a)) return false;
      // 只认「模块根路径」的导航链接（可带 ?viewId=/#hash）。记录详情链接会多一段 id，
      // 放开宽度上限后如果不卡这一条，列表页内容区的记录行可能被误当成导航参照。
      return /^\/(people|companies|opportunities|notes|tasks|messages)(\?|#|$)/.test(href) ||
             /^\/objects\/[^\/?#]+(\?|#|$)/.test(href);
    });

    if (window.__NHD_STATE__) window.__NHD_STATE__.lastNavAnchors = navAnchors.length;
    var refAnchor = pickNavRefAnchor(navAnchors);
    if (window.__NHD_STATE__) window.__NHD_STATE__.lastRefAnchor = refAnchor ? 'found' : 'null';
    if (!refAnchor) return;
    var container = refAnchor.parentElement;
    if (!container) return;

    // Find the ul/div that holds multiple peer nav items
    var listEl = container;
    if (container.children.length < 2 && container.parentElement) {
      listEl = container.parentElement;
      container = refAnchor.parentElement; // keep ref for cloning wrapper
    }

    // insertBefore 的参照必须是 listEl 的直接子节点，否则浏览器会抛
    // NotFoundError（tryInsert 一抛，后面的按钮/入口注入也全被带停）。
    var insertBeforeNode = refAnchor;
    while (insertBeforeNode && insertBeforeNode.parentElement !== listEl) {
      insertBeforeNode = insertBeforeNode.parentElement;
    }

    if (!isSettingsPage()) {
      [
        { navId: NAV_ID, label: LABEL, svg: CHAT_SVG, view: 'chat' },
        { navId: MAIL_NAV_ID, label: MAIL_LABEL, svg: MAIL_SVG, view: 'mail' },
      ].forEach(function (opts) {
        if (document.getElementById(opts.navId)) return;
        var item = buildNavItem(refAnchor, opts);
        var wrapper = document.createElement(container.tagName);
        wrapper.className = container.className;
        wrapper.setAttribute('data-chat-nav-wrapper', '1');
        wrapper.appendChild(item);
        if (insertBeforeNode) listEl.insertBefore(wrapper, insertBeforeNode);
        else listEl.appendChild(wrapper);
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

    setNavActive(getActiveView());
  }

  // ── resize: keep iframe filling the content area ──────────────────────────

  window.addEventListener('resize', function () {
    Array.from(document.querySelectorAll('iframe[data-chat-view]')).forEach(function (iframe) {
      if (iframe.style.display !== 'none') applyIframeSize(iframe);
    });
  });

  // ── 线索转客户：线索列表顶部「转客户」按钮（放在 +New opportunity 左侧）──────────
  var CONVERT_BTN_ID = '__lead_convert_top_btn__';
  var CONVERT_PROJECT_BTN_ID = '__lead_convert_project_top_btn__';
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
    if (data.code === 'PRODUCT_REQUIRED') return String(data.detail || '请先填写「客户需求产品」，再执行。');
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

  function openConvertResultModal(summary, mode) {
    var failures = summary.failures || [];
    if (!failures.length) return;
    var targetLabel = mode === 'project' ? '项目' : '客户';
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
        '<div style="font-size:15px;font-weight:700;color:#111">部分线索转' + targetLabel + '失败</div>' +
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

  function runConvert(items, mode, onProgress) {
    var created = 0, updated = 0, personIds = [], projectIds = [], failures = [];
    var endpoint = mode === 'project' ? 'convert-to-project' : 'convert-to-person';
    var chain = Promise.resolve();
    items.forEach(function (item, idx) {
      chain = chain.then(function () {
        onProgress(idx + 1, items.length);
        return window.fetch('/conv-api/opportunities/' + encodeURIComponent(item.id) + '/' + endpoint, {
          method: 'POST',
          headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
          credentials: 'same-origin',
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (data) {
            if (!r.ok) {
              failures.push({ id: item.id, name: item.name, reason: convertErrorMessage(r.status, data) });
              return;
            }
            if (data && data.personId) personIds.push(data.personId);
            if (data && data.projectId) projectIds.push(data.projectId);
            if (data && data.created) created++; else updated++;
          });
        }).catch(function (error) {
          failures.push({ id: item.id, name: item.name, reason: error.message || '网络请求失败' });
        });
      });
    });
    return chain.then(function () { return { created: created, updated: updated, failed: failures.length, failures: failures, personIds: personIds, projectIds: projectIds }; });
  }

  function openConvertModal(items, mode) {
    closeConvertModal();
    var targetLabel = mode === 'project' ? '项目' : '客户';
    var targetObject = mode === 'project' ? '项目' : '客户(People)';
    var actionText = mode === 'project' ? '确认转项目' : '确认转客户';
    var noteText = mode === 'project'
      ? '系统会自动补齐客户关联与关联编码。'
      : '系统会按字段映射写入并生成关联编码。';
    var overlay = document.createElement('div');
    overlay.id = CONVERT_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';

    var card = document.createElement('div');
    card.style.cssText = 'width:min(420px,100%);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;';

    var preview = items.slice(0, 5).map(function (it) { return '· ' + escapeHtml(it.name); }).join('<br>');
    var more = items.length > 5 ? '<br>… 等共 ' + items.length + ' 条' : '';
    card.innerHTML =
      '<div style="padding:16px 18px 10px">' +
        '<div style="font-size:15px;font-weight:700;color:#111">确认转为' + targetLabel + '？</div>' +
        '<div style="margin-top:8px;font-size:12.5px;line-height:1.6;color:#555">' +
          '选中的 <b>' + items.length + '</b> 条线索将同步/关联到' + targetObject + '。' + noteText +
          '<div style="margin-top:8px;color:#777">' + preview + more + '</div>' +
          '<div style="margin-top:8px;color:#a15c00">要求线索已填写「客户需求产品」，未填写的会被跳过并提示。</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px;border-top:1px solid #eee">' +
        '<button data-act="cancel" style="padding:7px 14px;border-radius:6px;border:1px solid #ddd;background:#fff;color:#555;cursor:pointer;font-size:12px;font-weight:600">取消</button>' +
        '<button data-act="ok" style="padding:7px 14px;border-radius:6px;border:none;background:#1f9d5f;color:#fff;cursor:pointer;font-size:12px;font-weight:700">' + actionText + '</button>' +
      '</div>';

    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeConvertModal(); });
    card.querySelector('[data-act="cancel"]').addEventListener('click', closeConvertModal);
    var okBtn = card.querySelector('[data-act="ok"]');
    okBtn.addEventListener('click', function () {
      okBtn.disabled = true;
      okBtn.textContent = '处理中…';
      runConvert(items, mode, function (done, total) { okBtn.textContent = '处理中… ' + done + '/' + total; })
        .then(function (sum) {
          closeConvertModal();
          var parts = [];
          if (sum.created) parts.push('新建 ' + sum.created);
          if (sum.updated) parts.push('更新 ' + sum.updated);
          if (sum.failed) parts.push('失败/跳过 ' + sum.failed);
          if (sum.failed) {
            openConvertResultModal(sum, mode);
          } else {
            convertToast('ok', '转' + targetLabel + '完成：' + (parts.join('，') || '无变化'), 3200);
          }
          // 转成功后跳到目标列表。Twenty 记录详情无法整页深链(会 404，正常记录亦然)，
          // 故跳列表；刚转的记录 updatedAt 最新、默认排在靠前，销售一眼可见。
          if (!sum.failed) {
            if (mode === 'project' && (sum.projectIds || []).length > 0) {
              window.setTimeout(function () { window.location.href = '/objects/xiangMus'; }, 700);
            } else if ((sum.personIds || []).length > 0) {
              window.setTimeout(function () { window.location.href = '/objects/people'; }, 700);
            }
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
      var staleProject = document.getElementById(CONVERT_PROJECT_BTN_ID);
      if (staleProject) staleProject.remove();
      return;
    }
    var anchor = findToolbarAnchor();
    if (!anchor || !anchor.parentElement) return;

    var existing = document.getElementById(CONVERT_BTN_ID);
    var h = Math.round(anchor.getBoundingClientRect().height) || 26;
    function makeButton(id, text, mode, color, marginRight) {
      var btn = document.createElement('button');
      btn.id = id;
      btn.type = 'button';
      btn.setAttribute('data-lead-convert-top', '1');
      btn.textContent = text;
      btn.style.cssText = [
      'display:inline-flex', 'align-items:center', 'justify-content:center',
      'height:' + h + 'px', 'margin-right:' + marginRight + 'px', 'padding:0 12px', 'flex-shrink:0',
      'border-radius:6px', 'border:1px solid ' + color, 'background:' + color, 'color:#fff',
      'font-size:12px', 'font-weight:600', 'font-family:inherit',
      'cursor:pointer', 'white-space:nowrap',
      ].join(';');
      btn.addEventListener('click', function () {
        var sel = getSelectedOpportunities();
        if (sel.length === 0) { convertToast('error', '请先勾选要转' + (mode === 'project' ? '项目' : '客户') + '的线索'); return; }
        openConvertModal(sel, mode);
      });
      return btn;
    }
    var projectBtn = document.getElementById(CONVERT_PROJECT_BTN_ID);
    if (!existing) existing = makeButton(CONVERT_BTN_ID, '转客户', 'person', '#1f9d5f', 8);
    if (!projectBtn) projectBtn = makeButton(CONVERT_PROJECT_BTN_ID, '转项目', 'project', '#2563eb', 8);

    if (existing.parentElement !== anchor.parentElement || existing.nextElementSibling !== projectBtn) {
      anchor.parentElement.insertBefore(existing, anchor);
    }
    if (projectBtn.parentElement !== anchor.parentElement || projectBtn.nextElementSibling !== anchor) {
      anchor.parentElement.insertBefore(projectBtn, anchor);
    }
  }

  // ── 线索详情页：跟进记录悬浮入口 + 弹窗列表 ──────────────────────────────────
  // 汇总该线索下所有关联会话的跟进（不止直接挂在线索上的），按当前登录人权限过滤——
  // 由后端 GET /conv-api/follow-ups?subjectType=opportunity 保证：admin/boss 看全部，
  // 销售仅见自己所写。不侵入 Twenty 原生字段的 DOM（结构会随 Twenty 升级变化），
  // 用独立悬浮按钮+弹窗展示，跟本文件里「转客户」按钮、官网归类弹窗是同一套模式。
  var FOLLOWUP_BTN_ID = '__followup_entry_btn__';
  var FOLLOWUP_MODAL_ID = '__followup_modal__';

  function opportunityRecordId() {
    var match = window.location.pathname.match(/^\/objects\/opportunities\/([0-9a-fA-F-]{36})(?:\/|$)/);
    return match ? match[1] : '';
  }

  function closeFollowUpModal() {
    var m = document.getElementById(FOLLOWUP_MODAL_ID);
    if (m) m.remove();
  }

  function formatFollowUpTimeLocal(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var pad = function (n) { return String(n).length < 2 ? '0' + n : String(n); };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) { return ''; }
  }

  function renderFollowUpList(container, items) {
    if (!items.length) {
      container.innerHTML = '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">暂无跟进记录</div>';
      return;
    }
    container.innerHTML = items.map(function (item) {
      return '<div style="padding:11px 0;border-top:1px solid #f0f0f1">' +
        '<div style="font-size:12px;color:#71717a;display:flex;justify-content:space-between;gap:8px">' +
          '<span style="font-weight:600;color:#3f3f46">' + escapeHtml(item.createdByName || '未知') + '</span>' +
          '<span>' + escapeHtml(formatFollowUpTimeLocal(item.createdAt)) + '</span>' +
        '</div>' +
        '<div style="margin-top:4px;font-size:13px;line-height:1.6;color:#18181b;white-space:pre-wrap">' + escapeHtml(item.content || '') + '</div>' +
      '</div>';
    }).join('');
  }

  function openFollowUpModal(opportunityId) {
    closeFollowUpModal();
    var overlay = document.createElement('div');
    overlay.id = FOLLOWUP_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(560px,100%);max-height:min(640px,90vh);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    card.innerHTML =
      '<div style="padding:16px 18px 10px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:15px;font-weight:700;color:#111">跟进记录</div>' +
        '<button data-followup-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1">×</button>' +
      '</div>' +
      '<div data-followup-body style="padding:0 18px 8px;overflow:auto;flex:1">' +
        '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>' +
      '</div>' +
      '<div style="padding:8px 18px 14px;font-size:11px;color:#a1a1aa;border-top:1px solid #f4f4f5">已汇总该线索下所有关联会话的跟进；仅展示你有权限查看的记录（后台管理员可见全部，销售仅见本人所写）。</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFollowUpModal(); });
    card.querySelector('[data-followup-close]').addEventListener('click', closeFollowUpModal);
    document.body.appendChild(overlay);

    window.fetch('/conv-api/follow-ups?subjectType=opportunity&subjectId=' + encodeURIComponent(opportunityId) + '&_=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    }).then(function (response) {
      return response.json().catch(function () { return []; }).then(function (data) {
        if (!response.ok) throw new Error((data && (data.error || data.detail)) || '加载跟进记录失败');
        return data;
      });
    }).then(function (items) {
      var body = card.querySelector('[data-followup-body]');
      if (body) renderFollowUpList(body, Array.isArray(items) ? items : []);
    }).catch(function (error) {
      var body = card.querySelector('[data-followup-body]');
      if (body) body.innerHTML = '<div style="padding:24px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }

  function ensureFollowUpEntry() {
    var oppId = opportunityRecordId();
    var existing = document.getElementById(FOLLOWUP_BTN_ID);
    if (!oppId) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.setAttribute('data-opp-id', oppId);
      return;
    }
    var btn = document.createElement('button');
    btn.id = FOLLOWUP_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('data-opp-id', oppId);
    btn.textContent = '跟进记录';
    btn.style.cssText = [
      'position:fixed', 'right:24px', 'bottom:24px', 'z-index:9998',
      'height:36px', 'padding:0 16px', 'border-radius:18px',
      'border:1px solid #7c3aed', 'background:#7c3aed', 'color:#fff',
      'font-size:12.5px', 'font-weight:700', 'font-family:inherit',
      'cursor:pointer', 'box-shadow:0 6px 18px rgba(124,58,237,.35)',
    ].join(';');
    btn.addEventListener('click', function () {
      openFollowUpModal(btn.getAttribute('data-opp-id'));
    });
    document.body.appendChild(btn);
  }

  // ── 线索详情页：附件汇总悬浮入口 + 弹窗列表 ──────────────────────────────────
  // 把一个线索横跨 WhatsApp/官网/邮件等多个渠道会话里收发过的所有附件按线索汇总，
  // 方便回溯「这个客户前后发过哪些文件」。同「跟进记录」一样是独立悬浮按钮+弹窗，
  // 不侵入 Twenty 原生 DOM；后端 GET /conv-api/attachments 按会话可见性过滤。
  var ATTACH_BTN_ID = '__attach_entry_btn__';
  var ATTACH_MODAL_ID = '__attach_modal__';
  var ATTACH_CHANNEL_LABELS = { whatsapp: 'WhatsApp', website: '官网', email: '邮件', instagram: 'Instagram', facebook: 'Facebook' };

  function closeAttachModal() {
    var m = document.getElementById(ATTACH_MODAL_ID);
    if (m) m.remove();
  }

  function formatAttachSize(bytes) {
    var n = Number(bytes);
    if (!n || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function attachIcon(fileType) {
    var t = String(fileType || '').toLowerCase();
    if (/(png|jpe?g|gif|webp|bmp|svg|heic)/.test(t)) return '🖼️';
    if (/(mp4|mov|avi|mkv|webm)/.test(t)) return '🎬';
    if (/(mp3|wav|ogg|m4a|amr|aac)/.test(t)) return '🎧';
    if (/(pdf)/.test(t)) return '📄';
    if (/(xlsx?|csv)/.test(t)) return '📊';
    if (/(docx?|txt|rtf)/.test(t)) return '📝';
    if (/(zip|rar|7z|gz)/.test(t)) return '🗜️';
    return '📎';
  }

  function renderAttachList(container, items) {
    if (!items.length) {
      container.innerHTML = '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">暂无附件</div>';
      return;
    }
    container.innerHTML = items.map(function (item) {
      var channel = ATTACH_CHANNEL_LABELS[item.channel] || item.channel || '';
      var dirText = item.direction === 'inbound' ? '客户发来' : '我方发出';
      var dirColor = item.direction === 'inbound' ? '#0369a1' : '#7c3aed';
      var size = formatAttachSize(item.sizeBytes);
      return '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener" ' +
        'style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #f0f0f1;text-decoration:none;color:inherit">' +
        '<span style="font-size:20px;flex:none">' + attachIcon(item.fileType) + '</span>' +
        '<span style="flex:1;min-width:0">' +
          '<span style="display:block;font-size:13px;color:#18181b;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(item.title || '附件') + '</span>' +
          '<span style="display:block;margin-top:2px;font-size:11.5px;color:#71717a">' +
            '<span style="color:' + dirColor + '">' + dirText + '</span>' +
            (channel ? ' · ' + escapeHtml(channel) : '') +
            (size ? ' · ' + size : '') +
            ' · ' + escapeHtml(formatFollowUpTimeLocal(item.sentAt)) +
          '</span>' +
          (item.caption ? '<span style="display:block;margin-top:2px;font-size:12px;color:#52525b;white-space:pre-wrap">' + escapeHtml(item.caption) + '</span>' : '') +
        '</span>' +
        '<span style="flex:none;font-size:11px;color:#a1a1aa">打开 ↗</span>' +
      '</a>';
    }).join('');
  }

  function openAttachModal(opportunityId) {
    closeAttachModal();
    var overlay = document.createElement('div');
    overlay.id = ATTACH_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(560px,100%);max-height:min(640px,90vh);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    card.innerHTML =
      '<div style="padding:16px 18px 10px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:15px;font-weight:700;color:#111">附件汇总</div>' +
        '<button data-attach-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1">×</button>' +
      '</div>' +
      '<div data-attach-body style="padding:0 18px 8px;overflow:auto;flex:1">' +
        '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>' +
      '</div>' +
      '<div style="padding:8px 18px 14px;font-size:11px;color:#a1a1aa;border-top:1px solid #f4f4f5">已汇总该线索下所有关联会话收发过的附件；仅展示你有权限查看的会话（后台管理员可见全部，销售仅见本人参与/负责的会话）。</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAttachModal(); });
    card.querySelector('[data-attach-close]').addEventListener('click', closeAttachModal);
    document.body.appendChild(overlay);

    window.fetch('/conv-api/attachments?subjectType=opportunity&subjectId=' + encodeURIComponent(opportunityId) + '&_=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    }).then(function (response) {
      return response.json().catch(function () { return []; }).then(function (data) {
        if (!response.ok) throw new Error((data && (data.error || data.detail)) || '加载附件失败');
        return data;
      });
    }).then(function (items) {
      var body = card.querySelector('[data-attach-body]');
      if (body) renderAttachList(body, Array.isArray(items) ? items : []);
    }).catch(function (error) {
      var body = card.querySelector('[data-attach-body]');
      if (body) body.innerHTML = '<div style="padding:24px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }

  function ensureAttachEntry() {
    var oppId = opportunityRecordId();
    var existing = document.getElementById(ATTACH_BTN_ID);
    if (!oppId) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.setAttribute('data-opp-id', oppId);
      return;
    }
    var btn = document.createElement('button');
    btn.id = ATTACH_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('data-opp-id', oppId);
    btn.textContent = '📎 附件';
    // 叠在「跟进记录」按钮正上方（后者 bottom:24px 高 36px），错开避免重叠。
    btn.style.cssText = [
      'position:fixed', 'right:24px', 'bottom:68px', 'z-index:9998',
      'height:36px', 'padding:0 16px', 'border-radius:18px',
      'border:1px solid #7c3aed', 'background:#fff', 'color:#7c3aed',
      'font-size:12.5px', 'font-weight:700', 'font-family:inherit',
      'cursor:pointer', 'box-shadow:0 6px 18px rgba(124,58,237,.22)',
    ].join(';');
    btn.addEventListener('click', function () {
      openAttachModal(btn.getAttribute('data-opp-id'));
    });
    document.body.appendChild(btn);
  }

  // ── 原生成员信息页：在「删除账户」左边注入「重置密码」按钮 ──────────────────
  // 管理员在 Twenty 原生的成员详情页（设置→成员→某人→信息）即可重置该成员密码，
  // 不必再去单独的权限页。目标成员用页面上显示的邮箱匹配（复用 /rbac/members 拿到
  // memberId 再调现有重置接口），后端无需改动。
  var MEMBER_RESETPWD_BTN_ID = '__member_resetpwd_btn__';
  var EMAIL_RE_INJECT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

  function findNativeDeleteAccountButton() {
    var LABELS = ['删除账户', '删除账号', 'Delete account', 'Delete Account', 'Delete account permanently'];
    function norm(s) { return String(s || '').replace(/\s+/g, ''); }
    var wanted = LABELS.map(norm);
    // 1) 直接可点元素（Twenty 的按钮可能是 button / role=button / a）
    var clickable = document.querySelectorAll('button, [role="button"], a');
    for (var i = 0; i < clickable.length; i++) {
      if (wanted.indexOf(norm(clickable[i].textContent)) !== -1) return clickable[i];
    }
    // 2) 兜底：叶子节点自身文本命中「删除账户」，向上爬到第一个可点祖先
    //    （Twenty 的按钮是 styled div，不一定是 button/role/a，用 cursor:pointer 识别）
    var all = document.querySelectorAll('span, div, p, a');
    for (var k = 0; k < all.length; k++) {
      var el = all[k];
      if (el.children.length) continue; // 只看叶子，避免命中大容器
      if (wanted.indexOf(norm(el.textContent)) === -1) continue;
      var node = el;
      for (var up = 0; up < 6 && node; up++) {
        if (node.matches && node.matches('button, [role="button"], a')) return node;
        try { if (window.getComputedStyle(node).cursor === 'pointer') return node; } catch (e) {}
        node = node.parentElement;
      }
      return el.parentElement || el;
    }
    return null;
  }

  function findMemberEmailOnPage() {
    // 优先取原生表单里的邮箱输入框值
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var v = String(inputs[i].value || '').trim();
      if (EMAIL_RE_INJECT.test(v)) return (v.match(EMAIL_RE_INJECT) || [''])[0];
    }
    // 兜底：正文里第一个邮箱
    var m = (document.body.textContent || '').match(EMAIL_RE_INJECT);
    return m ? m[0] : '';
  }

  function findAdminButtonRow(delBtn) {
    if (!delBtn) return null;
    var node = delBtn.parentElement;
    for (var up = 0; up < 6 && node; up++) {
      var text = String(node.textContent || '');
      var buttons = node.querySelectorAll ? node.querySelectorAll('button, [role="button"], a') : [];
      var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      if (
        rect &&
        rect.width > 80 &&
        rect.height > 20 &&
        rect.height < 80 &&
        buttons.length >= 2 &&
        (text.indexOf('删除账户') !== -1 || text.indexOf('删除账号') !== -1 || text.indexOf('Delete account') !== -1) &&
        (text.indexOf('假装') !== -1 || text.indexOf('Impersonate') !== -1)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function openResetPwdByEmail(email) {
    if (!email) { window.alert('未能从页面识别该成员邮箱，无法重置'); return; }
    window.fetch('/conv-api/rbac/members', { method: 'GET', credentials: 'same-origin', headers: getTwentyAuthHeaders() })
      .then(function (r) { return readChannelApiResponse(r, '加载成员失败'); })
      .then(function (data) {
        var list = (data && data.members) || [];
        var member = list.find(function (m) { return String(m.email || '').toLowerCase() === email.toLowerCase(); });
        if (!member) throw new Error('未找到邮箱为 ' + email + ' 的成员');
        // 复用权限页那套重置密码弹窗；root 传 document.body 以承载成功提示
        openResetPwdModal(document.body, { memberId: member.memberId, name: member.name, email: member.email });
      })
      .catch(function (error) { window.alert(error.message || '重置密码失败'); });
  }

  function ensureMemberResetPwdButton() {
    var canInjectHere = window.location.pathname.indexOf('/settings/workspace-members') === 0;
    if (!canInjectHere) {
      var stale = document.getElementById(MEMBER_RESETPWD_BTN_ID);
      if (stale) stale.remove();
      return;
    }
    var delBtn = findNativeDeleteAccountButton();
    var existing = document.getElementById(MEMBER_RESETPWD_BTN_ID);
    if (!delBtn) { if (existing) existing.remove(); return; }
    var adminRow = findAdminButtonRow(delBtn);
    if (!adminRow) {
      if (existing) existing.remove();
      return;
    }
    // 已注入且仍在正确容器内则不重复插
    if (existing && adminRow.contains(existing)) return;
    if (existing) existing.remove();
    var btn = document.createElement('button');
    btn.id = MEMBER_RESETPWD_BTN_ID;
    btn.type = 'button';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg><span>重置密码</span>';
    // 固定为 Twenty 默认小按钮尺寸；避免读取到删除按钮内部文本节点后变成很矮的小标签。
    var cs = null;
    try { cs = window.getComputedStyle(delBtn); } catch (e) {}
    var radius = (cs && cs.borderRadius) || '8px';
    btn.style.cssText = [
      'box-sizing:border-box', 'align-self:center',
      'display:inline-flex', 'align-items:center', 'justify-content:center', 'gap:6px',
      'height:32px', 'min-height:32px', 'min-width:96px', 'padding:0 12px', 'border-radius:' + radius,
      'border:1px solid #d97706', 'background:#fff', 'color:#d97706',
      'font-size:13px', 'font-weight:600', 'line-height:30px', 'font-family:inherit', 'cursor:pointer',
    ].join(';');
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      openResetPwdByEmail(findMemberEmailOnPage());
    });
    btn.style.marginRight = '8px';
    adminRow.insertBefore(btn, delBtn);
  }

  // ── boot ──────────────────────────────────────────────────────────────────

  // 错误收集数组：任何环节抛错都能事后排查（旧版只在 try/catch 内 console.debug，
  // 浏览器默认不显示，导致"菜单消失却无任何报错"无从定位）。
  window.__NHD_ERRORS__ = window.__NHD_ERRORS__ || [];

  window.__NHD_STATE__ = window.__NHD_STATE__ || {
    ticks: 0, obs: 0, route: 0,
    lastUrl: '', lastNavAnchors: -1, lastRefAnchor: '?',
    lastTryInsertAt: 0, lastSettings: null
  };

  var tickInProgress = false;
  var tickScheduled = false;
  function tick() {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
      safeRun('tryInsert', tryInsert);
      safeRun('ensureConvertTopButton', ensureConvertTopButton);
      safeRun('ensureFollowUpEntry', ensureFollowUpEntry);
      safeRun('ensureAttachEntry', ensureAttachEntry);
      if (window.location.pathname.indexOf('/settings/workspace-members') === 0) {
        safeRun('ensureMemberResetPwdButton', ensureMemberResetPwdButton);
      }
    } finally {
      tickInProgress = false;
    }
    try {
      var _st = window.__NHD_STATE__;
      _st.ticks++; _st.lastUrl = location.pathname;
    } catch (_) {}
  }

  // 逐个隔离执行：任何单个注入环节抛错都不应拖停其余环节
  // （历史上 tryInsert 抛 NotFoundError 时，转客户按钮/跟进入口会跟着一起消失）。
  var safeRunWarned = {};
  function safeRun(name, fn) {
    try {
      fn();
    } catch (e) {
      try {
        window.__NHD_ERRORS__.push({ name: name, msg: (e && e.message) || String(e), at: Date.now() });
        if (window.__NHD_ERRORS__.length > 50) window.__NHD_ERRORS__.shift();
      } catch (_) {}
      if (!safeRunWarned[name]) {
        safeRunWarned[name] = 1;
        try { console.warn('[chat-nav] ' + name + ' failed: ' + (e && e.message)); } catch (_) {}
      }
    }
  }

  // ── 渲染前兜底（v8）：退出设置后若主页面菜单未注入 / 绑定页残留，在浏览器绘制前整页刷新 ──
  var SETTINGS_RE = /^\/settings\//;
  var _leftSettingsAt = 0;
  function _brokenAfterLeaveReload() {
    if (!_leftSettingsAt) return;
    if (Date.now() - _leftSettingsAt > 5000) { _leftSettingsAt = 0; return; }
    if (SETTINGS_RE.test(window.location.pathname)) return;
    var overlay = document.getElementById('__settings_channels_page__') || document.getElementById('__settings_rbac_page__');
    if (overlay) { window.location.replace(window.location.pathname + window.location.search + window.location.hash); return; }
    var nativeNav = document.querySelector('a[href^="/objects/"],a[href^="/companies/"],a[href^="/opportunities/"],a[href^="/tasks/"],a[href^="/notes/"]');
    if (nativeNav && !document.getElementById('__chat_nav_item__')) {
      window.location.replace(window.location.pathname + window.location.search + window.location.hash);
    }
  }

  // 路由变化触发器：Twenty 是 SPA，设置/详情的「打开-关闭」本质是 history 路由切换
  // （含 hash 路由，如 设置→渠道 即 /settings/profile#channels）。
  // 仅靠 MutationObserver 在 React 重渲染时可能漏触发或时序错位——"退出设置后菜单回不来"
  // 以及"退出设置后右侧 WhatsApp 绑定页残留"都源于此：removeChannelsSettingsPage / tryInsert
  // 没被调用。这里拦截 pushState/replaceState 并监听 popstate/hashchange，每次路由变化都
  // 强制重跑 tick，从根上保证注入/清理在导航后必然执行。
  function installRouteTrigger() {
    function fire() {
      try { if (window.__NHD_STATE__) window.__NHD_STATE__.route++; } catch (_) {}
      scheduleTick();
    }
    var _ps = window.history.pushState, _rs = window.history.replaceState;
    if (typeof _ps === 'function') {
      window.history.pushState = function () {
        var r = _ps.apply(this, arguments); fire(); return r;
      };
    }
    if (typeof _rs === 'function') {
      window.history.replaceState = function () {
        var r = _rs.apply(this, arguments); fire(); return r;
      };
    }
    window.addEventListener('popstate', fire);
    window.addEventListener('hashchange', fire);
  }

  // 触发机制全部就绪后再做其它初始化；这样即便后续步骤抛错，自动注入链也不受影响。
  // scheduleTick: 立即跑一次 + 250ms 后再跑一次，兜住 React 异步重渲染导致的时序错位
  // （tick 跑时菜单锚点尚未挂载，下一帧才出现 → 立即那次找不到锚点，延迟那次补回）。
  function scheduleTick() {
    tick();
    if (tickScheduled) return;
    tickScheduled = true;
    setTimeout(function () { tickScheduled = false; tick(); }, 250);
  }

  var observer = new MutationObserver(function () {
    try { if (window.__NHD_STATE__) window.__NHD_STATE__.obs++; } catch (_) {}
    scheduleTick();
    _brokenAfterLeaveReload();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  installRouteTrigger();
  if (document.readyState === 'complete') tick(); else window.addEventListener('load', tick);
  // 低频次兜底：React 重渲染 / 元数据刷新后，即便上述触发器都漏了，也能在 2s 内自愈。
  setInterval(tick, 2000);
  setInterval(refreshIframeAuthToken, 30000);

  // 诊断入口：手动强制重跑注入（排查"自动触发器没生效"时调用）。
  window.__NHD_FORCE_TICK = function () { tick(); return window.__NHD_STATE__; };

  // 鉴权抓取：隔离执行，失败不影响上面的注入触发链。
  try {
    installAuthCapture();
  } catch (e) {
    try { window.__NHD_ERRORS__.push({ name: 'installAuthCapture', msg: String(e), at: Date.now() }); } catch (_) {}
  }


  // ── 兜底：退出设置时整页重载主页，强制 chat-nav.js 重新执行（修复菜单消失/绑定页残留）──
      (function () {
    if (typeof window.__NHD_LEAVE_RELOAD__ === 'function') return;
    var SETTINGS_RE = /^\/settings\//;
    var wasInSettings = SETTINGS_RE.test(window.location.pathname);
    function _absoluteUrl(url) {
      if (!url) return window.location.pathname + window.location.search + window.location.hash;
      try { return new URL('' + url, window.location.href).href; } catch (e) { return '' + url; }
    }
    function _leaveTo(url) { _leftSettingsAt = Date.now(); window.location.replace(_absoluteUrl(url)); }
    function _isLeave(url) {
      if (url === undefined || url === null) return false;
      var p = ('' + url).split('#')[0];
      return wasInSettings && !SETTINGS_RE.test(p);
    }
    function _watch() {
      var nowInSettings = SETTINGS_RE.test(window.location.pathname);
      if (wasInSettings && !nowInSettings) { _leaveTo(); return; }
      wasInSettings = nowInSettings;
    }
    window.addEventListener('popstate', _watch);
    window.addEventListener('hashchange', _watch);
    var _ps = history.pushState, _rs = history.replaceState;
    history.pushState = function (state, title, url) {
      if (_isLeave(url)) { _leaveTo(url); return; }
      var r = _ps.apply(history, arguments); _watch(); return r;
    };
    history.replaceState = function (state, title, url) {
      if (_isLeave(url)) { _leaveTo(url); return; }
      var r = _rs.apply(history, arguments); _watch(); return r;
    };
    window.__NHD_LEAVE_RELOAD__ = _watch;
  })();

})();
