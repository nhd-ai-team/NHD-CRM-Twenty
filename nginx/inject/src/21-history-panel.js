// ===== chat-nav 模块: 21-history-panel — 沟通状态右侧「历史记录」面板（关键词 + 附件）=====
  // 取代原「查看对话内容」居中弹窗：在沟通状态详情页右侧停靠一个面板，
  // 提供两种查询：① 关键词（按消息正文 + 附件标题过滤）；② 附件（列出本会话全部附件，新标签打开）。
  // DOM 在用户点击事件栈内创建，仅操作自建子树；面板为 document.body 下独立 fixed 节点，
  // 不触碰 React 托管节点，符合注入层 React 协调器铁律。
  var HISTORY_PANEL_ID = '__history_panel__';

  function closeHistoryPanel() {
    var p = document.getElementById(HISTORY_PANEL_ID);
    if (p) p.remove();
  }

  // 从 contentType 推导扩展名（供 attachIcon 使用），如 image/jpeg→jpg、application/pdf→pdf。
  function histFileType(contentType, fallback) {
    var ct = String(contentType || '').toLowerCase();
    if (ct.indexOf('image/') === 0) return ct.slice(6) || 'jpg';
    if (ct.indexOf('application/pdf') === 0) return 'pdf';
    if (ct.indexOf('application/msword') === 0) return 'doc';
    if (ct.indexOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document') === 0) return 'docx';
    if (ct.indexOf('application/vnd.ms-excel') === 0) return 'xls';
    if (ct.indexOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') === 0) return 'xlsx';
    if (ct.indexOf('text/') === 0) return 'txt';
    if (ct.indexOf('application/zip') === 0 || ct.indexOf('application/x-zip') === 0) return 'zip';
    if (ct) {
      var parts = ct.split('/');
      if (parts.length === 2 && parts[1] && parts[1] !== '*') return parts[1];
    }
    return fallback || 'file';
  }

  // 把消息数组展平为附件清单（镜像 middleware /api/attachments 的口径）：
  // attachments 数组优先；无数组但 mediaUrl 存在（WhatsApp/IG 入站单条媒体）补一条。
  function flattenHistoryAttachments(messages) {
    var items = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i] || {};
      var direction = m.senderType === 'customer' ? 'inbound' : 'outbound';
      var atts = Array.isArray(m.attachments) ? m.attachments : [];
      if (atts.length) {
        for (var j = 0; j < atts.length; j++) {
          var att = atts[j] || {};
          var url = String(att.url || att.href || '').trim();
          if (!url) continue;
          items.push({
            url: url,
            title: att.title || att.fileName || att.filename || '附件',
            fileType: histFileType(att.contentType || att.fileType || att.mimeType || att.mimetype || '', 'file'),
            contentType: att.contentType || att.mimeType || att.mimetype || null,
            sizeBytes: Number(att.sizeBytes || att.size || 0) || null,
            senderType: m.senderType,
            direction: direction,
            sentAt: m.sentAt,
          });
        }
      } else if (m.mediaUrl) {
        var title = (m.content && String(m.content).trim()) || (m.contentType ? histFileType(m.contentType, '媒体') + ' 附件' : '媒体文件');
        items.push({
          url: String(m.mediaUrl),
          title: title.slice(0, 180),
          fileType: histFileType(m.contentType, 'file'),
          contentType: m.contentType || null,
          sizeBytes: null,
          senderType: m.senderType,
          direction: direction,
          sentAt: m.sentAt,
        });
      }
    }
    return items;
  }

  // 关键词模式：过滤消息（正文 + 附件标题）后用既有消息渲染器逐条渲染。
  function renderHistoryKeywordHtml(messages, keyword) {
    var kw = String(keyword || '').trim().toLowerCase();
    var list = messages;
    if (kw) {
      list = [];
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i] || {};
        var atts = Array.isArray(m.attachments) ? m.attachments : [];
        var titles = [];
        for (var j = 0; j < atts.length; j++) {
          titles.push(atts[j] && (atts[j].title || atts[j].fileName || atts[j].filename) || '');
        }
        var hay = String(m.content || '') + ' ' + titles.join(' ') + ' ' + (m.senderType || '');
        if (hay.toLowerCase().indexOf(kw) >= 0) list.push(m);
      }
    }
    if (!list.length) {
      return '<div style="padding:28px 4px;text-align:center;color:#a1a1aa;font-size:12.5px">' +
        (kw ? '没有匹配「' + escapeHtml(kw) + '」的消息' : '该会话暂无消息') + '</div>';
    }
    var out = '';
    for (var k = 0; k < list.length; k++) out += renderConversationMessageHtml(list[k]);
    return out;
  }

  function renderHistoryAttachmentHtml(items) {
    if (!items.length) {
      return '<div style="padding:28px 4px;text-align:center;color:#a1a1aa;font-size:12.5px">该会话暂无附件</div>';
    }
    var out = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var badge, badgeColor;
      if (it.direction === 'inbound') { badge = '客户 · 入站'; badgeColor = '#0369a1'; }
      else if (it.senderType === 'ai') { badge = 'AI · 出站'; badgeColor = '#059669'; }
      else { badge = '我方 · 出站'; badgeColor = '#7c3aed'; }
      var size = formatAttachSize(it.sizeBytes || 0);
      var time = formatFollowUpTimeLocal(it.sentAt);
      var meta = [];
      meta.push('<span style="color:' + badgeColor + ';font-weight:600">' + escapeHtml(badge) + '</span>');
      if (size) meta.push(escapeHtml(size));
      if (time) meta.push(escapeHtml(time));
      out +=
        '<div style="display:flex;gap:10px;padding:10px;margin-bottom:8px;border:1px solid #eeedf1;border-radius:8px;background:#fff">' +
          '<div style="flex:0 0 36px;height:36px;border-radius:7px;background:#f3effe;color:#7c3aed;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;text-transform:uppercase;overflow:hidden">' +
            escapeHtml(String(it.fileType || 'file').slice(0, 4)) +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:600;color:#18181b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(it.title) + '</div>' +
            '<div style="margin-top:3px;font-size:11.5px;color:#71717a">' + meta.join(' · ') + '</div>' +
            '<a href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener" ' +
              'style="display:inline-block;margin-top:5px;font-size:12px;color:#0369a1;text-decoration:none;font-weight:600">打开 ↗</a>' +
          '</div>' +
        '</div>';
    }
    return out;
  }

  function openHistoryPanel(conversationId, errorMsg) {
    // 同会话再次点击 = 收起（toggle）
    var existing = document.getElementById(HISTORY_PANEL_ID);
    if (existing) {
      if (existing.dataset.cid === String(conversationId || '')) { existing.remove(); return; }
      existing.remove();
    }
    closeConversationTextModal();

    var overlay = document.createElement('div');
    overlay.id = HISTORY_PANEL_ID;
    overlay.dataset.cid = String(conversationId || '');
    overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:min(480px,92vw);z-index:100001;' +
      'background:#fff;box-shadow:-10px 0 34px rgba(0,0,0,.18);display:flex;flex-direction:column;' +
      'font-family:inherit;color:#18181b;';

    overlay.innerHTML =
      '<div style="padding:13px 16px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f0f0f1">' +
        '<div style="font-size:15px;font-weight:700;color:#111">历史记录</div>' +
        '<button data-hist-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1;padding:2px 6px">×</button>' +
      '</div>' +
      '<div data-hist-tabs style="display:flex;gap:6px;padding:10px 16px 0"></div>' +
      '<div data-hist-body style="padding:12px 16px 8px;overflow:auto;flex:1"></div>' +
      '<div style="padding:9px 16px 13px;display:flex;align-items:center;justify-content:flex-end;font-size:11px;color:#a1a1aa;border-top:1px solid #f4f4f5">' +
        '<a data-hist-full href="#" style="color:#7c3aed;text-decoration:none;font-weight:600">在完整对话页打开 ↗</a>' +
      '</div>';
    document.body.appendChild(overlay);

    var tabsEl = overlay.querySelector('[data-hist-tabs]');
    var bodyEl = overlay.querySelector('[data-hist-body]');
    var closeBtn = overlay.querySelector('[data-hist-close]');
    var fullLink = overlay.querySelector('[data-hist-full]');

    var cached = null;
    var activeTab = 'keyword';
    var hasError = false;

    function makeTab(key, label) {
      var b = document.createElement('button');
      b.dataset.tab = key;
      b.textContent = label;
      b.style.cssText = 'flex:1;height:32px;border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:600;border:1px solid ' +
        (activeTab === key ? '#7c3aed' : '#e4e4e7') + ';background:' + (activeTab === key ? '#7c3aed' : '#fff') + ';color:' +
        (activeTab === key ? '#fff' : '#52525b');
      b.addEventListener('click', function () {
        if (activeTab === key) return;
        activeTab = key;
        renderTabs();
        renderBody();
      });
      return b;
    }
    function renderTabs() {
      tabsEl.innerHTML = '';
      tabsEl.appendChild(makeTab('keyword', '关键词'));
      tabsEl.appendChild(makeTab('attachment', '附件'));
    }

    function renderBody() {
      if (hasError) return; // 错误态已由 fetch 分支写入
      if (!cached) {
        bodyEl.innerHTML = '<div style="padding:28px 4px;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>';
        return;
      }
      if (activeTab === 'keyword') {
        var wrap = document.createElement('div');
        wrap.innerHTML =
          '<input data-hist-kw type="text" placeholder="输入关键词过滤消息（正文 + 附件标题）…" ' +
          'style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #e4e4e7;border-radius:6px;font-size:12.5px;color:#18181b;outline:none;background:#fafafa;margin-bottom:10px" />' +
          '<div data-hist-kw-body></div>';
        bodyEl.innerHTML = '';
        bodyEl.appendChild(wrap);
        var input = wrap.querySelector('[data-hist-kw]');
        var kwBody = wrap.querySelector('[data-hist-kw-body]');
        function applyKw() { kwBody.innerHTML = renderHistoryKeywordHtml(cached, input.value); }
        input.addEventListener('input', applyKw);
        applyKw();
      } else {
        bodyEl.innerHTML = renderHistoryAttachmentHtml(flattenHistoryAttachments(cached));
      }
    }

    closeBtn.addEventListener('click', closeHistoryPanel);
    overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeHistoryPanel(); });
    fullLink.addEventListener('click', function (e) {
      e.preventDefault();
      closeHistoryPanel();
      showView('history', conversationId || '');
    });

    renderTabs();

    if (errorMsg) {
      hasError = true;
      bodyEl.innerHTML = '<div style="padding:28px 4px;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(errorMsg) + '</div>';
      return;
    }
    if (!conversationId) {
      hasError = true;
      bodyEl.innerHTML = '<div style="padding:28px 4px;text-align:center;color:#e1262b;font-size:12.5px">缺少会话 ID，无法加载历史记录</div>';
      return;
    }

    renderBody(); // 先显示「加载中…」占位
    window.fetch('/conv-api/conversations/' + encodeURIComponent(conversationId) + '/messages?_=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    }).then(function (response) {
      return response.json().catch(function () { return []; }).then(function (data) {
        if (!response.ok) throw new Error((data && (data.error || data.detail)) || '加载历史记录失败');
        return data;
      });
    }).then(function (items) {
      cached = Array.isArray(items) ? items : [];
      if (!hasError) renderBody();
    }).catch(function (error) {
      hasError = true;
      bodyEl.innerHTML = '<div style="padding:28px 4px;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }

  // 暴露给对话工作台（chat-ui iframe）：iframe 内直接调用 window.parent.openHistoryPanel(cid)
  // 即可复用同一右侧「历史记录」面板（关键词 + 附件），无需在 React 侧重复实现。
  // 注意：openHistoryPanel 仅操作 document.body 下的自建 fixed 节点，不触碰 React 托管 DOM，
  // 符合注入层 React 协调器铁律，故从 iframe 触发也安全。
  window.openHistoryPanel = openHistoryPanel;

  // 跨文档安全网：chat-ui 亦可 postMessage({ type:'nhd-open-history', conversationId }) 触发，
  // 兼容「iframe 与主页面同源、但父级 openHistoryPanel 尚未就绪」的极端时序（理论上不会发生）。
  if (!window.__NHD_HISTORY_MSG__) {
    window.__NHD_HISTORY_MSG__ = true;
    window.addEventListener('message', function (e) {
      try {
        var d = e.data;
        if (d && d.type === 'nhd-open-history' && d.conversationId) openHistoryPanel(d.conversationId, null);
      } catch (_) {}
    });
  }
