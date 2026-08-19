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
