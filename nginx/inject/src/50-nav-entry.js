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
