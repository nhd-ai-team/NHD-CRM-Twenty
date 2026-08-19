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
  function scheduleTick() {
    if (tickInProgress) return;
    var now = Date.now();
    var elapsed = now - lastTickAt;
    if (elapsed >= TICK_THROTTLE_MS) {
      lastTickAt = now;
      tick();
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
    // 改为「路由切换时全量兜底」+「新增/文本变化子树按需扫描」，且仅机会页生效。
    var _lcLastPath = window.location.pathname;
    function _lcOnRoute() {
      if (window.location.pathname !== _lcLastPath) {
        _lcLastPath = window.location.pathname;
        applyLeadCompanyUiFix();
      }
    }
    window.addEventListener('popstate', _lcOnRoute);
    window.addEventListener('hashchange', _lcOnRoute);
    try {
      new MutationObserver(function (mutations) {
        if (!isOpportunityPage()) return;
        for (var i = 0; i < mutations.length; i++) {
          var t = mutations[i].target;
          if (mutations[i].type === 'characterData') t = t.parentElement; // 文本节点 → 父元素
          if (!t || !t.querySelectorAll) continue;
          replaceVisitorIdLabels(t);
          hideCompanyRelationCards(t);
        }
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
