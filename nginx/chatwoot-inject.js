(function () {
  'use strict';

  const CHATWOOT_URL = 'http://localhost:3004';
  const NAV_ITEM_ID = 'chatwoot-nav-item';
  const PANEL_ID = 'chatwoot-panel';

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = 'position:fixed;top:0;right:0;width:calc(100vw - 260px);height:100vh;z-index:9999;background:#fff;box-shadow:-4px 0 16px rgba(0,0,0,0.12);display:none;';
    const iframe = document.createElement('iframe');
    iframe.src = CHATWOOT_URL;
    iframe.title = '客服';
    iframe.style.cssText = 'border:none;width:100%;height:100%;display:block;';
    panel.appendChild(iframe);
    document.body.appendChild(panel);
    return panel;
  }

  function togglePanel() {
    const panel = createPanel();
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    const item = document.getElementById(NAV_ITEM_ID);
    if (item) item.style.background = panel.style.display === 'none' ? '' : 'rgba(0,0,0,0.06)';
  }

  function injectNavItem() {
    if (document.getElementById(NAV_ITEM_ID)) return true;

    const link = [...document.querySelectorAll('a')].find(a => a.href && a.href.includes('/objects/opportunities'));
    if (!link) return false;

    let el = link.parentElement;
    let targetSection = null;
    for (let i = 0; i < 10; i++) {
      if (el && el.children.length >= 5) { targetSection = el; break; }
      el = el?.parentElement;
    }
    if (!targetSection) return false;

    const item = document.createElement('div');
    item.id = NAV_ITEM_ID;
    item.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px', 'padding:0 12px',
      'height:32px', 'border-radius:6px', 'cursor:pointer', 'font-size:13px',
      'font-weight:500', 'color:inherit', 'user-select:none', 'transition:background 0.1s',
    ].join(';');
    item.innerHTML = [
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"',
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"',
      ' style="opacity:0.6;flex-shrink:0">',
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      '</svg><span>客服</span>',
    ].join('');

    item.addEventListener('mouseenter', () => { if (item.style.background === '') item.style.background = 'rgba(0,0,0,0.04)'; });
    item.addEventListener('mouseleave', () => { if (item.style.background === 'rgba(0,0,0,0.04)') item.style.background = ''; });
    item.addEventListener('click', togglePanel);

    targetSection.appendChild(item);
    createPanel();
    return true;
  }

  // 轮询直到侧边栏渲染完成
  let attempts = 0;
  const interval = setInterval(() => {
    if (injectNavItem() || ++attempts > 60) clearInterval(interval);
  }, 500);

  // MutationObserver 处理 SPA 路由切换
  const observer = new MutationObserver(() => { injectNavItem(); });
  observer.observe(document.body, { childList: true, subtree: true });
})();
