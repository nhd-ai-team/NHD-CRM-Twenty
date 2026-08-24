// ===== chat-nav 模块: 00-head — 入口 + 版本 + 路由解析工具(parseRoute/canonicalObject) + 常量 =====
(function () {
  'use strict';

  // 版本戳：硬刷新后对照 window.__NHD_VERSION__ 即可确认当前执行的是哪一版。
  window.__NHD_VERSION__ = '20260824-nav-order-v1';

  // ── 全局错误捕获（2026-08-19 线索页崩溃排查用）：把运行时错误/未处理 Promise 拒绝
  //     记录到 window.__NHD_ERRORS__（含堆栈），控制台运行 window.__NHD_ERRORS__ 即可查看。
  //     若 window.__NHD_ERRORS__ 为空但有崩溃，说明错误发生在 React 渲染内部（注入层之外）。 ──
  window.__NHD_ERRORS__ = window.__NHD_ERRORS__ || [];
  try {
    window.addEventListener('error', function (ev) {
      try {
        var item = {
          type: 'error',
          msg: (ev && ev.message) || String(ev && ev.error) || 'unknown error',
          file: ev && ev.filename, line: ev && ev.lineno, col: ev && ev.colno,
          stack: ev && ev.error && ev.error.stack ? String(ev.error.stack).slice(0, 800) : '',
          at: Date.now(), url: location.pathname + location.search,
        };
        window.__NHD_ERRORS__.push(item);
        if (window.__NHD_ERRORS__.length > 80) window.__NHD_ERRORS__.shift();
      } catch (_) {}
    }, true);
    window.addEventListener('unhandledrejection', function (ev) {
      try {
        var reason = ev && ev.reason;
        window.__NHD_ERRORS__.push({
          type: 'unhandledrejection',
          msg: (reason && (reason.message || String(reason))) || 'unhandled rejection',
          stack: reason && reason.stack ? String(reason.stack).slice(0, 800) : '',
          at: Date.now(), url: location.pathname + location.search,
        });
        if (window.__NHD_ERRORS__.length > 80) window.__NHD_ERRORS__.shift();
      } catch (_) {}
    });
  } catch (_) {}

  // ── 单一事实源：Twenty 路由解析 ─────────────────────────────────────────────
  // 历史上「单数 /object/ vs 复数 /objects/」的正则散落 5 处，漏改就复发「按钮不显示」。
  // 这里统一解析：兼容 v2 单数 /object/ 与 v1 复数 /objects/ 前缀，返回 { kind, slug, id }。
  //   kind: 'list'   = /object(s)/<slug>（列表页）
  //         'detail' = /object(s)/<slug>/<36位uuid>（详情页）
  //         null     = 无关路径（/settings、/chat 等）
  function parseRoute() {
    var m = window.location.pathname.match(/^\/objects?\/([A-Za-z0-9_]+)(?:\/([0-9a-fA-F-]{36}))?\/?$/);
    if (!m) return null;
    return { kind: m[2] ? 'detail' : 'list', slug: m[1], id: m[2] || null };
  }
  // 对象 slug 归一：复数/单数都归到规范名，供跨路由匹配（duiHuaLiShis→duiHuaLiShi 等）。
  var OBJECT_SLUGS = {
    opportunities: 'opportunity', opportunity: 'opportunity',
    people: 'person', person: 'person', contacts: 'person',
    _xiangMus: 'xiangMu', _xiangMu: 'xiangMu', xiangMus: 'xiangMu',
    duiHuaLiShis: 'duiHuaLiShi', duiHuaLiShi: 'duiHuaLiShi',
    companies: 'company', company: 'company'
  };
  function canonicalObject(slug) {
    return OBJECT_SLUGS[slug] || slug;
  }

  var CHAT_SRC   = '/chat/?v=20260824-chat-ui-pollingfix';
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
// ===== chat-nav 模块: 10-auth — 鉴权抓取 + token/cookie + iframe/视图切换 + 会话id获取 =====
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

  function getViewSrc(view, conversationId) {
    var token = getTwentyAccessToken();
    var hash = token ? '#twentyAccessToken=' + encodeURIComponent(token) : '';
    if (view === 'mail') hash += (hash ? '&' : '#') + 'view=mail';
    if (view === 'history') hash += (hash ? '&' : '#') + 'view=history';
    if (conversationId) hash += (hash ? '&' : '#') + 'conversationId=' + encodeURIComponent(conversationId);
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

  function getOrCreateIframe(view, conversationId) {
    view = view || 'chat';
    var existing = document.getElementById(getIframeId(view));
    if (existing) return existing;

    var iframe = document.createElement('iframe');
    iframe.id = getIframeId(view);
    iframe.setAttribute('data-chat-view', view);
    iframe.src = getViewSrc(view, conversationId);
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

  function showView(view, conversationId) {
    sessionStorage.setItem(ACTIVE_KEY, view);
    // 离开设置态时立即清理所有 fixed 覆盖层（渠道/RBAC 面板），
    // 不等 tick()/tryInsert() 的周期性延迟，避免面板残留在 chat/mail 视图上。
    removeChannelsSettingsPage();
    removeRbacSettingsPage();
    // 打开全屏视图（对话工作台/邮箱/history）时同步移除「查看对话内容」按钮：
    // showView 只改 iframe 的 style/src，不产生 childList mutation，MutationObserver 不会驱动
    // tick 立即执行；若不在这里同步移除，按钮会残留浮在 iframe 之上（z-index 200 > 100）。
    // 按钮的重新注入由 ensureHistoryDrillButton 在离开视图回到 duiHuaLiShi 上下文时恢复。
    var _drillBtn = document.getElementById('__history_drill_btn__');
    if (_drillBtn) _drillBtn.remove();
    Array.from(document.querySelectorAll('iframe[data-chat-view]')).forEach(function (item) {
      item.style.display = 'none';
    });
    var iframe = getOrCreateIframe(view, conversationId);
    // 若目标 src（含 conversationId 钻取参数）与当前不一致，刷新 iframe 以带上新参数。
    var desiredSrc = getViewSrc(view, conversationId);
    if (iframe.getAttribute('src') !== desiredSrc) iframe.src = desiredSrc;
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

  // ── 沟通状态表单：记录详情页「查看对话内容」按钮（钻取 HistoryApp 气泡）──────

  // 从「沟通状态」记录详情读回对应的会话外部 ID（conv.conversations.id）。
  // 注意：本版本 Twenty 的 duiHuaLiShi 单条查询/按 id 过滤均不被允许（"Argument not allowed: id"），
  // 故改为拉取轻量 id→conversationId 映射（list 查询可用），再按当前记录 id 定位。
  function fetchDuiHuaLiShiConversationId(recordId) {
    return new Promise(function (resolve, reject) {
      var token = getTwentyAccessToken();
      if (!token) return reject(new Error('no token'));
      fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          query: 'query { duiHuaLiShis(first: 1000) { edges { node { id conversationId } } } }',
        }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        var edges = (data && data.data && data.data.duiHuaLiShis && data.data.duiHuaLiShis.edges) || [];
        for (var i = 0; i < edges.length; i++) {
          var node = edges[i] && edges[i].node;
          if (node && node.id === recordId) {
            if (node.conversationId) return resolve(node.conversationId);
            return reject(new Error('no conversationId'));
          }
        }
        reject(new Error('record not found'));
      }).catch(reject);
    });
  }
// ===== chat-nav 模块: 20-drill — 右侧抽屉检测(findRightDrawer) + 沟通状态钻取按钮 =====
  // 在「沟通状态」记录详情注入悬浮按钮，点击钻取到该会话的对话气泡。
  // 兼容两种打开方式：① 整页路由 /objects/duiHuaLiShi[s]/<uuid>；
  // ② Twenty 默认右侧抽屉(URL 不变)：定位右侧 fixed 抽屉容器，从其内部
  //    「在完整页面打开」锚点(/objects/duiHuaLiShi/<uuid>)取 record id。
  function getZIndex(el) {
    var z = 0;
    while (el && el !== document.body) {
      var v = parseInt(getComputedStyle(el).zIndex, 10);
      if (!isNaN(v) && v > z) z = v;
      el = el.parentElement;
    }
    return z;
  }

  // 定位 Twenty 右侧抽屉容器：fixed/absolute + 贴右 + 占大半屏高。
  // 关键：class 选择器只用高信号、低基数候选（drawer/modal/overlay/sheet），
  // 严禁用 page/record/detail/panel/show 等超宽泛匹配——它们会命中几乎所有容器，
  // 导致每 tick 对成百上千节点调 getComputedStyle 而卡死页面（尤其切换到大表格页时）。
  // 缓存：同一路由 300ms 内复用上次结果，避免每 tick 被多个 ensure* 重复全量扫 DOM。
  var _drawerCache = { key: '', at: 0, val: null };
  function findRightDrawer() {
    var key = window.location.pathname + window.location.search;
    var now = Date.now();
    if (_drawerCache.key === key && (now - _drawerCache.at) < 300) return _drawerCache.val;
    _drawerCache.key = key; _drawerCache.at = now; _drawerCache.val = findRightDrawerScan();
    return _drawerCache.val;
  }
  function findRightDrawerScan() {
    var sel = '[role="dialog"],[aria-modal="true"],[class*="drawer"],[class*="Drawer"],[class*="RightDrawer"],[class*="overlay"],[class*="Overlay"],[class*="modal"],[class*="Modal"],[class*="sheet"],[class*="Sheet"]';
    var els = document.querySelectorAll(sel);
    var best = null, bestZ = -1, scanned = 0;
    var MAX_SCAN = 80; // 安全上限：即使意外大量匹配也绝不卡死
    for (var i = 0; i < els.length; i++) {
      if (scanned >= MAX_SCAN) break;
      scanned++;
      var el = els[i];
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 220 || r.height < window.innerHeight * 0.5) continue;
      var z = parseInt(cs.zIndex, 10) || 0;
      if (z > bestZ) { bestZ = z; best = el; }
    }
    // 轻量几何兜底：仅扫描 body 直接子节点及其一层后代（React portal 抽屉通常挂在 body 下）。
    // 严禁全文档扫描（对大表格会触发海量 getComputedStyle 导致页面卡死）。
    if (!best) {
      var cand = [];
      var bc = document.body.children;
      for (var c = 0; c < bc.length; c++) {
        cand.push(bc[c]);
        var cc = bc[c].children;
        for (var d = 0; d < cc.length; d++) cand.push(cc[d]);
      }
      for (var k = 0; k < cand.length; k++) {
        var e = cand[k];
        var ec = getComputedStyle(e);
        if (ec.position !== 'fixed' && ec.position !== 'absolute') continue;
        var er = e.getBoundingClientRect();
        if (er.width < 220 || er.width > window.innerWidth * 0.95) continue;
        if (er.height < window.innerHeight * 0.5) continue;
        if (er.top > 8) continue;
        if (window.innerWidth - er.right > 8) continue; // 必须贴右
        var ez = parseInt(ec.zIndex, 10) || 0;
        if (ez > bestZ) { bestZ = ez; best = e; }
      }
    }
    return best;
  }

  // 返回 { id, via } 或 { id: null, debug }
  function findDuiHuaLiShiRecordId() {
    // S1: 整页路由（统一走 parseRoute，兼容单数/复数 object 与 slug）
    var r = parseRoute();
    if (r && r.kind === 'detail' && canonicalObject(r.slug) === 'duiHuaLiShi') return { id: r.id, via: 'url' };
    // S2: 仅当右侧抽屉打开时，才在抽屉内找 duiHuaLiShi 详情自链接锚点。
    //     无抽屉（即列表/概览页）直接返回，不扫全文档，避免误触发 + 卡顿。
    var drawer = findRightDrawer();
    if (!drawer) return { id: null, debug: { via: 'no-drawer' } };
    var anchors = drawer.querySelectorAll('a[href*="/object/duiHuaLiShi"], a[href*="/objects/duiHuaLiShi"]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (a.getClientRects().length === 0) continue; // 不可见跳过
      var m = (a.getAttribute('href') || '').match(/\/objects?\/duiHuaLiShi[s]?\/([0-9a-fA-F-]{36})/);
      if (m) return { id: m[1], via: 'anchor' };
    }
    // S3 兜底已移除（2026-08-19 残留 bug 根因）：
    // 「抽屉内任意 /object 锚点」会误命中其他对象（person/线索/客户/项目），
    // 导致离开 duiHuaLiShi 上下文后按钮残留（在对话工作台/资料抽屉场景必现）。
    // 真实 duiHuaLiShi 抽屉详情场景下 S2 的「在完整页面打开」自链接必然存在，够用。
    return { id: null, debug: { via: 'drawer-no-anchor', drawerClass: (drawer.className && drawer.className.toString().slice(0, 160)) || '(none)', drawerTag: drawer.tagName } };
  }

  // 诊断探针：在控制台运行 __NHD_DRILL_PROBE__() 可打印抽屉检测详情，便于排障
  function installDrillProbe() {
    if (window.__NHD_DRILL_PROBE__) return;
    window.__NHD_DRILL_PROBE__ = function () {
      var drawer = findRightDrawer();
      var out = {
        path: location.pathname,
        urlMatch: (location.pathname.match(/\/objects?\/duiHuaLiShi[s]?\/([0-9a-fA-F-]{36})/) || [])[1] || null,
        drawerFound: !!drawer,
        drawerTag: drawer ? drawer.tagName : null,
        drawerClass: drawer ? (drawer.className && drawer.className.toString().slice(0, 200)) : null,
        drawerRect: drawer ? (function (r) { return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), right: Math.round(r.right) }; })(drawer.getBoundingClientRect()) : null,
        dhAnchors: (function () {
          var list = document.querySelectorAll('a[href*="/object/duiHuaLiShi"], a[href*="/objects/duiHuaLiShi"]');
          var r = [];
          for (var i = 0; i < Math.min(list.length, 8); i++) r.push(list[i].getAttribute('href'));
          return r;
        })(),
        anyObjectAnchors: (function () {
          var list = document.querySelectorAll('a[href*="/object/"], a[href*="/objects/"]');
          var r = [];
          for (var i = 0; i < Math.min(list.length, 12); i++) {
            var h = list[i].getAttribute('href') || '';
            var m = h.match(/\/objects?\/([A-Za-z0-9_]+)\/([0-9a-fA-F-]{36})/);
            if (m) r.push(m[1] + '/' + m[2].slice(0, 8));
          }
          return r;
        })(),
        drillState: window.__NHD_DRILL__ || null,
      };
      try { console.log('[NHD drill probe]', JSON.stringify(out, null, 2)); } catch (_) {}
      return out;
    };
  }

  function ensureHistoryDrillButton() {
    try {
      installDrillProbe();
      // 全屏 iframe 视图（对话工作台 / 邮件 / 历史气泡）激活时，按钮必须移除：
      // showView() 不改变 URL——若进入 iframe 前停在 duiHuaLiShi 详情页，S1 整页路由会一直命中，
      // 导致「查看对话内容」按钮残留并浮在 iframe 之上（z-index 200 > iframe 100）。
      // 用 isChatVisible()（10-auth 定义，同一 IIFE）判断 iframe 是否可见，避免误判抽屉。
      if (isChatVisible()) {
        var btn0 = document.getElementById('__history_drill_btn__');
        if (btn0) btn0.remove();
        window.__NHD_DRILL__ = { path: location.pathname, id: null, note: 'chat/mail iframe active' };
        return;
      }
      var res = findDuiHuaLiShiRecordId();
      var recordId = res.id;
      var btn = document.getElementById('__history_drill_btn__');
      if (!recordId) {
        if (btn) btn.remove();
        window.__NHD_DRILL__ = { path: location.pathname, id: null, note: 'no record context', debug: res.debug };
        return;
      }
      if (btn) {
        if (btn.dataset.rid !== recordId) btn.dataset.rid = recordId;
        return;
      }
      btn = document.createElement('button');
      btn.id = '__history_drill_btn__';
      btn.dataset.rid = recordId;
      btn.textContent = '查看对话内容';
      btn.style.cssText = [
        'position:fixed', 'right:20px', 'bottom:20px', 'z-index:200',
        'padding:9px 16px', 'border:none', 'border-radius:8px',
        'background:var(--twenty-color-purple-50,#9333ea)', 'color:#fff',
        'font-size:13px', 'font-weight:600', 'cursor:pointer',
        'box-shadow:0 2px 10px rgba(0,0,0,.25)',
      ].join(';');
      btn.addEventListener('click', function () {
        var rid = btn.dataset.rid;
        btn.disabled = true; var prev = btn.textContent; btn.textContent = '加载中…';
        fetchDuiHuaLiShiConversationId(rid).then(function (cid) {
          // 不跳全屏 iframe：就地弹窗，把会话消息以文本形式直接呈现（用户可快速定位）。
          openConversationTextModal(cid, null);
        }).catch(function () {
          openConversationTextModal(null, '未找到该记录的关联会话');
        }).finally(function () {
          btn.disabled = false; btn.textContent = prev;
        });
      });
      document.body.appendChild(btn);
      window.__NHD_DRILL__ = { path: location.pathname, id: recordId, via: res.via, note: 'button injected' };
    } catch (e) {}
  }

  // ── 沟通明细内联文本弹窗 ────────────────────────────────────────────────
  // 用户诉求：看沟通明细不应整页跳转到聊天视图（切页后上下文丢失、难以快速定位），
  // 应就地以「文本形式」直接呈现会话消息。点击「查看对话内容」→ 本弹窗拉取
  // /conv-api/conversations/:id/messages 渲染消息列表（发送方+时间+内容+附件/媒体），
  // 顶部关键词过滤可即时定位；底部保留「在完整对话页打开」作为可选入口。
  var CONV_TEXT_MODAL_ID = '__conv_text_modal__';

  function closeConversationTextModal() {
    var m = document.getElementById(CONV_TEXT_MODAL_ID);
    if (m) m.remove();
  }

  // 单条消息渲染：发送方标签(按 senderType 着色) + 时间 + 正文(pre-wrap) + 附件/媒体链接。
  function renderConversationMessageHtml(msg) {
    var senderLabel = '未知', senderColor = '#52525b';
    if (msg.senderType === 'customer') { senderLabel = '客户'; senderColor = '#0369a1'; }
    else if (msg.senderType === 'agent') { senderLabel = '我方'; senderColor = '#7c3aed'; }
    else if (msg.senderType === 'ai') { senderLabel = 'AI'; senderColor = '#059669'; }
    var timeText = formatFollowUpTimeLocal(msg.sentAt);
    var parts = [];
    // 媒体（WhatsApp/IG 入站图片视频等）
    if (msg.mediaUrl) {
      parts.push('<a href="' + escapeHtml(msg.mediaUrl) + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block;margin-top:6px;font-size:12px;color:#0369a1;text-decoration:none;font-weight:600">' +
        attachIcon(String(msg.contentType || 'file').replace(/^image\//, 'jpg')) + ' 查看媒体文件 ↗</a>');
    }
    // 附件（官网/邮件出站等，JSONB 数组）
    var atts = Array.isArray(msg.attachments) ? msg.attachments : [];
    for (var i = 0; i < atts.length; i++) {
      var att = atts[i] || {};
      var url = String(att.url || att.href || '').trim();
      if (!url) continue;
      var title = att.title || att.fileName || att.filename || '附件';
      var size = formatAttachSize(att.sizeBytes || att.size || 0);
      parts.push('<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block;margin-top:6px;font-size:12px;color:#0369a1;text-decoration:none;font-weight:600">' +
        attachIcon(String(att.fileType || att.contentType || 'file').replace(/^image\//, 'jpg')) + ' ' +
        escapeHtml(title) + (size ? ' · ' + size : '') + ' ↗</a>');
    }
    var body = String(msg.content || '').trim();
    return '<div style="padding:10px 0;border-bottom:1px solid #f0f0f1">' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:#a1a1aa">' +
        '<span style="font-weight:700;color:' + senderColor + '">' + senderLabel + '</span>' +
        '<span>' + escapeHtml(timeText) + '</span>' +
      '</div>' +
      (body ? '<div style="margin-top:4px;font-size:13px;line-height:1.65;color:#18181b;white-space:pre-wrap;word-break:break-word">' + escapeHtml(body) + '</div>' : '') +
      (parts.length ? parts.join('') : '') +
    '</div>';
  }

  function renderConversationTextBody(container, messages, keyword) {
    var kw = String(keyword || '').trim().toLowerCase();
    var list = messages;
    if (kw) {
      list = [];
      for (var i = 0; i < messages.length; i++) {
        var hay = String(messages[i].content || '') + ' ' + (messages[i].senderType || '') + ' ';
        if (hay.toLowerCase().indexOf(kw) >= 0) list.push(messages[i]);
      }
    }
    if (!list.length) {
      container.innerHTML = '<div style="padding:28px 0;text-align:center;color:#a1a1aa;font-size:12.5px">' +
        (kw ? '没有匹配「' + escapeHtml(kw) + '」的消息' : '该会话暂无消息') + '</div>';
      return;
    }
    container.innerHTML = list.map(renderConversationMessageHtml).join('');
  }

  function openConversationTextModal(conversationId, errorMsg) {
    closeConversationTextModal();
    var overlay = document.createElement('div');
    overlay.id = CONV_TEXT_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(680px,100%);max-height:min(78vh,720px);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    card.innerHTML =
      '<div style="padding:14px 18px 8px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:15px;font-weight:700;color:#111">沟通明细</div>' +
        '<button data-convtext-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1">×</button>' +
      '</div>' +
      '<div style="padding:0 18px 10px">' +
        '<input data-convtext-filter type="text" placeholder="输入关键词过滤消息…" ' +
        'style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #e4e4e7;border-radius:6px;font-size:12.5px;color:#18181b;outline:none;background:#fafafa" />' +
      '</div>' +
      '<div data-convtext-body style="padding:0 18px 8px;overflow:auto;flex:1">' +
        '<div style="padding:28px 0;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>' +
      '</div>' +
      '<div style="padding:8px 18px 14px;display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#a1a1aa;border-top:1px solid #f4f4f5">' +
        '<span>按时间正序展示本会话消息；仅展示你有权限查看的内容。</span>' +
        '<a data-convtext-full href="#" style="color:#7c3aed;text-decoration:none;font-weight:600">在完整对话页打开 ↗</a>' +
      '</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeConversationTextModal(); });
    card.querySelector('[data-convtext-close]').addEventListener('click', closeConversationTextModal);
    document.body.appendChild(overlay);

    var body = card.querySelector('[data-convtext-body]');
    var filterEl = card.querySelector('[data-convtext-filter]');
    var fullLink = card.querySelector('[data-convtext-full]');
    var cached = null;

    // 底部可选入口：保留原「整页聊天视图」能力，但不再是默认行为。
    fullLink.addEventListener('click', function (e) {
      e.preventDefault();
      closeConversationTextModal();
      showView('history', conversationId || '');
    });

    function applyFilter() {
      if (cached) renderConversationTextBody(body, cached, filterEl.value);
    }
    filterEl.addEventListener('input', applyFilter);

    if (errorMsg) {
      body.innerHTML = '<div style="padding:28px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(errorMsg) + '</div>';
      return;
    }
    if (!conversationId) {
      body.innerHTML = '<div style="padding:28px 0;text-align:center;color:#e1262b;font-size:12.5px">缺少会话 ID，无法加载消息</div>';
      return;
    }

    window.fetch('/conv-api/conversations/' + encodeURIComponent(conversationId) + '/messages?_=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    }).then(function (response) {
      return response.json().catch(function () { return []; }).then(function (data) {
        if (!response.ok) throw new Error((data && (data.error || data.detail)) || '加载消息失败');
        return data;
      });
    }).then(function (items) {
      cached = Array.isArray(items) ? items : [];
      renderConversationTextBody(body, cached, filterEl.value);
    }).catch(function (error) {
      body.innerHTML = '<div style="padding:28px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }
// ===== chat-nav 模块: 21-history-panel — 沟通状态右侧「历史记录」面板（关键词 + 附件）=====
  // 取代原「查看对话内容」居中弹窗：在沟通状态详情页右侧停靠一个面板，
  // 提供两种查询：① 关键词（按消息正文 + 附件标题过滤）；② 附件（列出本会话全部附件，新标签打开）。
  // DOM 在用户点击事件栈内创建，仅操作自建子树；面板为 document.body 下独立 fixed 节点，
  // 不触碰 React 托管节点，符合注入层 React 协调器铁律。
  var HISTORY_PANEL_ID = '__history_panel__';

  function closeHistoryPanel() {
    var p = document.getElementById(HISTORY_PANEL_ID);
    if (p) p.remove();
  }

  // 从 contentType 推导扩展名（供 attachIcon 使用），如 image/jpeg→jpg、application/pdf→pdf。
  function histFileType(contentType, fallback) {
    var ct = String(contentType || '').toLowerCase();
    if (ct.indexOf('image/') === 0) return ct.slice(6) || 'jpg';
    if (ct.indexOf('application/pdf') === 0) return 'pdf';
    if (ct.indexOf('application/msword') === 0) return 'doc';
    if (ct.indexOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document') === 0) return 'docx';
    if (ct.indexOf('application/vnd.ms-excel') === 0) return 'xls';
    if (ct.indexOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') === 0) return 'xlsx';
    if (ct.indexOf('text/') === 0) return 'txt';
    if (ct.indexOf('application/zip') === 0 || ct.indexOf('application/x-zip') === 0) return 'zip';
    if (ct) {
      var parts = ct.split('/');
      if (parts.length === 2 && parts[1] && parts[1] !== '*') return parts[1];
    }
    return fallback || 'file';
  }

  // 把消息数组展平为附件清单（镜像 middleware /api/attachments 的口径）：
  // attachments 数组优先；无数组但 mediaUrl 存在（WhatsApp/IG 入站单条媒体）补一条。
  function flattenHistoryAttachments(messages) {
    var items = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i] || {};
      var direction = m.senderType === 'customer' ? 'inbound' : 'outbound';
      var atts = Array.isArray(m.attachments) ? m.attachments : [];
      if (atts.length) {
        for (var j = 0; j < atts.length; j++) {
          var att = atts[j] || {};
          var url = String(att.url || att.href || '').trim();
          if (!url) continue;
          items.push({
            url: url,
            title: att.title || att.fileName || att.filename || '附件',
            fileType: histFileType(att.contentType || att.fileType || att.mimeType || att.mimetype || '', 'file'),
            contentType: att.contentType || att.mimeType || att.mimetype || null,
            sizeBytes: Number(att.sizeBytes || att.size || 0) || null,
            senderType: m.senderType,
            direction: direction,
            sentAt: m.sentAt,
          });
        }
      } else if (m.mediaUrl) {
        var title = (m.content && String(m.content).trim()) || (m.contentType ? histFileType(m.contentType, '媒体') + ' 附件' : '媒体文件');
        items.push({
          url: String(m.mediaUrl),
          title: title.slice(0, 180),
          fileType: histFileType(m.contentType, 'file'),
          contentType: m.contentType || null,
          sizeBytes: null,
          senderType: m.senderType,
          direction: direction,
          sentAt: m.sentAt,
        });
      }
    }
    return items;
  }

  // 关键词模式：过滤消息（正文 + 附件标题）后用既有消息渲染器逐条渲染。
  function renderHistoryKeywordHtml(messages, keyword) {
    var kw = String(keyword || '').trim().toLowerCase();
    var list = messages;
    if (kw) {
      list = [];
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i] || {};
        var atts = Array.isArray(m.attachments) ? m.attachments : [];
        var titles = [];
        for (var j = 0; j < atts.length; j++) {
          titles.push(atts[j] && (atts[j].title || atts[j].fileName || atts[j].filename) || '');
        }
        var hay = String(m.content || '') + ' ' + titles.join(' ') + ' ' + (m.senderType || '');
        if (hay.toLowerCase().indexOf(kw) >= 0) list.push(m);
      }
    }
    if (!list.length) {
      return '<div style="padding:28px 4px;text-align:center;color:#a1a1aa;font-size:12.5px">' +
        (kw ? '没有匹配「' + escapeHtml(kw) + '」的消息' : '该会话暂无消息') + '</div>';
    }
    var out = '';
    for (var k = 0; k < list.length; k++) out += renderConversationMessageHtml(list[k]);
    return out;
  }

  function renderHistoryAttachmentHtml(items) {
    if (!items.length) {
      return '<div style="padding:28px 4px;text-align:center;color:#a1a1aa;font-size:12.5px">该会话暂无附件</div>';
    }
    var out = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var badge, badgeColor;
      if (it.direction === 'inbound') { badge = '客户 · 入站'; badgeColor = '#0369a1'; }
      else if (it.senderType === 'ai') { badge = 'AI · 出站'; badgeColor = '#059669'; }
      else { badge = '我方 · 出站'; badgeColor = '#7c3aed'; }
      var size = formatAttachSize(it.sizeBytes || 0);
      var time = formatFollowUpTimeLocal(it.sentAt);
      var meta = [];
      meta.push('<span style="color:' + badgeColor + ';font-weight:600">' + escapeHtml(badge) + '</span>');
      if (size) meta.push(escapeHtml(size));
      if (time) meta.push(escapeHtml(time));
      out +=
        '<div style="display:flex;gap:10px;padding:10px;margin-bottom:8px;border:1px solid #eeedf1;border-radius:8px;background:#fff">' +
          '<div style="flex:0 0 36px;height:36px;border-radius:7px;background:#f3effe;color:#7c3aed;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;text-transform:uppercase;overflow:hidden">' +
            escapeHtml(String(it.fileType || 'file').slice(0, 4)) +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:600;color:#18181b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(it.title) + '</div>' +
            '<div style="margin-top:3px;font-size:11.5px;color:#71717a">' + meta.join(' · ') + '</div>' +
            '<a href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener" ' +
              'style="display:inline-block;margin-top:5px;font-size:12px;color:#0369a1;text-decoration:none;font-weight:600">打开 ↗</a>' +
          '</div>' +
        '</div>';
    }
    return out;
  }

  function openHistoryPanel(conversationId, errorMsg) {
    // 同会话再次点击 = 收起（toggle）
    var existing = document.getElementById(HISTORY_PANEL_ID);
    if (existing) {
      if (existing.dataset.cid === String(conversationId || '')) { existing.remove(); return; }
      existing.remove();
    }
    closeConversationTextModal();

    var overlay = document.createElement('div');
    overlay.id = HISTORY_PANEL_ID;
    overlay.dataset.cid = String(conversationId || '');
    overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:min(480px,92vw);z-index:100001;' +
      'background:#fff;box-shadow:-10px 0 34px rgba(0,0,0,.18);display:flex;flex-direction:column;' +
      'font-family:inherit;color:#18181b;';

    overlay.innerHTML =
      '<div style="padding:13px 16px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f0f0f1">' +
        '<div style="font-size:15px;font-weight:700;color:#111">历史记录</div>' +
        '<button data-hist-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1;padding:2px 6px">×</button>' +
      '</div>' +
      '<div data-hist-tabs style="display:flex;gap:6px;padding:10px 16px 0"></div>' +
      '<div data-hist-body style="padding:12px 16px 8px;overflow:auto;flex:1"></div>' +
      '<div style="padding:9px 16px 13px;display:flex;align-items:center;justify-content:flex-end;font-size:11px;color:#a1a1aa;border-top:1px solid #f4f4f5">' +
        '<a data-hist-full href="#" style="color:#7c3aed;text-decoration:none;font-weight:600">在完整对话页打开 ↗</a>' +
      '</div>';
    document.body.appendChild(overlay);

    var tabsEl = overlay.querySelector('[data-hist-tabs]');
    var bodyEl = overlay.querySelector('[data-hist-body]');
    var closeBtn = overlay.querySelector('[data-hist-close]');
    var fullLink = overlay.querySelector('[data-hist-full]');

    var cached = null;
    var activeTab = 'keyword';
    var hasError = false;

    function makeTab(key, label) {
      var b = document.createElement('button');
      b.dataset.tab = key;
      b.textContent = label;
      b.style.cssText = 'flex:1;height:32px;border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:600;border:1px solid ' +
        (activeTab === key ? '#7c3aed' : '#e4e4e7') + ';background:' + (activeTab === key ? '#7c3aed' : '#fff') + ';color:' +
        (activeTab === key ? '#fff' : '#52525b');
      b.addEventListener('click', function () {
        if (activeTab === key) return;
        activeTab = key;
        renderTabs();
        renderBody();
      });
      return b;
    }
    function renderTabs() {
      tabsEl.innerHTML = '';
      tabsEl.appendChild(makeTab('keyword', '关键词'));
      tabsEl.appendChild(makeTab('attachment', '附件'));
    }

    function renderBody() {
      if (hasError) return; // 错误态已由 fetch 分支写入
      if (!cached) {
        bodyEl.innerHTML = '<div style="padding:28px 4px;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>';
        return;
      }
      if (activeTab === 'keyword') {
        var wrap = document.createElement('div');
        wrap.innerHTML =
          '<input data-hist-kw type="text" placeholder="输入关键词过滤消息（正文 + 附件标题）…" ' +
          'style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #e4e4e7;border-radius:6px;font-size:12.5px;color:#18181b;outline:none;background:#fafafa;margin-bottom:10px" />' +
          '<div data-hist-kw-body></div>';
        bodyEl.innerHTML = '';
        bodyEl.appendChild(wrap);
        var input = wrap.querySelector('[data-hist-kw]');
        var kwBody = wrap.querySelector('[data-hist-kw-body]');
        function applyKw() { kwBody.innerHTML = renderHistoryKeywordHtml(cached, input.value); }
        input.addEventListener('input', applyKw);
        applyKw();
      } else {
        bodyEl.innerHTML = renderHistoryAttachmentHtml(flattenHistoryAttachments(cached));
      }
    }

    closeBtn.addEventListener('click', closeHistoryPanel);
    overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeHistoryPanel(); });
    fullLink.addEventListener('click', function (e) {
      e.preventDefault();
      closeHistoryPanel();
      showView('history', conversationId || '');
    });

    renderTabs();

    if (errorMsg) {
      hasError = true;
      bodyEl.innerHTML = '<div style="padding:28px 4px;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(errorMsg) + '</div>';
      return;
    }
    if (!conversationId) {
      hasError = true;
      bodyEl.innerHTML = '<div style="padding:28px 4px;text-align:center;color:#e1262b;font-size:12.5px">缺少会话 ID，无法加载历史记录</div>';
      return;
    }

    renderBody(); // 先显示「加载中…」占位
    window.fetch('/conv-api/conversations/' + encodeURIComponent(conversationId) + '/messages?_=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    }).then(function (response) {
      return response.json().catch(function () { return []; }).then(function (data) {
        if (!response.ok) throw new Error((data && (data.error || data.detail)) || '加载历史记录失败');
        return data;
      });
    }).then(function (items) {
      cached = Array.isArray(items) ? items : [];
      if (!hasError) renderBody();
    }).catch(function (error) {
      hasError = true;
      bodyEl.innerHTML = '<div style="padding:28px 4px;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }

  // 暴露给对话工作台（chat-ui iframe）：iframe 内直接调用 window.parent.openHistoryPanel(cid)
  // 即可复用同一右侧「历史记录」面板（关键词 + 附件），无需在 React 侧重复实现。
  // 注意：openHistoryPanel 仅操作 document.body 下的自建 fixed 节点，不触碰 React 托管 DOM，
  // 符合注入层 React 协调器铁律，故从 iframe 触发也安全。
  window.openHistoryPanel = openHistoryPanel;

  // 跨文档安全网：chat-ui 亦可 postMessage({ type:'nhd-open-history', conversationId }) 触发，
  // 兼容「iframe 与主页面同源、但父级 openHistoryPanel 尚未就绪」的极端时序（理论上不会发生）。
  if (!window.__NHD_HISTORY_MSG__) {
    window.__NHD_HISTORY_MSG__ = true;
    window.addEventListener('message', function (e) {
      try {
        var d = e.data;
        if (d && d.type === 'nhd-open-history' && d.conversationId) openHistoryPanel(d.conversationId, null);
      } catch (_) {}
    });
  }
// ===== chat-nav 模块: 30-nav — 左侧导航注入 + 设置页导航项(隐藏原生/构建自建) =====
  // ── intercept other nav clicks to hide chat ────────────────────────────────

  function setupNavInterception() {
    if (window.__chatNavInterceptionInstalled) return;
    window.__chatNavInterceptionInstalled = true;
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      // 「对话历史」(duiHuaLiShi) 走 Twenty 原生表格/看板概览，不再强制气泡视图；
      // 单条记录详情页由 ensureHistoryDrillButton 注入「查看对话内容」按钮钻取气泡。
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
// ===== chat-nav 模块: 40-settings — 渠道/WhatsApp 绑定页 + 权限(RBAC)设置页 + 账户设置卡片 =====
  function statusLabel(status) {
    if (status === 'WORKING') return '已连接';
    if (status === 'SCAN_QR_CODE') return '等待扫码';
    if (status === 'STARTING') return '启动中';
    if (status === 'STOPPED') return '未启动';
    if (status === 'FAILED') return '连接失败';
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
      ? (connected ? '已绑定并在线' : '已关联到当前账号，等待扫码授权')
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
        ? (boundToCurrentUser
          ? '当前 CRM 账号已关联该 WhatsApp 会话，但还没有完成手机扫码授权。请用 WhatsApp 手机端扫描二维码，成功后才可收发消息。'
          : (state.status === 'FAILED' ? '当前会话异常，系统会自动重新生成二维码。请稍等几秒后扫码。' : '请用 WhatsApp 手机端扫描下方二维码，完成后页面会自动刷新状态。'))
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
    return window.fetch('/conv-api/channel-accounts/whatsapp/status', { credentials: 'same-origin', cache: 'no-store', headers: getTwentyAuthHeaders() })
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
        if (page && isChannelsSettingsPage() && document.visibilityState === 'visible') loadWhatsAppStatus(page);
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
// ===== chat-nav 模块: 50-nav-entry — tryInsert：导航注入主入口 =====
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

    function directNavRowFor(node) {
      var row = node;
      while (row && row.parentElement && row.parentElement !== listEl && row !== document.body) {
        row = row.parentElement;
      }
      return row && row.parentElement === listEl ? row : null;
    }

    function navOrderForAnchor(anchor) {
      if (!anchor) return 900;
      if (anchor.id === NAV_ID) return 10;
      if (anchor.id === MAIL_NAV_ID) return 20;
      if (anchor.id === SETTINGS_NAV_ID) return 70;
      var href = anchor.getAttribute('href') || '';
      if (/^\/settings(\/|$)/.test(href)) return 70;
      var objectSlug = '';
      var objectMatch = href.match(/^\/objects\/([^\/?#]+)/);
      if (objectMatch) objectSlug = canonicalObject(objectMatch[1]);
      else if (/^\/opportunities(\?|#|$)/.test(href)) objectSlug = 'opportunity';
      else if (/^\/people(\?|#|$)/.test(href)) objectSlug = 'person';
      if (objectSlug === 'opportunity') return 30;
      if (objectSlug === 'person') return 40;
      if (objectSlug === 'xiangMu') return 50;
      if (objectSlug === 'duiHuaLiShi') return 60;
      return 900;
    }

    function applyMainNavOrder() {
      try {
        listEl.style.display = 'flex';
        listEl.style.flexDirection = 'column';
        var seen = [];
        Array.from(listEl.querySelectorAll('a[href],[role="button"]')).forEach(function (anchor) {
          if (!isLeftNavigationAnchor(anchor) &&
              anchor.id !== NAV_ID &&
              anchor.id !== MAIL_NAV_ID &&
              anchor.id !== SETTINGS_NAV_ID) return;
          var row = directNavRowFor(anchor);
          if (!row || seen.indexOf(row) !== -1) return;
          seen.push(row);
          row.style.order = String(navOrderForAnchor(anchor));
        });
      } catch (e) {}
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
        listEl.appendChild(wrapper);
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

    applyMainNavOrder();

    setupNavInterception();

    setNavActive(getActiveView());
  }

  // ── resize: keep iframe filling the content area ──────────────────────────

  window.addEventListener('resize', function () {
    Array.from(document.querySelectorAll('iframe[data-chat-view]')).forEach(function (iframe) {
      if (iframe.style.display !== 'none') applyIframeSize(iframe);
    });
  });
// ===== chat-nav 模块: 60-convert — 线索转客户/转项目按钮 =====
  // ── 线索转客户：线索列表顶部「转客户」按钮（放在 +New opportunity 左侧）──────────
  var CONVERT_BTN_ID = '__lead_convert_top_btn__';
  var CONVERT_PROJECT_BTN_ID = '__lead_convert_project_top_btn__';
  var CONVERT_MODAL_ID = '__lead_convert_modal__';

  function isOpportunityListPage() {
    var r = parseRoute();
    return !!r && r.kind === 'list' && canonicalObject(r.slug) === 'opportunity';
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

    var host = document.getElementById('__lead_convert_action_host__');
    if (!host || host.parentElement !== anchor.parentElement) {
      if (host) host.remove();
      host = document.createElement('span');
      host.id = '__lead_convert_action_host__';
      host.setAttribute('data-lead-convert-host', '1');
      host.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:8px;flex-shrink:0;';
      anchor.parentElement.appendChild(host);
    }
    if (existing.parentElement !== host) host.appendChild(existing);
    if (projectBtn.parentElement !== host) host.appendChild(projectBtn);
  }

  // ── 线索详情页：跟进记录悬浮入口 + 弹窗列表 ──────────────────────────────────
  // 汇总该线索下所有关联会话的跟进（不止直接挂在线索上的），按当前登录人权限过滤——
  // 由后端 GET /conv-api/follow-ups?subjectType=opportunity 保证：admin/boss 看全部，
  // 销售仅见自己所写。不侵入 Twenty 原生字段的 DOM（结构会随 Twenty 升级变化），
  // 用独立悬浮按钮+弹窗展示，跟本文件里「转客户」按钮、官网归类弹窗是同一套模式。
// ===== chat-nav 模块: 70-record-actions — 跟进记录 + 协办人 + 附件 + 成员重置密码 =====
  var FOLLOWUP_BTN_ID = '__followup_entry_btn__';
  var FOLLOWUP_MODAL_ID = '__followup_modal__';

  function opportunityRecordId() {
    var r = parseRoute();
    return (r && r.kind === 'detail' && canonicalObject(r.slug) === 'opportunity') ? r.id : '';
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

  // ── 线索/客户联系人/项目 详情页：协办人悬浮入口 + 弹窗 ─────────────────────────
  // 协作人字段 xieBanRenId（单值 RELATION→成员）。仅主负责人(ownerId)或管理员可设置；
  // 协作人可看关联记录的对话、可接管/回复（后端 conversationVisibilityWhere 已纳入）。
  // 后端 GET /api/crm/:objectType/:id/collaborators 返回 collaboratorId + canEdit。
  var COLLAB_BTN_ID = '__collab_entry_btn__';
  var COLLAB_MODAL_ID = '__collab_modal__';

  // 抽屉感知：从右侧抽屉内找「当前记录」的自链接锚点（href=/objects/<type>/<uuid>）。
  // 与钻取按钮同款 findRightDrawer 逻辑；支持 opportunity/person/xiangMu 三类。
  function findCollaboratorRecordFromDrawer() {
    var drawer = findRightDrawer();
    if (!drawer) return null;
    var anchors = drawer.querySelectorAll('a[href*="/object/"], a[href*="/objects/"]');
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href') || '';
      var m = href.match(/\/objects?\/(opportunities|people|_xiangMus)\/([0-9a-fA-F-]{36})/);
      if (!m) continue;
      var objectType = m[1] === 'opportunities' ? 'opportunity' : (m[1] === 'people' ? 'person' : 'xiangMu');
      return { objectType: objectType, id: m[2], via: 'drawer', drawerClass: (drawer.className && drawer.className.toString().slice(0, 80)) || '(none)' };
    }
    return { id: null, debug: { via: 'drawer-no-anchor', drawerClass: (drawer.className && drawer.className.toString().slice(0, 120)) || '(none)' } };
  }

  function collaboratorRecordContext() {
    var r = parseRoute();
    if (r && r.kind === 'detail') {
      var c = canonicalObject(r.slug);
      if (c === 'opportunity' || c === 'person' || c === 'xiangMu') {
        return { objectType: c, id: r.id, via: 'url' };
      }
    }
    // S2：右侧抽屉（URL 不变、无 show-page 锚点）——兼容 Twenty 默认点开记录方式
    var drawerRes = findCollaboratorRecordFromDrawer();
    if (drawerRes && drawerRes.id) return drawerRes;
    return null;
  }

  function closeCollabModal() {
    var m = document.getElementById(COLLAB_MODAL_ID);
    if (m) m.remove();
  }

  function openCollabModal(ctx) {
    closeCollabModal();
    var overlay = document.createElement('div');
    overlay.id = COLLAB_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100003;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(480px,100%);max-height:min(560px,90vh);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    card.innerHTML =
      '<div style="padding:16px 18px 10px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:15px;font-weight:700;color:#111">协办人</div>' +
        '<button data-collab-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1">×</button>' +
      '</div>' +
      '<div data-collab-body style="padding:0 18px 8px;overflow:auto;flex:1">' +
        '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>' +
      '</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeCollabModal(); });
    card.querySelector('[data-collab-close]').addEventListener('click', closeCollabModal);
    document.body.appendChild(overlay);

    var body = card.querySelector('[data-collab-body]');
    Promise.all([
      window.fetch('/conv-api/crm/' + ctx.objectType + '/' + ctx.id + '/collaborators', { credentials: 'same-origin', headers: getTwentyAuthHeaders() }).then(function (r) { return r.json(); }),
      window.fetch('/conv-api/crm/members', { credentials: 'same-origin', headers: getTwentyAuthHeaders() }).then(function (r) { return r.json(); }),
    ]).then(function (results) {
      var collab = results[0] || {};
      var membersResp = results[1] || {};
      if (!collab.ok) throw new Error(collab.error || '加载协办人失败');
      var members = Array.isArray(membersResp.members) ? membersResp.members : [];
      var nameMap = {};
      members.forEach(function (mm) { nameMap[mm.workspaceMemberId] = mm.name; });
      var currentName = collab.collaboratorId ? (nameMap[collab.collaboratorId] || '已设置成员') : '未设置';

      var html = '<div style="padding:14px 0">' +
        '<div style="font-size:12px;color:#71717a">当前协办人</div>' +
        '<div style="margin-top:4px;font-size:14px;font-weight:600;color:#18181b">' + escapeHtml(currentName) + '</div>' +
        '</div>';

      if (collab.canEdit) {
        var opts = '<option value="">— 清除协办人 —</option>' + members.map(function (mm) {
          var sel = mm.workspaceMemberId === collab.collaboratorId ? ' selected' : '';
          return '<option value="' + escapeHtml(mm.workspaceMemberId) + '"' + sel + '>' + escapeHtml(mm.name) + '</option>';
        }).join('');
        html += '<div style="padding:10px 0 4px;border-top:1px solid #f0f0f1">' +
          '<select data-collab-select style="width:100%;height:36px;border:1px solid #d4d4d8;border-radius:6px;padding:0 8px;font-size:13px;background:#fff">' + opts + '</select>' +
          '</div>' +
          '<div style="padding:8px 0 4px;display:flex;gap:8px">' +
            '<button data-collab-save style="flex:1;height:34px;border-radius:6px;border:1px solid #16a34a;background:#16a34a;color:#fff;font-size:13px;font-weight:700;cursor:pointer">保存</button>' +
          '</div>' +
          '<div style="padding:4px 0 10px;font-size:11px;color:#a1a1aa">协办人可查看该记录的对话历史、可接管并回复；仅主负责人或管理员可设置。</div>';
      } else {
        html += '<div style="padding:10px 0 4px;font-size:11px;color:#a1a1aa;border-top:1px solid #f0f0f1">仅主负责人或管理员可设置协办人。</div>';
      }
      body.innerHTML = html;

      if (collab.canEdit) {
        var select = body.querySelector('[data-collab-select]');
        var saveBtn = body.querySelector('[data-collab-save]');
        saveBtn.addEventListener('click', function () {
          var val = select.value || '';
          saveBtn.disabled = true; saveBtn.textContent = '保存中…';
          window.fetch('/conv-api/crm/' + ctx.objectType + '/' + ctx.id + '/collaborators', {
            method: 'PUT', credentials: 'same-origin',
            headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ collaboratorId: val }),
          }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
            .then(function (res) {
              if (!res.ok || !res.data.ok) throw new Error((res.data && (res.data.error || res.data.detail)) || '保存失败');
              openCollabModal(ctx);
            })
            .catch(function (err) {
              saveBtn.disabled = false; saveBtn.textContent = '保存';
              var errEl = document.createElement('div');
              errEl.style.cssText = 'padding:6px 0;color:#e1262b;font-size:12px';
              errEl.textContent = err.message || '保存失败';
              body.appendChild(errEl);
            });
        });
      }
    }).catch(function (error) {
      if (body) body.innerHTML = '<div style="padding:24px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }

  function ensureCollaboratorEntry() {
    var ctx = collaboratorRecordContext();
    var existing = document.getElementById(COLLAB_BTN_ID);
    var dbg = document.getElementById('__collab_dbg__');
    window.__NHD_COLLAB__ = { path: location.pathname, ctx: ctx, note: ctx ? 'button ready' : 'no record context' };
    if (!ctx) {
      if (existing) existing.remove();
      if (dbg) dbg.remove();
      return;
    }
    if (dbg) dbg.remove();
    if (existing) {
      existing.setAttribute('data-ctx', ctx.objectType + ':' + ctx.id);
      return;
    }
    var btn = document.createElement('button');
    btn.id = COLLAB_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('data-ctx', ctx.objectType + ':' + ctx.id);
    btn.textContent = '协办人';
    btn.style.cssText = [
      'position:fixed', 'left:24px', 'bottom:24px', 'z-index:9997',
      'height:36px', 'padding:0 16px', 'border-radius:18px',
      'border:1px solid #0ea5e9', 'background:#0ea5e9', 'color:#fff',
      'font-size:12.5px', 'font-weight:700', 'font-family:inherit',
      'cursor:pointer', 'box-shadow:0 6px 18px rgba(14,165,233,.32)',
    ].join(';');
    btn.addEventListener('click', function () {
      var parts = (btn.getAttribute('data-ctx') || '').split(':');
      if (parts.length === 2) openCollabModal({ objectType: parts[0], id: parts[1] });
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
    adminRow.appendChild(btn);
  }
// ===== chat-nav 模块: 80-boot — 启动调度(FEATURES/tick/节流/观察器) + UI兜底 + 退出设置重载 =====
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
  var lastTickAt = 0;
  var TICK_THROTTLE_MS = 200; // 时间节流：tick 最多每 200ms 真正跑一次。
  // 根因修复：旧版 MutationObserver 每次 DOM 变化都立即 tick()（无时间上限），
  // React 页面 DOM 高频变化 → tick 一秒几十上百次 → 每个 ensure* 的 DOM 探测放大成卡死。

  // 功能注册表：每个功能声明 id + 可选 when(路由谓词) + run。run 由 safeRun 逐个隔离，
  // 单个功能抛错不影响同轮其它功能。新增/下线功能只需增删一行，不再散落在 tick 里。
  var FEATURES = [
    { id: 'nav',      run: tryInsert },
    { id: 'convert',  run: ensureConvertTopButton },
    { id: 'followup', run: ensureFollowUpEntry },
    { id: 'attach',   run: ensureAttachEntry },
    { id: 'drill',    run: ensureHistoryDrillButton },
    { id: 'collab',   run: ensureCollaboratorEntry },
    { id: 'resetpwd', when: function () { return window.location.pathname.indexOf('/settings/workspace-members') === 0; }, run: ensureMemberResetPwdButton }
  ];

  function tick() {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
      for (var i = 0; i < FEATURES.length; i++) {
        var f = FEATURES[i];
        if (f.when && !f.when()) continue;
        safeRun(f.id, f.run);
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
  // scheduleTick: 时间节流（最多每 200ms 真正跑一次）+ 尾调用兜底。
  // MutationObserver 高频触发时只安排一次延迟执行，不会每变化都同步跑 tick（旧版卡死根因）。
  // 关键（2026-08-19 线索页崩溃根因）：tick 必须**始终异步**执行（setTimeout 0 排队到任务队列），
  // 严禁在 MutationObserver 回调的同步栈里跑——observer 回调在 React commit 间隙触发，若同步执行
  // 里面的 ensure*（insertBefore/style/textContent/setAttribute 改 React 节点）会打断 React 协调器
  // → 错误边界「抱歉，出了点问题」。所有 ensure* 改 DOM 必须在 React commit 完成后的任务里执行。
  function scheduleTick() {
    if (tickInProgress) return;
    var now = Date.now();
    var elapsed = now - lastTickAt;
    if (elapsed >= TICK_THROTTLE_MS) {
      lastTickAt = now;
      setTimeout(function () { tick(); }, 0); // 异步：不在 observer 同步栈内改 DOM
    } else if (!tickScheduled) {
      tickScheduled = true;
      setTimeout(function () {
        tickScheduled = false;
        lastTickAt = Date.now();
        tick();
      }, TICK_THROTTLE_MS - elapsed);
    }
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

  // ── 线索字段显示兜底：服务端 metadata 已改为「公司名称」，但 Twenty 前端可能长期持有旧缓存。
  // 这里只处理可见文案，不改数据；并隐藏右侧记录页的 Company 关系卡片，避免和公司名称主列重复。
  (function () {
    if (window.__NHD_LEAD_COMPANY_UI_FIX__) return;
    window.__NHD_LEAD_COMPANY_UI_FIX__ = true;

    function textOf(node) {
      return (node && node.textContent ? node.textContent : '').trim();
    }

    function replaceVisitorIdLabels(root) {
      var scope = root && root.querySelectorAll ? root : document;
      var nodes = scope.querySelectorAll('span, div, button, th, label, p');
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (textOf(node) === '访客ID') node.textContent = '公司名称';
      }
    }

    function hideCompanyRelationCards(root) {
      var scope = root && root.querySelectorAll ? root : document;
      var nodes = scope.querySelectorAll('span, div, button, label, p');
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (textOf(node) !== 'Company') continue;
        var card = node.closest('[data-testid], [role="button"], section, article, div');
        for (var depth = 0; card && depth < 6; depth++) {
          var cardText = textOf(card);
          if (cardText === 'Company' || /^Company\s*$/.test(cardText)) {
            card.style.display = 'none';
            card.setAttribute('data-nhd-hidden-company-relation', '1');
            break;
          }
          card = card.parentElement;
        }
      }
    }

    // 仅「机会(线索)」对象需要这个兜底（列表列头 + 详情字段 label + 详情 Company 卡片）。
    function isOpportunityPage() {
      var r = parseRoute();
      return !!r && canonicalObject(r.slug) === 'opportunity';
    }

    function applyLeadCompanyUiFix(root) {
      if (!isOpportunityPage()) return;
      replaceVisitorIdLabels(root || document);
      hideCompanyRelationCards(root || document);
    }

    applyLeadCompanyUiFix();
    // 根因修复：去掉 setInterval 每秒全文档扫描（大表格页卡死主因之一）。
    // 改为「路由切换时全量兜底」+「DOM 变化异步防抖扫描」，且仅机会页生效。
    var _lcLastPath = window.location.pathname;
    function _lcOnRoute() {
      if (window.location.pathname !== _lcLastPath) {
        _lcLastPath = window.location.pathname;
        applyLeadCompanyUiFix();
      }
    }
    window.addEventListener('popstate', _lcOnRoute);
    window.addEventListener('hashchange', _lcOnRoute);
    // 防抖：MutationObserver 回调在 React commit 期间触发，若同步改 DOM（textContent/style/attribute）
    // 会打断 React 19 的协调器 → 触发错误边界「抱歉，出了点问题」（2026-08-19 线索页崩溃根因）。
    // 改为收集变化子树后延时 120ms 再异步扫描（与 React 渲染错开），仅机会页生效。
    var _lcTimer = 0;
    var _lcPending = false;
    var _lcTargets = [];
    try {
      new MutationObserver(function (mutations) {
        if (!isOpportunityPage()) return;
        for (var i = 0; i < mutations.length; i++) {
          var t = mutations[i].target;
          if (mutations[i].type === 'characterData') t = t.parentElement; // 文本节点 → 父元素
          if (!t || !t.querySelectorAll) continue;
          if (_lcTargets.indexOf(t) === -1) _lcTargets.push(t);
        }
        if (!_lcTargets.length) return;
        if (_lcPending) return;
        _lcPending = true;
        clearTimeout(_lcTimer);
        _lcTimer = setTimeout(function () {
          _lcPending = false;
          var list = _lcTargets; _lcTargets = [];
          for (var k = 0; k < list.length; k++) {
            replaceVisitorIdLabels(list[k]);
            hideCompanyRelationCards(list[k]);
          }
        }, 120);
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (_) {}
  })();


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
