// ===== chat-nav 模块: 20-drill — 右侧抽屉检测(findRightDrawer) + 沟通状态钻取按钮 =====
  // 在「沟通状态」记录详情注入悬浮按钮，点击钻取到该会话的对话气泡。
  // 兼容两种打开方式：① 整页路由 /objects/duiHuaLiShi[s]/<uuid>；
  // ② Twenty 默认右侧抽屉(URL 不变)：定位右侧 fixed 抽屉容器，从其内部
  //    「在完整页面打开」锚点(/objects/duiHuaLiShi/<uuid>)取 record id。
  function getZIndex(el) {
    var z = 0;
    while (el && el !== document.body) {
      var v = parseInt(getComputedStyle(el).zIndex, 10);
      if (!isNaN(v) && v > z) z = v;
      el = el.parentElement;
    }
    return z;
  }

  // 定位 Twenty 右侧抽屉容器：fixed/absolute + 贴右 + 占大半屏高。
  // 关键：class 选择器只用高信号、低基数候选（drawer/modal/overlay/sheet），
  // 严禁用 page/record/detail/panel/show 等超宽泛匹配——它们会命中几乎所有容器，
  // 导致每 tick 对成百上千节点调 getComputedStyle 而卡死页面（尤其切换到大表格页时）。
  // 缓存：同一路由 300ms 内复用上次结果，避免每 tick 被多个 ensure* 重复全量扫 DOM。
  var _drawerCache = { key: '', at: 0, val: null };
  function findRightDrawer() {
    var key = window.location.pathname + window.location.search;
    var now = Date.now();
    if (_drawerCache.key === key && (now - _drawerCache.at) < 300) return _drawerCache.val;
    _drawerCache.key = key; _drawerCache.at = now; _drawerCache.val = findRightDrawerScan();
    return _drawerCache.val;
  }
  function findRightDrawerScan() {
    var sel = '[role="dialog"],[aria-modal="true"],[class*="drawer"],[class*="Drawer"],[class*="RightDrawer"],[class*="overlay"],[class*="Overlay"],[class*="modal"],[class*="Modal"],[class*="sheet"],[class*="Sheet"]';
    var els = document.querySelectorAll(sel);
    var best = null, bestZ = -1, scanned = 0;
    var MAX_SCAN = 80; // 安全上限：即使意外大量匹配也绝不卡死
    for (var i = 0; i < els.length; i++) {
      if (scanned >= MAX_SCAN) break;
      scanned++;
      var el = els[i];
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 220 || r.height < window.innerHeight * 0.5) continue;
      var z = parseInt(cs.zIndex, 10) || 0;
      if (z > bestZ) { bestZ = z; best = el; }
    }
    // 轻量几何兜底：仅扫描 body 直接子节点及其一层后代（React portal 抽屉通常挂在 body 下）。
    // 严禁全文档扫描（对大表格会触发海量 getComputedStyle 导致页面卡死）。
    if (!best) {
      var cand = [];
      var bc = document.body.children;
      for (var c = 0; c < bc.length; c++) {
        cand.push(bc[c]);
        var cc = bc[c].children;
        for (var d = 0; d < cc.length; d++) cand.push(cc[d]);
      }
      for (var k = 0; k < cand.length; k++) {
        var e = cand[k];
        var ec = getComputedStyle(e);
        if (ec.position !== 'fixed' && ec.position !== 'absolute') continue;
        var er = e.getBoundingClientRect();
        if (er.width < 220 || er.width > window.innerWidth * 0.95) continue;
        if (er.height < window.innerHeight * 0.5) continue;
        if (er.top > 8) continue;
        if (window.innerWidth - er.right > 8) continue; // 必须贴右
        var ez = parseInt(ec.zIndex, 10) || 0;
        if (ez > bestZ) { bestZ = ez; best = e; }
      }
    }
    return best;
  }

  // 返回 { id, via } 或 { id: null, debug }
  function findDuiHuaLiShiRecordId() {
    // S1: 整页路由（统一走 parseRoute，兼容单数/复数 object 与 slug）
    var r = parseRoute();
    if (r && r.kind === 'detail' && canonicalObject(r.slug) === 'duiHuaLiShi') return { id: r.id, via: 'url' };
    // S2: 仅当右侧抽屉打开时，才在抽屉内找 duiHuaLiShi 详情自链接锚点。
    //     无抽屉（即列表/概览页）直接返回，不扫全文档，避免误触发 + 卡顿。
    var drawer = findRightDrawer();
    if (!drawer) return { id: null, debug: { via: 'no-drawer' } };
    var anchors = drawer.querySelectorAll('a[href*="/object/duiHuaLiShi"], a[href*="/objects/duiHuaLiShi"]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (a.getClientRects().length === 0) continue; // 不可见跳过
      var m = (a.getAttribute('href') || '').match(/\/objects?\/duiHuaLiShi[s]?\/([0-9a-fA-F-]{36})/);
      if (m) return { id: m[1], via: 'anchor' };
    }
    // S3 兜底已移除（2026-08-19 残留 bug 根因）：
    // 「抽屉内任意 /object 锚点」会误命中其他对象（person/线索/客户/项目），
    // 导致离开 duiHuaLiShi 上下文后按钮残留（在对话工作台/资料抽屉场景必现）。
    // 真实 duiHuaLiShi 抽屉详情场景下 S2 的「在完整页面打开」自链接必然存在，够用。
    return { id: null, debug: { via: 'drawer-no-anchor', drawerClass: (drawer.className && drawer.className.toString().slice(0, 160)) || '(none)', drawerTag: drawer.tagName } };
  }

  // 诊断探针：在控制台运行 __NHD_DRILL_PROBE__() 可打印抽屉检测详情，便于排障
  function installDrillProbe() {
    if (window.__NHD_DRILL_PROBE__) return;
    window.__NHD_DRILL_PROBE__ = function () {
      var drawer = findRightDrawer();
      var out = {
        path: location.pathname,
        urlMatch: (location.pathname.match(/\/objects?\/duiHuaLiShi[s]?\/([0-9a-fA-F-]{36})/) || [])[1] || null,
        drawerFound: !!drawer,
        drawerTag: drawer ? drawer.tagName : null,
        drawerClass: drawer ? (drawer.className && drawer.className.toString().slice(0, 200)) : null,
        drawerRect: drawer ? (function (r) { return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), right: Math.round(r.right) }; })(drawer.getBoundingClientRect()) : null,
        dhAnchors: (function () {
          var list = document.querySelectorAll('a[href*="/object/duiHuaLiShi"], a[href*="/objects/duiHuaLiShi"]');
          var r = [];
          for (var i = 0; i < Math.min(list.length, 8); i++) r.push(list[i].getAttribute('href'));
          return r;
        })(),
        anyObjectAnchors: (function () {
          var list = document.querySelectorAll('a[href*="/object/"], a[href*="/objects/"]');
          var r = [];
          for (var i = 0; i < Math.min(list.length, 12); i++) {
            var h = list[i].getAttribute('href') || '';
            var m = h.match(/\/objects?\/([A-Za-z0-9_]+)\/([0-9a-fA-F-]{36})/);
            if (m) r.push(m[1] + '/' + m[2].slice(0, 8));
          }
          return r;
        })(),
        drillState: window.__NHD_DRILL__ || null,
      };
      try { console.log('[NHD drill probe]', JSON.stringify(out, null, 2)); } catch (_) {}
      return out;
    };
  }

  function ensureHistoryDrillButton() {
    try {
      installDrillProbe();
      // 全屏 iframe 视图（对话工作台 / 邮件 / 历史气泡）激活时，按钮必须移除：
      // showView() 不改变 URL——若进入 iframe 前停在 duiHuaLiShi 详情页，S1 整页路由会一直命中，
      // 导致「查看对话内容」按钮残留并浮在 iframe 之上（z-index 200 > iframe 100）。
      // 用 isChatVisible()（10-auth 定义，同一 IIFE）判断 iframe 是否可见，避免误判抽屉。
      if (isChatVisible()) {
        var btn0 = document.getElementById('__history_drill_btn__');
        if (btn0) btn0.remove();
        window.__NHD_DRILL__ = { path: location.pathname, id: null, note: 'chat/mail iframe active' };
        return;
      }
      var res = findDuiHuaLiShiRecordId();
      var recordId = res.id;
      var btn = document.getElementById('__history_drill_btn__');
      if (!recordId) {
        if (btn) btn.remove();
        window.__NHD_DRILL__ = { path: location.pathname, id: null, note: 'no record context', debug: res.debug };
        return;
      }
      if (btn) {
        if (btn.dataset.rid !== recordId) btn.dataset.rid = recordId;
        return;
      }
      btn = document.createElement('button');
      btn.id = '__history_drill_btn__';
      btn.dataset.rid = recordId;
      btn.textContent = '查看对话内容';
      btn.style.cssText = [
        'position:fixed', 'right:20px', 'bottom:20px', 'z-index:200',
        'padding:9px 16px', 'border:none', 'border-radius:8px',
        'background:var(--twenty-color-purple-50,#9333ea)', 'color:#fff',
        'font-size:13px', 'font-weight:600', 'cursor:pointer',
        'box-shadow:0 2px 10px rgba(0,0,0,.25)',
      ].join(';');
      btn.addEventListener('click', function () {
        var rid = btn.dataset.rid;
        btn.disabled = true; var prev = btn.textContent; btn.textContent = '加载中…';
        fetchDuiHuaLiShiConversationId(rid).then(function (cid) {
          // 不跳全屏 iframe：就地弹窗，把会话消息以文本形式直接呈现（用户可快速定位）。
          openConversationTextModal(cid, null);
        }).catch(function () {
          openConversationTextModal(null, '未找到该记录的关联会话');
        }).finally(function () {
          btn.disabled = false; btn.textContent = prev;
        });
      });
      document.body.appendChild(btn);
      window.__NHD_DRILL__ = { path: location.pathname, id: recordId, via: res.via, note: 'button injected' };
    } catch (e) {}
  }

  // ── 沟通明细内联文本弹窗 ────────────────────────────────────────────────
  // 用户诉求：看沟通明细不应整页跳转到聊天视图（切页后上下文丢失、难以快速定位），
  // 应就地以「文本形式」直接呈现会话消息。点击「查看对话内容」→ 本弹窗拉取
  // /conv-api/conversations/:id/messages 渲染消息列表（发送方+时间+内容+附件/媒体），
  // 顶部关键词过滤可即时定位；底部保留「在完整对话页打开」作为可选入口。
  var CONV_TEXT_MODAL_ID = '__conv_text_modal__';

  function closeConversationTextModal() {
    var m = document.getElementById(CONV_TEXT_MODAL_ID);
    if (m) m.remove();
  }

  // 单条消息渲染：发送方标签(按 senderType 着色) + 时间 + 正文(pre-wrap) + 附件/媒体链接。
  function renderConversationMessageHtml(msg) {
    var senderLabel = '未知', senderColor = '#52525b';
    if (msg.senderType === 'customer') { senderLabel = '客户'; senderColor = '#0369a1'; }
    else if (msg.senderType === 'agent') { senderLabel = '我方'; senderColor = '#7c3aed'; }
    else if (msg.senderType === 'ai') { senderLabel = 'AI'; senderColor = '#059669'; }
    var timeText = formatFollowUpTimeLocal(msg.sentAt);
    var parts = [];
    // 媒体（WhatsApp/IG 入站图片视频等）
    if (msg.mediaUrl) {
      parts.push('<a href="' + escapeHtml(msg.mediaUrl) + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block;margin-top:6px;font-size:12px;color:#0369a1;text-decoration:none;font-weight:600">' +
        attachIcon(String(msg.contentType || 'file').replace(/^image\//, 'jpg')) + ' 查看媒体文件 ↗</a>');
    }
    // 附件（官网/邮件出站等，JSONB 数组）
    var atts = Array.isArray(msg.attachments) ? msg.attachments : [];
    for (var i = 0; i < atts.length; i++) {
      var att = atts[i] || {};
      var url = String(att.url || att.href || '').trim();
      if (!url) continue;
      var title = att.title || att.fileName || att.filename || '附件';
      var size = formatAttachSize(att.sizeBytes || att.size || 0);
      parts.push('<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block;margin-top:6px;font-size:12px;color:#0369a1;text-decoration:none;font-weight:600">' +
        attachIcon(String(att.fileType || att.contentType || 'file').replace(/^image\//, 'jpg')) + ' ' +
        escapeHtml(title) + (size ? ' · ' + size : '') + ' ↗</a>');
    }
    var body = String(msg.content || '').trim();
    return '<div style="padding:10px 0;border-bottom:1px solid #f0f0f1">' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:#a1a1aa">' +
        '<span style="font-weight:700;color:' + senderColor + '">' + senderLabel + '</span>' +
        '<span>' + escapeHtml(timeText) + '</span>' +
      '</div>' +
      (body ? '<div style="margin-top:4px;font-size:13px;line-height:1.65;color:#18181b;white-space:pre-wrap;word-break:break-word">' + escapeHtml(body) + '</div>' : '') +
      (parts.length ? parts.join('') : '') +
    '</div>';
  }

  function renderConversationTextBody(container, messages, keyword) {
    var kw = String(keyword || '').trim().toLowerCase();
    var list = messages;
    if (kw) {
      list = [];
      for (var i = 0; i < messages.length; i++) {
        var hay = String(messages[i].content || '') + ' ' + (messages[i].senderType || '') + ' ';
        if (hay.toLowerCase().indexOf(kw) >= 0) list.push(messages[i]);
      }
    }
    if (!list.length) {
      container.innerHTML = '<div style="padding:28px 0;text-align:center;color:#a1a1aa;font-size:12.5px">' +
        (kw ? '没有匹配「' + escapeHtml(kw) + '」的消息' : '该会话暂无消息') + '</div>';
      return;
    }
    container.innerHTML = list.map(renderConversationMessageHtml).join('');
  }

  function openConversationTextModal(conversationId, errorMsg) {
    closeConversationTextModal();
    var overlay = document.createElement('div');
    overlay.id = CONV_TEXT_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(680px,100%);max-height:min(78vh,720px);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    card.innerHTML =
      '<div style="padding:14px 18px 8px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:15px;font-weight:700;color:#111">沟通明细</div>' +
        '<button data-convtext-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1">×</button>' +
      '</div>' +
      '<div style="padding:0 18px 10px">' +
        '<input data-convtext-filter type="text" placeholder="输入关键词过滤消息…" ' +
        'style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #e4e4e7;border-radius:6px;font-size:12.5px;color:#18181b;outline:none;background:#fafafa" />' +
      '</div>' +
      '<div data-convtext-body style="padding:0 18px 8px;overflow:auto;flex:1">' +
        '<div style="padding:28px 0;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>' +
      '</div>' +
      '<div style="padding:8px 18px 14px;display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#a1a1aa;border-top:1px solid #f4f4f5">' +
        '<span>按时间正序展示本会话消息；仅展示你有权限查看的内容。</span>' +
        '<a data-convtext-full href="#" style="color:#7c3aed;text-decoration:none;font-weight:600">在完整对话页打开 ↗</a>' +
      '</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeConversationTextModal(); });
    card.querySelector('[data-convtext-close]').addEventListener('click', closeConversationTextModal);
    document.body.appendChild(overlay);

    var body = card.querySelector('[data-convtext-body]');
    var filterEl = card.querySelector('[data-convtext-filter]');
    var fullLink = card.querySelector('[data-convtext-full]');
    var cached = null;

    // 底部可选入口：保留原「整页聊天视图」能力，但不再是默认行为。
    fullLink.addEventListener('click', function (e) {
      e.preventDefault();
      closeConversationTextModal();
      showView('history', conversationId || '');
    });

    function applyFilter() {
      if (cached) renderConversationTextBody(body, cached, filterEl.value);
    }
    filterEl.addEventListener('input', applyFilter);

    if (errorMsg) {
      body.innerHTML = '<div style="padding:28px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(errorMsg) + '</div>';
      return;
    }
    if (!conversationId) {
      body.innerHTML = '<div style="padding:28px 0;text-align:center;color:#e1262b;font-size:12.5px">缺少会话 ID，无法加载消息</div>';
      return;
    }

    window.fetch('/conv-api/conversations/' + encodeURIComponent(conversationId) + '/messages?_=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    }).then(function (response) {
      return response.json().catch(function () { return []; }).then(function (data) {
        if (!response.ok) throw new Error((data && (data.error || data.detail)) || '加载消息失败');
        return data;
      });
    }).then(function (items) {
      cached = Array.isArray(items) ? items : [];
      renderConversationTextBody(body, cached, filterEl.value);
    }).catch(function (error) {
      body.innerHTML = '<div style="padding:28px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }
