// ===== chat-nav 模块: 70-record-actions — 跟进记录 + 协办人 + 附件 + 成员重置密码 =====
  var FOLLOWUP_BTN_ID = '__followup_entry_btn__';
  var FOLLOWUP_MODAL_ID = '__followup_modal__';

  function opportunityRecordId() {
    var r = parseRoute();
    return (r && r.kind === 'detail' && canonicalObject(r.slug) === 'opportunity') ? r.id : '';
  }

  function closeFollowUpModal() {
    var m = document.getElementById(FOLLOWUP_MODAL_ID);
    if (m) m.remove();
  }

  function formatFollowUpTimeLocal(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var pad = function (n) { return String(n).length < 2 ? '0' + n : String(n); };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) { return ''; }
  }

  function renderFollowUpList(container, items) {
    if (!items.length) {
      container.innerHTML = '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">暂无跟进记录</div>';
      return;
    }
    container.innerHTML = items.map(function (item) {
      return '<div style="padding:11px 0;border-top:1px solid #f0f0f1">' +
        '<div style="font-size:12px;color:#71717a;display:flex;justify-content:space-between;gap:8px">' +
          '<span style="font-weight:600;color:#3f3f46">' + escapeHtml(item.createdByName || '未知') + '</span>' +
          '<span>' + escapeHtml(formatFollowUpTimeLocal(item.createdAt)) + '</span>' +
        '</div>' +
        '<div style="margin-top:4px;font-size:13px;line-height:1.6;color:#18181b;white-space:pre-wrap">' + escapeHtml(item.content || '') + '</div>' +
      '</div>';
    }).join('');
  }

  function openFollowUpModal(opportunityId) {
    closeFollowUpModal();
    var overlay = document.createElement('div');
    overlay.id = FOLLOWUP_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(560px,100%);max-height:min(640px,90vh);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    card.innerHTML =
      '<div style="padding:16px 18px 10px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:15px;font-weight:700;color:#111">跟进记录</div>' +
        '<button data-followup-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1">×</button>' +
      '</div>' +
      '<div data-followup-body style="padding:0 18px 8px;overflow:auto;flex:1">' +
        '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>' +
      '</div>' +
      '<div style="padding:8px 18px 14px;font-size:11px;color:#a1a1aa;border-top:1px solid #f4f4f5">已汇总该线索下所有关联会话的跟进；仅展示你有权限查看的记录（后台管理员可见全部，销售仅见本人所写）。</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFollowUpModal(); });
    card.querySelector('[data-followup-close]').addEventListener('click', closeFollowUpModal);
    document.body.appendChild(overlay);

    window.fetch('/conv-api/follow-ups?subjectType=opportunity&subjectId=' + encodeURIComponent(opportunityId) + '&_=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    }).then(function (response) {
      return response.json().catch(function () { return []; }).then(function (data) {
        if (!response.ok) throw new Error((data && (data.error || data.detail)) || '加载跟进记录失败');
        return data;
      });
    }).then(function (items) {
      var body = card.querySelector('[data-followup-body]');
      if (body) renderFollowUpList(body, Array.isArray(items) ? items : []);
    }).catch(function (error) {
      var body = card.querySelector('[data-followup-body]');
      if (body) body.innerHTML = '<div style="padding:24px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }

  function ensureFollowUpEntry() {
    var oppId = opportunityRecordId();
    var existing = document.getElementById(FOLLOWUP_BTN_ID);
    if (!oppId) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.setAttribute('data-opp-id', oppId);
      return;
    }
    var btn = document.createElement('button');
    btn.id = FOLLOWUP_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('data-opp-id', oppId);
    btn.textContent = '跟进记录';
    btn.style.cssText = [
      'position:fixed', 'right:24px', 'bottom:24px', 'z-index:9998',
      'height:36px', 'padding:0 16px', 'border-radius:18px',
      'border:1px solid #7c3aed', 'background:#7c3aed', 'color:#fff',
      'font-size:12.5px', 'font-weight:700', 'font-family:inherit',
      'cursor:pointer', 'box-shadow:0 6px 18px rgba(124,58,237,.35)',
    ].join(';');
    btn.addEventListener('click', function () {
      openFollowUpModal(btn.getAttribute('data-opp-id'));
    });
    document.body.appendChild(btn);
  }

  // ── 线索/客户联系人/项目 详情页：协办人悬浮入口 + 弹窗 ─────────────────────────
  // 协作人字段 xieBanRenId（单值 RELATION→成员）。仅主负责人(ownerId)或管理员可设置；
  // 协作人可看关联记录的对话、可接管/回复（后端 conversationVisibilityWhere 已纳入）。
  // 后端 GET /api/crm/:objectType/:id/collaborators 返回 collaboratorId + canEdit。
  var COLLAB_BTN_ID = '__collab_entry_btn__';
  var COLLAB_MODAL_ID = '__collab_modal__';

  // 抽屉感知：从右侧抽屉内找「当前记录」的自链接锚点（href=/objects/<type>/<uuid>）。
  // 与钻取按钮同款 findRightDrawer 逻辑；支持 opportunity/person/xiangMu 三类。
  function findCollaboratorRecordFromDrawer() {
    var drawer = findRightDrawer();
    if (!drawer) return null;
    var anchors = drawer.querySelectorAll('a[href*="/object/"], a[href*="/objects/"]');
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href') || '';
      var m = href.match(/\/objects?\/(opportunities|people|_xiangMus)\/([0-9a-fA-F-]{36})/);
      if (!m) continue;
      var objectType = m[1] === 'opportunities' ? 'opportunity' : (m[1] === 'people' ? 'person' : 'xiangMu');
      return { objectType: objectType, id: m[2], via: 'drawer', drawerClass: (drawer.className && drawer.className.toString().slice(0, 80)) || '(none)' };
    }
    return { id: null, debug: { via: 'drawer-no-anchor', drawerClass: (drawer.className && drawer.className.toString().slice(0, 120)) || '(none)' } };
  }

  function collaboratorRecordContext() {
    var r = parseRoute();
    if (r && r.kind === 'detail') {
      var c = canonicalObject(r.slug);
      if (c === 'opportunity' || c === 'person' || c === 'xiangMu') {
        return { objectType: c, id: r.id, via: 'url' };
      }
    }
    // S2：右侧抽屉（URL 不变、无 show-page 锚点）——兼容 Twenty 默认点开记录方式
    var drawerRes = findCollaboratorRecordFromDrawer();
    if (drawerRes && drawerRes.id) return drawerRes;
    return null;
  }

  function closeCollabModal() {
    var m = document.getElementById(COLLAB_MODAL_ID);
    if (m) m.remove();
  }

  function openCollabModal(ctx) {
    closeCollabModal();
    var overlay = document.createElement('div');
    overlay.id = COLLAB_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100003;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(480px,100%);max-height:min(560px,90vh);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    card.innerHTML =
      '<div style="padding:16px 18px 10px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:15px;font-weight:700;color:#111">协办人</div>' +
        '<button data-collab-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1">×</button>' +
      '</div>' +
      '<div data-collab-body style="padding:0 18px 8px;overflow:auto;flex:1">' +
        '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>' +
      '</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeCollabModal(); });
    card.querySelector('[data-collab-close]').addEventListener('click', closeCollabModal);
    document.body.appendChild(overlay);

    var body = card.querySelector('[data-collab-body]');
    Promise.all([
      window.fetch('/conv-api/crm/' + ctx.objectType + '/' + ctx.id + '/collaborators', { credentials: 'same-origin', headers: getTwentyAuthHeaders() }).then(function (r) { return r.json(); }),
      window.fetch('/conv-api/crm/members', { credentials: 'same-origin', headers: getTwentyAuthHeaders() }).then(function (r) { return r.json(); }),
    ]).then(function (results) {
      var collab = results[0] || {};
      var membersResp = results[1] || {};
      if (!collab.ok) throw new Error(collab.error || '加载协办人失败');
      var members = Array.isArray(membersResp.members) ? membersResp.members : [];
      var nameMap = {};
      members.forEach(function (mm) { nameMap[mm.workspaceMemberId] = mm.name; });
      var currentName = collab.collaboratorId ? (nameMap[collab.collaboratorId] || '已设置成员') : '未设置';

      var html = '<div style="padding:14px 0">' +
        '<div style="font-size:12px;color:#71717a">当前协办人</div>' +
        '<div style="margin-top:4px;font-size:14px;font-weight:600;color:#18181b">' + escapeHtml(currentName) + '</div>' +
        '</div>';

      if (collab.canEdit) {
        var opts = '<option value="">— 清除协办人 —</option>' + members.map(function (mm) {
          var sel = mm.workspaceMemberId === collab.collaboratorId ? ' selected' : '';
          return '<option value="' + escapeHtml(mm.workspaceMemberId) + '"' + sel + '>' + escapeHtml(mm.name) + '</option>';
        }).join('');
        html += '<div style="padding:10px 0 4px;border-top:1px solid #f0f0f1">' +
          '<select data-collab-select style="width:100%;height:36px;border:1px solid #d4d4d8;border-radius:6px;padding:0 8px;font-size:13px;background:#fff">' + opts + '</select>' +
          '</div>' +
          '<div style="padding:8px 0 4px;display:flex;gap:8px">' +
            '<button data-collab-save style="flex:1;height:34px;border-radius:6px;border:1px solid #16a34a;background:#16a34a;color:#fff;font-size:13px;font-weight:700;cursor:pointer">保存</button>' +
          '</div>' +
          '<div style="padding:4px 0 10px;font-size:11px;color:#a1a1aa">协办人可查看该记录的对话历史、可接管并回复；仅主负责人或管理员可设置。</div>';
      } else {
        html += '<div style="padding:10px 0 4px;font-size:11px;color:#a1a1aa;border-top:1px solid #f0f0f1">仅主负责人或管理员可设置协办人。</div>';
      }
      body.innerHTML = html;

      if (collab.canEdit) {
        var select = body.querySelector('[data-collab-select]');
        var saveBtn = body.querySelector('[data-collab-save]');
        saveBtn.addEventListener('click', function () {
          var val = select.value || '';
          saveBtn.disabled = true; saveBtn.textContent = '保存中…';
          window.fetch('/conv-api/crm/' + ctx.objectType + '/' + ctx.id + '/collaborators', {
            method: 'PUT', credentials: 'same-origin',
            headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ collaboratorId: val }),
          }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
            .then(function (res) {
              if (!res.ok || !res.data.ok) throw new Error((res.data && (res.data.error || res.data.detail)) || '保存失败');
              openCollabModal(ctx);
            })
            .catch(function (err) {
              saveBtn.disabled = false; saveBtn.textContent = '保存';
              var errEl = document.createElement('div');
              errEl.style.cssText = 'padding:6px 0;color:#e1262b;font-size:12px';
              errEl.textContent = err.message || '保存失败';
              body.appendChild(errEl);
            });
        });
      }
    }).catch(function (error) {
      if (body) body.innerHTML = '<div style="padding:24px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }

  function ensureCollaboratorEntry() {
    var ctx = collaboratorRecordContext();
    var existing = document.getElementById(COLLAB_BTN_ID);
    var dbg = document.getElementById('__collab_dbg__');
    window.__NHD_COLLAB__ = { path: location.pathname, ctx: ctx, note: ctx ? 'button ready' : 'no record context' };
    if (!ctx) {
      if (existing) existing.remove();
      if (dbg) dbg.remove();
      return;
    }
    if (dbg) dbg.remove();
    if (existing) {
      existing.setAttribute('data-ctx', ctx.objectType + ':' + ctx.id);
      return;
    }
    var btn = document.createElement('button');
    btn.id = COLLAB_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('data-ctx', ctx.objectType + ':' + ctx.id);
    btn.textContent = '协办人';
    btn.style.cssText = [
      'position:fixed', 'left:24px', 'bottom:24px', 'z-index:9997',
      'height:36px', 'padding:0 16px', 'border-radius:18px',
      'border:1px solid #0ea5e9', 'background:#0ea5e9', 'color:#fff',
      'font-size:12.5px', 'font-weight:700', 'font-family:inherit',
      'cursor:pointer', 'box-shadow:0 6px 18px rgba(14,165,233,.32)',
    ].join(';');
    btn.addEventListener('click', function () {
      var parts = (btn.getAttribute('data-ctx') || '').split(':');
      if (parts.length === 2) openCollabModal({ objectType: parts[0], id: parts[1] });
    });
    document.body.appendChild(btn);
  }

  // ── 线索详情页：附件汇总悬浮入口 + 弹窗列表 ──────────────────────────────────
  // 把一个线索横跨 WhatsApp/官网/邮件等多个渠道会话里收发过的所有附件按线索汇总，
  // 方便回溯「这个客户前后发过哪些文件」。同「跟进记录」一样是独立悬浮按钮+弹窗，
  // 不侵入 Twenty 原生 DOM；后端 GET /conv-api/attachments 按会话可见性过滤。
  var ATTACH_BTN_ID = '__attach_entry_btn__';
  var ATTACH_MODAL_ID = '__attach_modal__';
  var ATTACH_CHANNEL_LABELS = { whatsapp: 'WhatsApp', website: '官网', email: '邮件', instagram: 'Instagram', facebook: 'Facebook' };

  function closeAttachModal() {
    var m = document.getElementById(ATTACH_MODAL_ID);
    if (m) m.remove();
  }

  function formatAttachSize(bytes) {
    var n = Number(bytes);
    if (!n || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function attachIcon(fileType) {
    var t = String(fileType || '').toLowerCase();
    if (/(png|jpe?g|gif|webp|bmp|svg|heic)/.test(t)) return '🖼️';
    if (/(mp4|mov|avi|mkv|webm)/.test(t)) return '🎬';
    if (/(mp3|wav|ogg|m4a|amr|aac)/.test(t)) return '🎧';
    if (/(pdf)/.test(t)) return '📄';
    if (/(xlsx?|csv)/.test(t)) return '📊';
    if (/(docx?|txt|rtf)/.test(t)) return '📝';
    if (/(zip|rar|7z|gz)/.test(t)) return '🗜️';
    return '📎';
  }

  function renderAttachList(container, items) {
    if (!items.length) {
      container.innerHTML = '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">暂无附件</div>';
      return;
    }
    container.innerHTML = items.map(function (item) {
      var channel = ATTACH_CHANNEL_LABELS[item.channel] || item.channel || '';
      var dirText = item.direction === 'inbound' ? '客户发来' : '我方发出';
      var dirColor = item.direction === 'inbound' ? '#0369a1' : '#7c3aed';
      var size = formatAttachSize(item.sizeBytes);
      return '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener" ' +
        'style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #f0f0f1;text-decoration:none;color:inherit">' +
        '<span style="font-size:20px;flex:none">' + attachIcon(item.fileType) + '</span>' +
        '<span style="flex:1;min-width:0">' +
          '<span style="display:block;font-size:13px;color:#18181b;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(item.title || '附件') + '</span>' +
          '<span style="display:block;margin-top:2px;font-size:11.5px;color:#71717a">' +
            '<span style="color:' + dirColor + '">' + dirText + '</span>' +
            (channel ? ' · ' + escapeHtml(channel) : '') +
            (size ? ' · ' + size : '') +
            ' · ' + escapeHtml(formatFollowUpTimeLocal(item.sentAt)) +
          '</span>' +
          (item.caption ? '<span style="display:block;margin-top:2px;font-size:12px;color:#52525b;white-space:pre-wrap">' + escapeHtml(item.caption) + '</span>' : '') +
        '</span>' +
        '<span style="flex:none;font-size:11px;color:#a1a1aa">打开 ↗</span>' +
      '</a>';
    }).join('');
  }

  function openAttachModal(opportunityId) {
    closeAttachModal();
    var overlay = document.createElement('div');
    overlay.id = ATTACH_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(560px,100%);max-height:min(640px,90vh);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    card.innerHTML =
      '<div style="padding:16px 18px 10px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:15px;font-weight:700;color:#111">附件汇总</div>' +
        '<button data-attach-close style="border:none;background:transparent;cursor:pointer;color:#a1a1aa;font-size:18px;line-height:1">×</button>' +
      '</div>' +
      '<div data-attach-body style="padding:0 18px 8px;overflow:auto;flex:1">' +
        '<div style="padding:24px 0;text-align:center;color:#a1a1aa;font-size:12.5px">加载中…</div>' +
      '</div>' +
      '<div style="padding:8px 18px 14px;font-size:11px;color:#a1a1aa;border-top:1px solid #f4f4f5">已汇总该线索下所有关联会话收发过的附件；仅展示你有权限查看的会话（后台管理员可见全部，销售仅见本人参与/负责的会话）。</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAttachModal(); });
    card.querySelector('[data-attach-close]').addEventListener('click', closeAttachModal);
    document.body.appendChild(overlay);

    window.fetch('/conv-api/attachments?subjectType=opportunity&subjectId=' + encodeURIComponent(opportunityId) + '&_=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    }).then(function (response) {
      return response.json().catch(function () { return []; }).then(function (data) {
        if (!response.ok) throw new Error((data && (data.error || data.detail)) || '加载附件失败');
        return data;
      });
    }).then(function (items) {
      var body = card.querySelector('[data-attach-body]');
      if (body) renderAttachList(body, Array.isArray(items) ? items : []);
    }).catch(function (error) {
      var body = card.querySelector('[data-attach-body]');
      if (body) body.innerHTML = '<div style="padding:24px 0;text-align:center;color:#e1262b;font-size:12.5px">' + escapeHtml(error.message || '加载失败') + '</div>';
    });
  }

  function ensureAttachEntry() {
    var oppId = opportunityRecordId();
    var existing = document.getElementById(ATTACH_BTN_ID);
    if (!oppId) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.setAttribute('data-opp-id', oppId);
      return;
    }
    var btn = document.createElement('button');
    btn.id = ATTACH_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('data-opp-id', oppId);
    btn.textContent = '📎 附件';
    // 叠在「跟进记录」按钮正上方（后者 bottom:24px 高 36px），错开避免重叠。
    btn.style.cssText = [
      'position:fixed', 'right:24px', 'bottom:68px', 'z-index:9998',
      'height:36px', 'padding:0 16px', 'border-radius:18px',
      'border:1px solid #7c3aed', 'background:#fff', 'color:#7c3aed',
      'font-size:12.5px', 'font-weight:700', 'font-family:inherit',
      'cursor:pointer', 'box-shadow:0 6px 18px rgba(124,58,237,.22)',
    ].join(';');
    btn.addEventListener('click', function () {
      openAttachModal(btn.getAttribute('data-opp-id'));
    });
    document.body.appendChild(btn);
  }

  // ── 原生成员信息页：在「删除账户」左边注入「重置密码」按钮 ──────────────────
  // 管理员在 Twenty 原生的成员详情页（设置→成员→某人→信息）即可重置该成员密码，
  // 不必再去单独的权限页。目标成员用页面上显示的邮箱匹配（复用 /rbac/members 拿到
  // memberId 再调现有重置接口），后端无需改动。
  var MEMBER_RESETPWD_BTN_ID = '__member_resetpwd_btn__';
  var EMAIL_RE_INJECT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

  function findNativeDeleteAccountButton() {
    var LABELS = ['删除账户', '删除账号', 'Delete account', 'Delete Account', 'Delete account permanently'];
    function norm(s) { return String(s || '').replace(/\s+/g, ''); }
    var wanted = LABELS.map(norm);
    // 1) 直接可点元素（Twenty 的按钮可能是 button / role=button / a）
    var clickable = document.querySelectorAll('button, [role="button"], a');
    for (var i = 0; i < clickable.length; i++) {
      if (wanted.indexOf(norm(clickable[i].textContent)) !== -1) return clickable[i];
    }
    // 2) 兜底：叶子节点自身文本命中「删除账户」，向上爬到第一个可点祖先
    //    （Twenty 的按钮是 styled div，不一定是 button/role/a，用 cursor:pointer 识别）
    var all = document.querySelectorAll('span, div, p, a');
    for (var k = 0; k < all.length; k++) {
      var el = all[k];
      if (el.children.length) continue; // 只看叶子，避免命中大容器
      if (wanted.indexOf(norm(el.textContent)) === -1) continue;
      var node = el;
      for (var up = 0; up < 6 && node; up++) {
        if (node.matches && node.matches('button, [role="button"], a')) return node;
        try { if (window.getComputedStyle(node).cursor === 'pointer') return node; } catch (e) {}
        node = node.parentElement;
      }
      return el.parentElement || el;
    }
    return null;
  }

  function findMemberEmailOnPage() {
    // 优先取原生表单里的邮箱输入框值
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var v = String(inputs[i].value || '').trim();
      if (EMAIL_RE_INJECT.test(v)) return (v.match(EMAIL_RE_INJECT) || [''])[0];
    }
    // 兜底：正文里第一个邮箱
    var m = (document.body.textContent || '').match(EMAIL_RE_INJECT);
    return m ? m[0] : '';
  }

  function findAdminButtonRow(delBtn) {
    if (!delBtn) return null;
    var node = delBtn.parentElement;
    for (var up = 0; up < 6 && node; up++) {
      var text = String(node.textContent || '');
      var buttons = node.querySelectorAll ? node.querySelectorAll('button, [role="button"], a') : [];
      var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      if (
        rect &&
        rect.width > 80 &&
        rect.height > 20 &&
        rect.height < 80 &&
        buttons.length >= 2 &&
        (text.indexOf('删除账户') !== -1 || text.indexOf('删除账号') !== -1 || text.indexOf('Delete account') !== -1) &&
        (text.indexOf('假装') !== -1 || text.indexOf('Impersonate') !== -1)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function openResetPwdByEmail(email) {
    if (!email) { window.alert('未能从页面识别该成员邮箱，无法重置'); return; }
    window.fetch('/conv-api/rbac/members', { method: 'GET', credentials: 'same-origin', headers: getTwentyAuthHeaders() })
      .then(function (r) { return readChannelApiResponse(r, '加载成员失败'); })
      .then(function (data) {
        var list = (data && data.members) || [];
        var member = list.find(function (m) { return String(m.email || '').toLowerCase() === email.toLowerCase(); });
        if (!member) throw new Error('未找到邮箱为 ' + email + ' 的成员');
        // 复用权限页那套重置密码弹窗；root 传 document.body 以承载成功提示
        openResetPwdModal(document.body, { memberId: member.memberId, name: member.name, email: member.email });
      })
      .catch(function (error) { window.alert(error.message || '重置密码失败'); });
  }

  function ensureMemberResetPwdButton() {
    var canInjectHere = window.location.pathname.indexOf('/settings/workspace-members') === 0;
    if (!canInjectHere) {
      var stale = document.getElementById(MEMBER_RESETPWD_BTN_ID);
      if (stale) stale.remove();
      return;
    }
    var delBtn = findNativeDeleteAccountButton();
    var existing = document.getElementById(MEMBER_RESETPWD_BTN_ID);
    if (!delBtn) { if (existing) existing.remove(); return; }
    var adminRow = findAdminButtonRow(delBtn);
    if (!adminRow) {
      if (existing) existing.remove();
      return;
    }
    // 已注入且仍在正确容器内则不重复插
    if (existing && adminRow.contains(existing)) return;
    if (existing) existing.remove();
    var btn = document.createElement('button');
    btn.id = MEMBER_RESETPWD_BTN_ID;
    btn.type = 'button';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg><span>重置密码</span>';
    // 固定为 Twenty 默认小按钮尺寸；避免读取到删除按钮内部文本节点后变成很矮的小标签。
    var cs = null;
    try { cs = window.getComputedStyle(delBtn); } catch (e) {}
    var radius = (cs && cs.borderRadius) || '8px';
    btn.style.cssText = [
      'box-sizing:border-box', 'align-self:center',
      'display:inline-flex', 'align-items:center', 'justify-content:center', 'gap:6px',
      'height:32px', 'min-height:32px', 'min-width:96px', 'padding:0 12px', 'border-radius:' + radius,
      'border:1px solid #d97706', 'background:#fff', 'color:#d97706',
      'font-size:13px', 'font-weight:600', 'line-height:30px', 'font-family:inherit', 'cursor:pointer',
    ].join(';');
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      openResetPwdByEmail(findMemberEmailOnPage());
    });
    btn.style.marginRight = '8px';
    adminRow.insertBefore(btn, delBtn);
  }
