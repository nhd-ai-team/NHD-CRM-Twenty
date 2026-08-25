// ===== chat-nav 模块: 50-nav-entry — tryInsert：导航注入主入口 =====
  function tryInsert() {
    try { var _s = window.__NHD_STATE__; if (_s) { _s.lastTryInsertAt = Date.now(); _s.lastSettings = isSettingsPage(); } } catch (_) {}
    hideDisabledNativeNavItems();
    if (isSettingsPage()) {
      removeStandaloneMainNav();
      // 设置页左侧菜单由 Twenty 原生 React 树管理。不要向该树插入/移动节点，
      // 否则路由切换或 token renewal 后容易触发 React insertBefore 崩溃。
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
      ensureStandaloneMainNav(listEl, refAnchor);
    }

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
