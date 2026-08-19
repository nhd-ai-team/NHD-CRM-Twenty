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
