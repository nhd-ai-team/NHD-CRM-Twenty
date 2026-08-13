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
    script.src = '/settings-channels-panel.js?v=20260813-panel-cache-v2';
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
})();
