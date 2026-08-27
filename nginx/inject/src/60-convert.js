// ===== chat-nav 模块: 60-convert — 线索转客户/转项目按钮 =====
  // ── 线索转客户：线索列表顶部「转客户」按钮（放在 +New opportunity 左侧）──────────
  var CONVERT_BTN_ID = '__lead_convert_top_btn__';
  var CONVERT_PROJECT_BTN_ID = '__lead_convert_project_top_btn__';
  var CONVERT_MODAL_ID = '__lead_convert_modal__';

  function isOpportunityListPage() {
    var r = parseRoute();
    return !!r && r.kind === 'list' && canonicalObject(r.slug) === 'opportunity';
  }

  // 读取当前被勾选的线索行。Twenty 表格行为 [data-selectable-id] 的 div（非 tr），
  // 选中态体现为行内 checkbox 被勾选；同时兼容 aria-selected / data-selected 兜底。
  function getSelectedOpportunities() {
    var picked = [];
    Array.from(document.querySelectorAll('[data-selectable-id]')).forEach(function (row) {
      var id = row.getAttribute('data-selectable-id') || '';
      if (!id) return;
      var cb = row.querySelector('input[type="checkbox"]');
      var selected = (cb && cb.checked) ||
        row.getAttribute('aria-selected') === 'true' ||
        row.getAttribute('data-selected') === 'true';
      if (!selected) return;
      picked.push({ id: id, name: '线索 ' + id.slice(0, 8) });
    });
    return picked;
  }

  function convertToast(type, msg, timeoutMs) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:100003', 'padding:10px 18px', 'border-radius:8px', 'font-size:13px', 'font-weight:500',
      'color:#fff', 'box-shadow:0 6px 24px rgba(0,0,0,.2)', 'max-width:86vw',
      'background:' + (type === 'ok' ? '#1f9d5f' : '#e1262b'),
    ].join(';');
    document.body.appendChild(el);
    window.setTimeout(function () { el.remove(); }, timeoutMs || 3200);
  }

  function convertErrorMessage(status, data) {
    if (!data || typeof data !== 'object') return '请求失败，HTTP ' + status;
    if (data.code === 'PRODUCT_REQUIRED') return String(data.detail || '请先填写「客户需求产品」，再执行。');
    if (data.detail) return String(data.detail);
    if (data.error) return String(data.error);
    if (data.code) return '错误码：' + data.code;
    return '请求失败，HTTP ' + status;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function openConvertResultModal(summary, mode) {
    var failures = summary.failures || [];
    if (!failures.length) return;
    var targetLabel = mode === 'project' ? '项目' : '客户';
    var overlay = document.createElement('div');
    overlay.id = CONVERT_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(560px,100%);max-height:min(620px,90vh);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;display:flex;flex-direction:column;';
    var rows = failures.map(function (item) {
      return '<div style="padding:10px 0;border-top:1px solid #eee">' +
        '<div style="font-size:12.5px;font-weight:700;color:#222">' + escapeHtml(item.name || item.id || '未命名线索') + '</div>' +
        '<div style="margin-top:4px;font-size:12px;line-height:1.55;color:#b42318;white-space:pre-wrap">' + escapeHtml(item.reason || '未知失败原因') + '</div>' +
      '</div>';
    }).join('');
    card.innerHTML =
        '<div style="padding:16px 18px 10px">' +
        '<div style="font-size:15px;font-weight:700;color:#111">部分线索转' + targetLabel + '失败</div>' +
        '<div style="margin-top:8px;font-size:12.5px;line-height:1.6;color:#555">' +
          '成功新建 <b>' + summary.created + '</b> 条，更新 <b>' + summary.updated + '</b> 条，失败 <b>' + failures.length + '</b> 条。请按以下原因修正后重试。' +
        '</div>' +
      '</div>' +
      '<div style="padding:0 18px;overflow:auto;flex:1">' + rows + '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px;border-top:1px solid #eee">' +
        '<button data-act="close" style="padding:7px 14px;border-radius:6px;border:none;background:#1f2937;color:#fff;cursor:pointer;font-size:12px;font-weight:700">知道了</button>' +
      '</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeConvertModal(); });
    card.querySelector('[data-act="close"]').addEventListener('click', closeConvertModal);
    document.body.appendChild(overlay);
  }

  function closeConvertModal() {
    var m = document.getElementById(CONVERT_MODAL_ID);
    if (m) m.remove();
  }

  var OPP_STAGE_LABELS = {
    WEI_CHU_LI_XIANSUO: '未处理线索', XIANSUO: '线索', YOUXIAO_XIANSUO: '有效线索',
    QUE_REN_XUN_PAN: '确认询盘', XUN_PAN_ZHUAN_ZONGBU: '询盘转总部', ZONGBU_FANG_AN_BAO_JIA: '总部方案报价',
    JI_SHU_CHENG_QING: '技术澄清', SHANG_WU_CHENG_QING: '商务澄清', YI_QIAN_DAN_FU_KUAN: '已签单付款', YI_FA_HUO: '已发货',
  };
  function convertStageLabel(v) { return OPP_STAGE_LABELS[v] || (v ? String(v) : '—'); }

  // 转客户命中疑似重复客户时的弹窗：展示疑似客户 + 其名下线索/项目，让用户判断。
  // 返回 Promise，resolve 为 { mode:'assign', personId } / { mode:'create' } / { mode:'cancel' }。
  function openDuplicateModal(item, duplicates) {
    return new Promise(function (resolve) {
      var DUP_ID = '__lead_convert_dup_modal__';
      var old = document.getElementById(DUP_ID);
      if (old) old.remove();
      var overlay = document.createElement('div');
      overlay.id = DUP_ID;
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100004;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px;';
      var card = document.createElement('div');
      card.style.cssText = 'width:min(560px,100%);max-height:86vh;display:flex;flex-direction:column;border-radius:12px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden;font-family:inherit;';

      var list = (duplicates || []).map(function (d) {
        var leads = d.leads || [];
        var projects = d.projects || [];
        var leadsHtml = leads.length
          ? leads.slice(0, 5).map(function (l) { return '<div style="color:#555">· 线索 ' + escapeHtml(l.name || l.leadNo || '') + ' <span style="color:#999">(' + escapeHtml(convertStageLabel(l.stage)) + ')</span></div>'; }).join('')
          : '<div style="color:#bbb">· 暂无线索</div>';
        var projHtml = projects.length
          ? projects.slice(0, 5).map(function (p) { return '<div style="color:#555">· 项目 ' + escapeHtml(p.name || '') + ' <span style="color:#999">(' + escapeHtml(p.stage || '—') + ')</span></div>'; }).join('')
          : '<div style="color:#bbb">· 暂无项目</div>';
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
            '<div style="min-width:0">' +
              '<div style="font-weight:700;color:#111;font-size:13.5px">' + escapeHtml(d.name || '（未命名客户）') + '</div>' +
              '<div style="font-size:12px;color:#666;margin-top:2px">' +
                (d.email ? ('📧 ' + escapeHtml(d.email)) : '') + (d.email && d.phone ? '　' : '') + (d.phone ? ('📱 ' + escapeHtml(d.phone)) : '') +
                (d.companyName ? ('<br>🏢 ' + escapeHtml(d.companyName)) : '') +
              '</div>' +
              '<div style="font-size:11px;color:#c2410c;margin-top:3px">匹配：' + (d.matchedBy === 'email' ? '邮箱相同' : '手机号相同') + '</div>' +
            '</div>' +
            '<button data-assign="' + escapeHtml(d.id) + '" style="flex:none;padding:7px 12px;border-radius:6px;border:none;background:#1f9d5f;color:#fff;cursor:pointer;font-size:12px;font-weight:700">分配给TA</button>' +
          '</div>' +
          '<div style="margin-top:8px;font-size:11.5px;line-height:1.7">' + leadsHtml + projHtml + '</div>' +
        '</div>';
      }).join('');

      card.innerHTML =
        '<div style="padding:16px 18px 10px;border-bottom:1px solid #eee">' +
          '<div style="font-size:15px;font-weight:700;color:#111">发现疑似重复客户</div>' +
          '<div style="margin-top:6px;font-size:12.5px;line-height:1.6;color:#555">线索「' + escapeHtml(item.name) + '」的邮箱/手机号已存在于以下客户。可把本线索<b>分配给已有客户</b>，或<b>仍然新建</b>一个客户。</div>' +
        '</div>' +
        '<div style="padding:14px 18px;overflow:auto;flex:1">' + (list || '<div style="color:#999">（无）</div>') + '</div>' +
        '<div style="display:flex;justify-content:space-between;gap:8px;padding:12px 18px 16px;border-top:1px solid #eee">' +
          '<button data-act="cancel" style="padding:7px 14px;border-radius:6px;border:1px solid #ddd;background:#fff;color:#555;cursor:pointer;font-size:12px;font-weight:600">取消本条</button>' +
          '<button data-act="create" style="padding:7px 14px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;font-weight:700">仍然新建客户</button>' +
        '</div>';

      function done(choice) { overlay.remove(); resolve(choice); }
      overlay.appendChild(card);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done({ mode: 'cancel' }); });
      card.querySelector('[data-act="cancel"]').addEventListener('click', function () { done({ mode: 'cancel' }); });
      card.querySelector('[data-act="create"]').addEventListener('click', function () { done({ mode: 'create' }); });
      Array.from(card.querySelectorAll('[data-assign]')).forEach(function (btn) {
        btn.addEventListener('click', function () { done({ mode: 'assign', personId: btn.getAttribute('data-assign') }); });
      });
      document.body.appendChild(overlay);
    });
  }

  function runConvert(items, mode, onProgress) {
    var created = 0, updated = 0, personIds = [], projectIds = [], failures = [];
    var endpoint = mode === 'project' ? 'convert-to-project' : 'convert-to-person';

    function convertOne(item, extra) {
      return window.fetch('/conv-api/opportunities/' + encodeURIComponent(item.id) + '/' + endpoint, {
        method: 'POST',
        headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'same-origin',
        body: extra ? JSON.stringify(extra) : undefined,
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { status: r.status, ok: r.ok, data: data }; });
      });
    }
    function applyResult(item, res) {
      if (!res.ok) { failures.push({ id: item.id, name: item.name, reason: convertErrorMessage(res.status, res.data) }); return; }
      var data = res.data || {};
      if (data.personId) personIds.push(data.personId);
      if (data.projectId) projectIds.push(data.projectId);
      if (data.created) created++; else updated++;
    }

    var chain = Promise.resolve();
    items.forEach(function (item, idx) {
      chain = chain.then(function () {
        onProgress(idx + 1, items.length);
        return convertOne(item).then(function (res) {
          // 转客户命中疑似重复 → 弹窗让用户选分配/新建，再带 mode 重发。
          if (res.status === 409 && res.data && res.data.code === 'DUPLICATE_CUSTOMER') {
            return openDuplicateModal(item, res.data.duplicates).then(function (choice) {
              if (!choice || choice.mode === 'cancel') {
                failures.push({ id: item.id, name: item.name, reason: '已取消（发现疑似重复客户）' });
                return;
              }
              return convertOne(item, { mode: choice.mode, personId: choice.personId }).then(function (res2) { applyResult(item, res2); });
            });
          }
          applyResult(item, res);
        }).catch(function (error) {
          failures.push({ id: item.id, name: item.name, reason: error.message || '网络请求失败' });
        });
      });
    });
    return chain.then(function () { return { created: created, updated: updated, failed: failures.length, failures: failures, personIds: personIds, projectIds: projectIds }; });
  }

  function openConvertModal(items, mode) {
    closeConvertModal();
    var targetLabel = mode === 'project' ? '项目' : '客户';
    var targetObject = mode === 'project' ? '项目' : '客户(People)';
    var actionText = mode === 'project' ? '确认转项目' : '确认转客户';
    var noteText = mode === 'project'
      ? '系统会自动补齐客户关联与关联编码。'
      : '系统会按字段映射写入并生成关联编码。';
    var overlay = document.createElement('div');
    overlay.id = CONVERT_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;';

    var card = document.createElement('div');
    card.style.cssText = 'width:min(420px,100%);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font-family:inherit;';

    var preview = items.slice(0, 5).map(function (it) { return '· ' + escapeHtml(it.name); }).join('<br>');
    var more = items.length > 5 ? '<br>… 等共 ' + items.length + ' 条' : '';
    card.innerHTML =
      '<div style="padding:16px 18px 10px">' +
        '<div style="font-size:15px;font-weight:700;color:#111">确认转为' + targetLabel + '？</div>' +
        '<div style="margin-top:8px;font-size:12.5px;line-height:1.6;color:#555">' +
          '选中的 <b>' + items.length + '</b> 条线索将同步/关联到' + targetObject + '。' + noteText +
          '<div style="margin-top:8px;color:#777">' + preview + more + '</div>' +
          '<div style="margin-top:8px;color:#a15c00">要求线索已填写「客户需求产品」，未填写的会被跳过并提示。</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px;border-top:1px solid #eee">' +
        '<button data-act="cancel" style="padding:7px 14px;border-radius:6px;border:1px solid #ddd;background:#fff;color:#555;cursor:pointer;font-size:12px;font-weight:600">取消</button>' +
        '<button data-act="ok" style="padding:7px 14px;border-radius:6px;border:none;background:#1f9d5f;color:#fff;cursor:pointer;font-size:12px;font-weight:700">' + actionText + '</button>' +
      '</div>';

    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeConvertModal(); });
    card.querySelector('[data-act="cancel"]').addEventListener('click', closeConvertModal);
    var okBtn = card.querySelector('[data-act="ok"]');
    okBtn.addEventListener('click', function () {
      okBtn.disabled = true;
      okBtn.textContent = '处理中…';
      runConvert(items, mode, function (done, total) { okBtn.textContent = '处理中… ' + done + '/' + total; })
        .then(function (sum) {
          closeConvertModal();
          var parts = [];
          if (sum.created) parts.push('新建 ' + sum.created);
          if (sum.updated) parts.push('更新 ' + sum.updated);
          if (sum.failed) parts.push('失败/跳过 ' + sum.failed);
          if (sum.failed) {
            openConvertResultModal(sum, mode);
          } else {
            convertToast('ok', '转' + targetLabel + '完成：' + (parts.join('，') || '无变化'), 3200);
          }
          // 转成功后跳到目标列表。Twenty 记录详情无法整页深链(会 404，正常记录亦然)，
          // 故跳列表；刚转的记录 updatedAt 最新、默认排在靠前，销售一眼可见。
          if (!sum.failed) {
            if (mode === 'project' && (sum.projectIds || []).length > 0) {
              window.setTimeout(function () { window.location.href = '/objects/xiangMus'; }, 700);
            } else if ((sum.personIds || []).length > 0) {
              window.setTimeout(function () { window.location.href = '/objects/people'; }, 700);
            }
          }
        });
    });
    document.body.appendChild(overlay);
  }

  // 优先锚定顶部可见的「New Opportunity」按钮，让「转客户」与新建按钮并排。
  // 部分 Twenty 版本/屏幕宽度会隐藏该按钮，此时再回退到第二行的「过滤」按钮。
  function findToolbarAnchor() {
    var cands = document.querySelectorAll('button, [role="button"]');
    var newButtons = [];
    for (var i = 0; i < cands.length; i++) {
      var newBtn = cands[i];
      if (newBtn.id === CONVERT_BTN_ID || newBtn.getAttribute('data-lead-convert-top') === '1') continue;
      var newText = (newBtn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^(\+\s*)?New Opportunity$/i.test(newText)) continue;
      var newRect = newBtn.getBoundingClientRect();
      if (newRect.top >= 0 &&
          newRect.bottom <= window.innerHeight &&
          newRect.width > 0 &&
          newRect.height > 0) {
        newButtons.push(newBtn);
      }
    }
    if (newButtons.length > 0) {
      newButtons.sort(function (a, b) {
        var ar = a.getBoundingClientRect();
        var br = b.getBoundingClientRect();
        return ar.top - br.top || br.right - ar.right;
      });
      return newButtons[0];
    }

    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (el.id === CONVERT_BTN_ID || el.getAttribute('data-lead-convert-top') === '1') continue;
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t !== '过滤' && t !== '筛选' && !/^Filter$/i.test(t)) continue;
      var r = el.getBoundingClientRect();
      if (r.top > 0 && r.top < 120 && r.width > 0) return el;
    }
    return null;
  }

  function ensureConvertTopButton() {
    if (!isOpportunityListPage() || isChatVisible()) {
      var stale = document.getElementById(CONVERT_BTN_ID);
      if (stale) stale.remove();
      var staleProject = document.getElementById(CONVERT_PROJECT_BTN_ID);
      if (staleProject) staleProject.remove();
      return;
    }
    var anchor = findToolbarAnchor();
    if (!anchor || !anchor.parentElement) return;

    var existing = document.getElementById(CONVERT_BTN_ID);
    var h = Math.round(anchor.getBoundingClientRect().height) || 26;
    function makeButton(id, text, mode, color, marginRight) {
      var btn = document.createElement('button');
      btn.id = id;
      btn.type = 'button';
      btn.setAttribute('data-lead-convert-top', '1');
      btn.textContent = text;
      btn.style.cssText = [
      'display:inline-flex', 'align-items:center', 'justify-content:center',
      'height:' + h + 'px', 'margin-right:' + marginRight + 'px', 'padding:0 12px', 'flex-shrink:0',
      'border-radius:6px', 'border:1px solid ' + color, 'background:' + color, 'color:#fff',
      'font-size:12px', 'font-weight:600', 'font-family:inherit',
      'cursor:pointer', 'white-space:nowrap',
      ].join(';');
      btn.addEventListener('click', function () {
        var sel = getSelectedOpportunities();
        if (sel.length === 0) { convertToast('error', '请先勾选要转' + (mode === 'project' ? '项目' : '客户') + '的线索'); return; }
        openConvertModal(sel, mode);
      });
      return btn;
    }
    var projectBtn = document.getElementById(CONVERT_PROJECT_BTN_ID);
    if (!existing) existing = makeButton(CONVERT_BTN_ID, '转客户', 'person', '#1f9d5f', 8);
    if (!projectBtn) projectBtn = makeButton(CONVERT_PROJECT_BTN_ID, '转项目', 'project', '#2563eb', 8);

    var host = document.getElementById('__lead_convert_action_host__');
    if (!host || host.parentElement !== anchor.parentElement) {
      if (host) host.remove();
      host = document.createElement('span');
      host.id = '__lead_convert_action_host__';
      host.setAttribute('data-lead-convert-host', '1');
      host.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:8px;flex-shrink:0;';
      anchor.parentElement.appendChild(host);
    }
    if (existing.parentElement !== host) host.appendChild(existing);
    if (projectBtn.parentElement !== host) host.appendChild(projectBtn);
  }

  // ── 线索详情页：跟进记录悬浮入口 + 弹窗列表 ──────────────────────────────────
  // 汇总该线索下所有关联会话的跟进（不止直接挂在线索上的），按当前登录人权限过滤——
  // 由后端 GET /conv-api/follow-ups?subjectType=opportunity 保证：admin/boss 看全部，
  // 销售仅见自己所写。不侵入 Twenty 原生字段的 DOM（结构会随 Twenty 升级变化），
  // 用独立悬浮按钮+弹窗展示，跟本文件里「转客户」按钮、官网归类弹窗是同一套模式。
