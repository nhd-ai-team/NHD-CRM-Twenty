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
