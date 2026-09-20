// ===== chat-nav 模块: 50-nav-entry — tryInsert：导航注入主入口 =====
  function ensureTopUserGuideNav() {
    var id = '__nhd_crm_user_guide_nav__';
    var existing = document.getElementById(id);
    if (isSettingsPage()) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      return;
    }
    var guide = document.createElement('a');
    guide.id = id;
    guide.href = '/crm-user-guide/';
    guide.title = '操作手册';
    guide.setAttribute('aria-label', '打开 CRM 操作手册');
    guide.style.cssText = [
      'position:fixed',
      'left:16px',
      'bottom:16px',
      'z-index:31',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'width:34px',
      'height:34px',
      'box-sizing:border-box',
      'border-radius:8px',
      'background:var(--twenty-background-primary,#fff)',
      'color:var(--twenty-font-color-secondary,#52525b)',
      'text-decoration:none',
      'box-shadow:0 1px 3px rgba(0,0,0,.12)',
    ].join(';');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5z"/><path d="M8 7h8M8 11h8M8 15h5"/>';
    guide.appendChild(svg);
    guide.addEventListener('mouseenter', function () { guide.style.background = 'var(--twenty-background-tertiary,rgba(0,0,0,.06))'; });
    guide.addEventListener('mouseleave', function () { guide.style.background = 'var(--twenty-background-primary,#fff)'; });
    document.body.appendChild(guide);
  }

  function tryInsert() {
    try { var _s = window.__NHD_STATE__; if (_s) { _s.lastTryInsertAt = Date.now(); _s.lastSettings = isSettingsPage(); } } catch (_) {}
    ensureTopUserGuideNav();
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
