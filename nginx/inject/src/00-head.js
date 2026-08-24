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
