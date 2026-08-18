(function () {
  'use strict';

  var ITEMS = [
    {
      id: '__settings_accounts_nav_item__',
      href: '/settings/accounts',
      label: '账户',
      level: 1,
      svg: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    },
    {
      id: '__settings_emails_nav_item__',
      href: '/settings/accounts/emails',
      label: '电子邮件',
      level: 2,
      svg: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    },
    {
      id: '__settings_channels_nav_item__',
      href: '/settings/profile#channels',
      label: '渠道',
      level: 2,
      svg: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    },
    {
      id: '__settings_calendars_nav_item__',
      href: '/settings/accounts/calendars',
      label: '日历',
      level: 2,
      svg: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
    },
  ];

  function byText(text) {
    return Array.from(document.querySelectorAll('a[href^="/settings/"]')).find(function (anchor) {
      return (anchor.textContent || '').replace(/\s+/g, ' ').trim() === text;
    }) || null;
  }

  function makeAnchor(refAnchor, item) {
    var cs = window.getComputedStyle(refAnchor);
    var el = document.createElement('a');
    el.id = item.id;
    el.href = item.href;
    el.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:' + cs.padding,
      'padding-left:' + (item.level === 2 ? '32px' : '0'),
      'border-radius:' + cs.borderRadius,
      'font-size:' + cs.fontSize,
      'font-weight:' + cs.fontWeight,
      'color:var(--twenty-font-color-secondary,#52525b)',
      'text-decoration:none',
      'width:100%',
      'box-sizing:border-box',
      'cursor:pointer',
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
    svg.innerHTML = item.svg;
    var span = document.createElement('span');
    span.textContent = item.label;
    span.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    el.appendChild(svg);
    el.appendChild(span);
    return el;
  }

  function loadChannelsPanel() {
    if (window.NHDSettingsChannels && typeof window.NHDSettingsChannels.open === 'function') {
      if (typeof window.NHDSettingsChannels.isOpen === 'function' && window.NHDSettingsChannels.isOpen()) return;
      window.NHDSettingsChannels.open();
      return;
    }
    var existing = document.querySelector('script[data-settings-channels-panel="1"]');
    if (existing) return;
    var script = document.createElement('script');
    script.src = '/settings-channels-panel.js?v=20260813-panel-auth-wait-v1';
    script.async = true;
    script.setAttribute('data-settings-channels-panel', '1');
    script.onload = function () {
      if (window.NHDSettingsChannels && typeof window.NHDSettingsChannels.open === 'function') {
        window.NHDSettingsChannels.open();
      }
    };
    document.head.appendChild(script);
  }

  function closeChannelsPanelIfNeeded() {
    if (window.location.hash === '#channels') return;
    var panel = document.getElementById('__settings_channels_page__');
    if (panel) panel.style.display = 'none';
  }

  function ensureItem(refAnchor, afterRow, item) {
    var existing = document.querySelector('a[href="' + item.href + '"]') || document.getElementById(item.id);
    var wrapper = existing ? existing.closest('[data-settings-lite-nav-wrapper="1"]') : null;
    if (!existing) {
      existing = makeAnchor(refAnchor, item);
      wrapper = document.createElement(refAnchor.parentElement.tagName);
      wrapper.className = refAnchor.parentElement.className;
      wrapper.setAttribute('data-settings-lite-nav-wrapper', '1');
      wrapper.appendChild(existing);
    }
    var target = wrapper || existing.parentElement;
    if (afterRow && target && target.previousElementSibling !== afterRow) afterRow.insertAdjacentElement('afterend', target);
    if (item.id === '__settings_channels_nav_item__' && !existing.dataset.channelsClickBound) {
      existing.dataset.channelsClickBound = '1';
      existing.addEventListener('click', function (event) {
        event.preventDefault();
        if (window.location.pathname !== '/settings/profile' || window.location.hash !== '#channels') {
          window.history.pushState(null, '', '/settings/profile#channels');
        }
        loadChannelsPanel();
      });
    }
    return existing;
  }

  function tick() {
    if (window.location.pathname.indexOf('/settings') !== 0) return;
    var profile = document.querySelector('a[href="/settings/profile"]');
    var appearance = document.querySelector('a[href="/settings/profile/appearance"]') || byText('体验') || byText('Appearance');
    var ref = appearance || profile || document.querySelector('a[href^="/settings/"]');
    if (!ref || !ref.parentElement) return;
    var after = (appearance && appearance.parentElement) || ref.parentElement;
    ITEMS.forEach(function (item) {
      var anchor = ensureItem(ref, after, item);
      after = anchor && anchor.parentElement ? anchor.parentElement : after;
    });
    if (window.location.hash === '#channels') loadChannelsPanel();
    else closeChannelsPanelIfNeeded();
  }

  var ticking = false;
  function guardedTick() {
    if (ticking) return;
    ticking = true;
    try { tick(); } finally { ticking = false; }
  }

  new MutationObserver(guardedTick).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', guardedTick);
  window.addEventListener('hashchange', guardedTick);
  if (document.readyState === 'complete') guardedTick();
  else window.addEventListener('load', guardedTick);
  setInterval(guardedTick, 2000);

  // ── 渲染前兜底（v5）：退出设置后若主页面菜单未注入 / 绑定页残留，在浏览器绘制前整页刷新 ──
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
  try {
    var _leaveObserver = new MutationObserver(function () { _brokenAfterLeaveReload(); });
    if (document.body) _leaveObserver.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  // ── 兜底：退出设置时整页重载主页（与 chat-nav.js 同源，确保菜单/绑定页状态复位）──
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
