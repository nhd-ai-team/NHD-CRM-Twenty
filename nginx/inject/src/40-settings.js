// ===== chat-nav 模块: 40-settings — 渠道/WhatsApp 绑定页 + 权限(RBAC)设置页 + 账户设置卡片 =====
  function statusLabel(status) {
    if (status === 'WORKING') return '已连接';
    if (status === 'SCAN_QR_CODE') return '等待扫码';
    if (status === 'STARTING') return '启动中';
    if (status === 'STOPPED') return '未启动';
    if (status === 'FAILED') return '连接失败';
    return status || '未知';
  }

  function formatNow() {
    var now = new Date();
    var pad = function (value) { return String(value).padStart(2, '0'); };
    return pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  }

  function setWaButtonBusy(root, selector, busyText, isBusy) {
    var button = root.querySelector(selector);
    if (!button) return;
    if (isBusy) {
      button.setAttribute('data-original-text', button.textContent || '');
      button.textContent = busyText;
      button.disabled = true;
      button.style.opacity = '0.65';
      button.style.cursor = 'wait';
      return;
    }
    button.textContent = button.getAttribute('data-original-text') || button.textContent;
    button.disabled = button.getAttribute('data-connected-disabled') === '1';
    button.style.opacity = button.disabled ? '0.5' : '';
    button.style.cursor = button.disabled ? 'not-allowed' : 'pointer';
  }

  function readChannelApiResponse(response, fallbackMessage) {
    return response.text().then(function (body) {
      var data = null;
      try {
        data = body ? JSON.parse(body) : {};
      } catch (_error) {
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          throw new Error('渠道服务暂时不可用，请稍后重试。');
        }
        throw new Error('渠道接口返回异常，请刷新页面后重试。');
      }
      if (!response.ok) {
        throw new Error(data && (data.error || data.detail) || fallbackMessage);
      }
      return data;
    }).catch(function (error) {
      if (error instanceof TypeError) {
        throw new Error('无法连接渠道服务，请检查网络后重试。');
      }
      throw error;
    });
  }

  function clearRenderedWhatsAppStatus(root) {
    var status = root.querySelector('[data-wa-status]');
    var binding = root.querySelector('[data-wa-binding]');
    if (status) { status.textContent = '状态未知'; status.style.background = '#f4f4f5'; status.style.color = '#52525b'; }
    ['[data-wa-phone]', '[data-wa-name]', '[data-wa-account-id]'].forEach(function (selector) {
      var field = root.querySelector(selector);
      if (field) field.textContent = '-';
    });
    if (binding) binding.textContent = '暂无法确认，请点击刷新状态';
    var qrBox = root.querySelector('[data-wa-qr-box]');
    if (qrBox) qrBox.style.display = 'none';
  }

  function renderWhatsAppStatus(root, state) {
    var connected = state && state.connected;
    var binding = state && state.binding || {};
    var boundToCurrentUser = !!binding.boundToCurrentUser;
    var boundByOther = !!binding.boundByOther;
    var recoverableQr = state && ['FAILED', 'STOPPED', 'STARTING'].indexOf(state.status) !== -1;
    var waitingQr = state && (state.qrAvailable || recoverableQr);
    root.querySelector('[data-wa-status]').textContent = state ? statusLabel(state.status) : '加载中';
    root.querySelector('[data-wa-status]').style.background = connected ? '#dcfce7' : waitingQr ? '#fef3c7' : '#f4f4f5';
    root.querySelector('[data-wa-status]').style.color = connected ? '#166534' : waitingQr ? '#92400e' : '#52525b';
    root.querySelector('[data-wa-phone]').textContent = state ? (state.phone || '-') : '-';
    root.querySelector('[data-wa-name]').textContent = state ? (state.displayName || '-') : '-';
    root.querySelector('[data-wa-account-id]').textContent = state ? (state.accountId || '-') : '-';
    root.querySelector('[data-wa-binding]').textContent = boundToCurrentUser
      ? (connected ? '已绑定并在线' : '已关联到当前账号，等待扫码授权')
      : boundByOther
        ? '已被其他用户绑定：' + (binding.ownerName || '其他 CRM 用户')
        : connected
          ? '已连接，未绑定到 CRM 账号'
          : '未绑定';
    root.querySelector('[data-wa-updated]').textContent = '最后刷新 ' + formatNow();
    var startButton = root.querySelector('[data-wa-start]');
    if (startButton) {
      var startDisabled = connected || boundByOther;
      startButton.setAttribute('data-connected-disabled', startDisabled ? '1' : '0');
      startButton.disabled = startDisabled;
      startButton.style.opacity = startDisabled ? '0.5' : '';
      startButton.style.cursor = startDisabled ? 'not-allowed' : 'pointer';
      startButton.title = boundByOther ? '该 WhatsApp 已绑定到其他用户' : connected ? '已连接时不需要重新生成二维码' : '重启 WhatsApp 会话并生成新的二维码';
    }
    var codeButton = root.querySelector('[data-wa-code]');
    var phoneInput = root.querySelector('[data-wa-phone-input]');
    if (codeButton) {
      var codeDisabled = connected || boundByOther;
      codeButton.setAttribute('data-connected-disabled', codeDisabled ? '1' : '0');
      codeButton.disabled = codeDisabled;
      codeButton.style.opacity = codeDisabled ? '0.5' : '';
      codeButton.style.cursor = codeDisabled ? 'not-allowed' : 'pointer';
      codeButton.title = boundByOther ? '该 WhatsApp 已绑定到其他用户' : connected ? '已连接时不需要生成配对码' : '生成 WhatsApp 手机号配对码';
    }
    if (phoneInput) phoneInput.disabled = connected || boundByOther;
    var bindButton = root.querySelector('[data-wa-bind]');
    if (bindButton) {
      bindButton.disabled = !connected || boundToCurrentUser || boundByOther;
      bindButton.setAttribute('data-connected-disabled', bindButton.disabled ? '1' : '0');
      bindButton.style.opacity = bindButton.disabled ? '0.5' : '';
      bindButton.style.cursor = bindButton.disabled ? 'not-allowed' : 'pointer';
    }
    var unbindButton = root.querySelector('[data-wa-unbind]');
    if (unbindButton) {
      unbindButton.disabled = !boundToCurrentUser;
      unbindButton.setAttribute('data-connected-disabled', unbindButton.disabled ? '1' : '0');
      unbindButton.style.opacity = unbindButton.disabled ? '0.5' : '';
      unbindButton.style.cursor = unbindButton.disabled ? 'not-allowed' : 'pointer';
    }
    root.querySelector('[data-wa-help]').textContent = connected
      ? boundToCurrentUser
        ? '该 WhatsApp 已绑定到你的 CRM 账号，可在对话工作台收发消息。'
        : boundByOther
          ? '该 WhatsApp 已绑定到其他 CRM 用户，当前账号不能使用。'
          : '该 WhatsApp 已连接，但还未绑定到 CRM 账号。请点击“绑定到我的账号”。'
      : waitingQr
        ? (boundToCurrentUser
          ? '当前 CRM 账号已关联该 WhatsApp 会话，但还没有完成手机扫码授权。请用 WhatsApp 手机端扫描二维码，成功后才可收发消息。'
          : (state.status === 'FAILED' ? '当前会话异常，系统会自动重新生成二维码。请稍等几秒后扫码。' : '请用 WhatsApp 手机端扫描下方二维码，完成后页面会自动刷新状态。'))
        : '如未显示二维码，请点击“启动/刷新二维码”。';
    var qrBox = root.querySelector('[data-wa-qr-box]');
    qrBox.style.display = waitingQr ? 'block' : 'none';
    if (waitingQr) {
      loadWhatsAppQr(root);
    }
  }

  function loadWhatsAppQr(root) {
    var qr = root.querySelector('[data-wa-qr]');
    if (!qr) return;
    window.fetch('/conv-api/channel-accounts/whatsapp/qr?t=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    })
      .then(function (response) {
        if (!response.ok) return readChannelApiResponse(response, '二维码生成失败');
        return response.blob();
      })
      .then(function (blob) {
        if (!blob || !blob.type) return;
        if (qr.dataset.objectUrl) window.URL.revokeObjectURL(qr.dataset.objectUrl);
        var url = window.URL.createObjectURL(blob);
        qr.dataset.objectUrl = url;
        qr.src = url;
        root.querySelector('[data-wa-error]').textContent = '';
      })
      .catch(function (error) {
        root.querySelector('[data-wa-error]').textContent = error.message || '二维码生成中，请稍后刷新状态';
      });
  }

  function loadWhatsAppStatus(root) {
    root.querySelector('[data-wa-error]').textContent = '';
    return window.fetch('/conv-api/channel-accounts/whatsapp/status', { credentials: 'same-origin', cache: 'no-store', headers: getTwentyAuthHeaders() })
      .then(function (response) { return readChannelApiResponse(response, '状态加载失败'); })
      .then(function (data) { renderWhatsAppStatus(root, data); })
      .catch(function (error) {
        clearRenderedWhatsAppStatus(root);
        root.querySelector('[data-wa-error]').textContent = error.message || '状态加载失败';
      });
  }

  function renderChannelsSettingsPage() {
    if (!isChannelsSettingsPage()) {
      removeChannelsSettingsPage();
      return;
    }
    var existing = document.getElementById(CHANNELS_SETTINGS_PAGE_ID);
    if (existing) {
      existing.style.left = settingsDrawerRight() + 'px';
      return;
    }
    var root = document.createElement('div');
    root.id = CHANNELS_SETTINGS_PAGE_ID;
    root.style.cssText = [
      'position:fixed',
      'top:0',
      'right:0',
      'bottom:0',
      'left:' + settingsDrawerRight() + 'px',
      'z-index:90',
      'background:var(--twenty-background-primary,#fff)',
      'overflow:auto',
      'padding:32px 40px',
      'box-sizing:border-box',
      'font-family:inherit',
      'color:var(--twenty-font-color-primary,#18181b)',
    ].join(';');
    root.innerHTML =
      '<div style="max-width:760px">' +
        '<div style="font-size:13px;color:#71717a;margin-bottom:12px">账户 / 渠道</div>' +
        '<h1 style="font-size:22px;line-height:1.3;margin:0 0 8px;font-weight:700">渠道</h1>' +
        '<p style="font-size:13px;color:#71717a;margin:0 0 24px">绑定当前用户自己的外部沟通渠道。当前先支持 WhatsApp。</p>' +
        '<div style="border:1px solid #e4e4e7;border-radius:8px;background:#fff;overflow:hidden">' +
          '<div style="display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid #f0f0f1">' +
            '<div style="width:38px;height:38px;border-radius:50%;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;font-weight:800">W</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:15px;font-weight:700">WhatsApp</div>' +
              '<div data-wa-help style="font-size:12.5px;color:#71717a;margin-top:2px">正在加载绑定状态...</div>' +
            '</div>' +
            '<span data-wa-status style="font-size:12px;font-weight:700;border-radius:999px;padding:4px 9px;background:#f4f4f5;color:#52525b">加载中</span>' +
          '</div>' +
          '<div style="padding:18px 20px;display:grid;grid-template-columns:150px 1fr;gap:12px;font-size:13px">' +
            '<div style="color:#71717a">绑定号码</div><div data-wa-phone>-</div>' +
            '<div style="color:#71717a">显示名称</div><div data-wa-name>-</div>' +
            '<div style="color:#71717a">WhatsApp ID</div><div data-wa-account-id>-</div>' +
            '<div style="color:#71717a">CRM 绑定</div><div data-wa-binding>-</div>' +
          '</div>' +
          '<div data-wa-qr-box style="display:none;padding:0 20px 18px">' +
            '<div style="display:flex;align-items:center;gap:20px;padding:16px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa;width:max-content;max-width:100%">' +
              '<img data-wa-qr alt="WhatsApp QR" style="width:220px;height:220px;object-fit:contain;background:#fff;border:1px solid #e4e4e7;border-radius:6px" />' +
              '<div style="max-width:260px;font-size:12.5px;color:#71717a;line-height:1.65">打开 WhatsApp 手机端，进入“已关联的设备”，扫描二维码完成绑定。二维码过期后点击刷新。</div>' +
            '</div>' +
          '</div>' +
          '<div data-wa-pair-box style="padding:0 20px 18px">' +
            '<div style="border:1px solid #e4e4e7;border-radius:8px;background:#fff;padding:14px 16px">' +
              '<div style="font-size:13px;font-weight:700;margin-bottom:8px">手机号配对</div>' +
              '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                '<input data-wa-phone-input placeholder="输入带国家区号的号码，如 8613800000000（仅示例）" style="height:32px;width:340px;max-width:100%;border:1px solid #d4d4d8;border-radius:6px;padding:0 10px;font-size:12.5px;box-sizing:border-box" />' +
                '<button data-wa-code style="height:32px;padding:0 12px;border-radius:6px;border:1px solid #16a34a;background:#16a34a;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">生成配对码</button>' +
              '</div>' +
              '<div data-wa-code-result style="display:none;margin-top:12px;padding:12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0">' +
                '<div style="font-size:12px;color:#166534;margin-bottom:6px">在 WhatsApp 手机端：已关联的设备 -> 关联设备 -> 改用手机号关联，然后输入：</div>' +
                '<div data-wa-code-value style="font-size:24px;line-height:1.2;font-weight:800;letter-spacing:1px;color:#14532d"></div>' +
                '<div style="font-size:12px;color:#166534;margin-top:6px">请在生成后 60 秒内输入配对码，超过 60 秒将失效，需重新生成。</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid #f0f0f1">' +
            '<button data-wa-refresh style="height:30px;padding:0 12px;border-radius:6px;border:1px solid #d4d4d8;background:#fff;color:#3f3f46;font-size:12.5px;font-weight:600;cursor:pointer">刷新状态</button>' +
            '<button data-wa-start style="height:30px;padding:0 12px;border-radius:6px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">启动/刷新二维码</button>' +
            '<button data-wa-bind style="height:30px;padding:0 12px;border-radius:6px;border:1px solid #16a34a;background:#16a34a;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">绑定到我的账号</button>' +
            '<button data-wa-unbind style="height:30px;padding:0 12px;border-radius:6px;border:1px solid #dc2626;background:#fff;color:#dc2626;font-size:12.5px;font-weight:700;cursor:pointer">解绑</button>' +
            '<span data-wa-updated style="font-size:12px;color:#71717a"></span>' +
            '<span data-wa-error style="font-size:12px;color:#dc2626"></span>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector('[data-wa-refresh]').addEventListener('click', function () {
      setWaButtonBusy(root, '[data-wa-refresh]', '刷新中...', true);
      loadWhatsAppStatus(root).finally(function () {
        setWaButtonBusy(root, '[data-wa-refresh]', '刷新中...', false);
      });
    });
    root.querySelector('[data-wa-start]').addEventListener('click', function () {
      root.querySelector('[data-wa-error]').textContent = '';
      setWaButtonBusy(root, '[data-wa-start]', '生成中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp/restart', { method: 'POST', credentials: 'same-origin', headers: getTwentyAuthHeaders() })
        .then(function (response) { return readChannelApiResponse(response, '二维码生成失败'); })
        .then(function () { return loadWhatsAppStatus(root); })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '启动失败'; })
        .finally(function () {
          setWaButtonBusy(root, '[data-wa-start]', '生成中...', false);
        });
    });
    root.querySelector('[data-wa-code]').addEventListener('click', function () {
      var phoneInput = root.querySelector('[data-wa-phone-input]');
      var resultBox = root.querySelector('[data-wa-code-result]');
      var codeValue = root.querySelector('[data-wa-code-value]');
      root.querySelector('[data-wa-error]').textContent = '';
      resultBox.style.display = 'none';
      codeValue.textContent = '';
      setWaButtonBusy(root, '[data-wa-code]', '生成中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp/request-code', {
        method: 'POST',
        credentials: 'same-origin',
        headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ phoneNumber: phoneInput.value }),
      })
        .then(function (response) { return readChannelApiResponse(response, '配对码生成失败'); })
        .then(function (data) {
          codeValue.textContent = data.code || '-';
          resultBox.style.display = 'block';
          return loadWhatsAppStatus(root);
        })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '配对码生成失败'; })
        .finally(function () {
          setWaButtonBusy(root, '[data-wa-code]', '生成中...', false);
        });
    });
    root.querySelector('[data-wa-bind]').addEventListener('click', function () {
      root.querySelector('[data-wa-error]').textContent = '';
      setWaButtonBusy(root, '[data-wa-bind]', '绑定中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp/bind', {
        method: 'POST',
        credentials: 'same-origin',
        headers: getTwentyAuthHeaders(),
      })
        .then(function (response) { return readChannelApiResponse(response, '绑定失败'); })
        .then(function () { return loadWhatsAppStatus(root); })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '绑定失败'; })
        .finally(function () {
          setWaButtonBusy(root, '[data-wa-bind]', '绑定中...', false);
        });
    });
    root.querySelector('[data-wa-unbind]').addEventListener('click', function () {
      if (!window.confirm('确认解绑当前 WhatsApp？解绑后该账号将不能继续在 CRM 中收发 WhatsApp，需要重新扫码或配对后再绑定。')) return;
      root.querySelector('[data-wa-error]').textContent = '';
      setWaButtonBusy(root, '[data-wa-unbind]', '解绑中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: getTwentyAuthHeaders(),
      })
        .then(function (response) { return readChannelApiResponse(response, '解绑失败'); })
        .then(function () { return loadWhatsAppStatus(root); })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '解绑失败'; })
        .finally(function () {
          setWaButtonBusy(root, '[data-wa-unbind]', '解绑中...', false);
        });
    });
    loadWhatsAppStatus(root);
    if (!window.__settingsChannelsPoller) {
      window.__settingsChannelsPoller = window.setInterval(function () {
        var page = document.getElementById(CHANNELS_SETTINGS_PAGE_ID);
        if (page && isChannelsSettingsPage() && document.visibilityState === 'visible') loadWhatsAppStatus(page);
      }, 6000);
    }
  }

  // ===== 权限管理（仅管理员） =====
  function loadRbacAdminStatus(cb) {
    if (RBAC_ADMIN !== null) { cb(RBAC_ADMIN); return; }
    window.fetch('/conv-api/rbac/members', { method: 'GET', credentials: 'same-origin', headers: getTwentyAuthHeaders() })
      .then(function (response) {
        RBAC_ADMIN = response.ok; // 200=管理员；403=非管理员
        cb(RBAC_ADMIN);
      })
      .catch(function () { RBAC_ADMIN = false; cb(false); });
  }

  function ensureSettingsAccountsRbacCard() {
    if (window.location.pathname !== '/settings/accounts') {
      var stale = document.getElementById(RBAC_SETTINGS_CARD_ID);
      if (stale) stale.remove();
      return;
    }
    if (document.getElementById(RBAC_SETTINGS_CARD_ID)) return;
    loadRbacAdminStatus(function (isAdmin) {
      if (!isAdmin) return; // 非管理员不显示权限卡片
      var sections = Array.from(document.querySelectorAll('h2, [role="heading"]'));
      var settingsHeading = sections.find(function (el) { var t = (el.textContent || '').trim(); return t === 'Settings' || t === '设置'; });
      if (!settingsHeading) return;
      var section = settingsHeading.closest('section') || settingsHeading.parentElement;
      if (!section) return;
      var cardsHost = Array.from(section.querySelectorAll('div')).find(function (el) {
        var rect = el.getBoundingClientRect();
        return rect.width > 300 && rect.height > 40 && window.getComputedStyle(el).display === 'flex';
      });
      if (!cardsHost) return;
      var card = document.createElement('div');
      card.id = RBAC_SETTINGS_CARD_ID;
      card.style.cssText = 'border:1px solid #e4e4e7;border-radius:8px;padding:16px;min-width:220px;flex:1;cursor:pointer;background:#fff;color:#71717a';
      card.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px;color:#3f3f46;font-weight:600">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>' +
          '<span style="flex:1">权限</span><span style="color:#a1a1aa">›</span>' +
        '</div>' +
        '<div style="padding-left:32px;margin-top:8px;font-size:13px">为成员分配角色：后台管理员 / 销售主管 / 销售。</div>';
      card.addEventListener('click', function () { window.location.href = RBAC_SETTINGS_PATH; });
      cardsHost.appendChild(card);
    });
  }

  function isRbacSettingsPage() {
    return window.location.pathname === RBAC_SETTINGS_PATH;
  }

  function removeRbacSettingsPage() {
    var page = document.getElementById(RBAC_SETTINGS_PAGE_ID);
    if (page) page.remove();
  }

  function renderRbacSettingsPage() {
    if (!isRbacSettingsPage()) {
      removeRbacSettingsPage();
      return;
    }
    var existing = document.getElementById(RBAC_SETTINGS_PAGE_ID);
    if (existing) {
      existing.style.left = settingsDrawerRight() + 'px';
      return;
    }
    var root = document.createElement('div');
    root.id = RBAC_SETTINGS_PAGE_ID;
    root.style.cssText = [
      'position:fixed', 'top:0', 'right:0', 'bottom:0',
      'left:' + settingsDrawerRight() + 'px', 'z-index:90',
      'background:var(--twenty-background-primary,#fff)', 'overflow:auto',
      'padding:32px 40px', 'box-sizing:border-box',
      'font-family:inherit', 'color:var(--twenty-font-color-primary,#18181b)',
    ].join(';');
    root.innerHTML =
      '<div style="max-width:820px">' +
        '<div style="font-size:13px;color:#71717a;margin-bottom:12px">账户 / 权限</div>' +
        '<h1 style="font-size:22px;line-height:1.3;margin:0 0 8px;font-weight:700">权限</h1>' +
        '<p style="font-size:13px;color:#71717a;margin:0 0 24px">为工作区成员分配角色。后台管理员可查看并操作全部会话；销售主管查看团队；销售仅看自己。</p>' +
        '<div data-rbac-loading style="font-size:13px;color:#71717a">正在加载成员与角色…</div>' +
        '<div data-rbac-error style="font-size:13px;color:#dc2626;display:none"></div>' +
        '<div data-rbac-list style="display:none;margin-top:8px"></div>' +
      '</div>';
    document.body.appendChild(root);
    loadRbacData(root);
  }

  function loadRbacData(root, attempt) {
    var listEl = root.querySelector('[data-rbac-list]');
    var loadingEl = root.querySelector('[data-rbac-loading]');
    var errorEl = root.querySelector('[data-rbac-error]');
    // 硬刷直达本页时，Twenty 可能还没把登录令牌写进 storage/cookie，
    // 令牌捕获也尚未拿到。此时先等待重试（最多约 5 秒），避免误报「登录已失效」。
    attempt = attempt || 0;
    if (!getTwentyAccessToken() && attempt < 10) {
      if (loadingEl) { loadingEl.style.display = 'block'; loadingEl.textContent = '正在等待登录状态…'; }
      setTimeout(function () { loadRbacData(root, attempt + 1); }, 500);
      return;
    }
    if (loadingEl) loadingEl.textContent = '正在加载成员与角色…';
    Promise.all([
      window.fetch('/conv-api/rbac/members', { method: 'GET', credentials: 'same-origin', headers: getTwentyAuthHeaders() }).then(function (r) { return readChannelApiResponse(r, '加载失败'); }),
      window.fetch('/conv-api/rbac/role-scopes', { method: 'GET', credentials: 'same-origin', headers: getTwentyAuthHeaders() }).then(function (r) { return readChannelApiResponse(r, '加载失败'); }),
    ]).then(function (results) {
      var members = results[0].members || [];
      var scopes = results[1].roles || [];
      loadingEl.style.display = 'none';
      listEl.style.display = 'block';
      renderRbacRows(root, members, scopes);
    }).catch(function (error) {
      loadingEl.style.display = 'none';
      errorEl.style.display = 'block';
      errorEl.textContent = error.message || '加载失败';
    });
  }

  function renderRbacRows(root, members, scopes) {
    var listEl = root.querySelector('[data-rbac-list]');
    var scopesByRole = {};
    scopes.forEach(function (s) { scopesByRole[s.role] = s; });
    var rows = members.map(function (m) {
      var options = scopes.map(function (s) {
        var selected = s.role === m.role ? ' selected' : '';
        return '<option value="' + escapeHtml(s.role) + '"' + selected + '>' + escapeHtml(roleLabel(s.role)) + '</option>';
      }).join('');
      return '<div style="display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid #f0f0f1;border-radius:8px;margin-bottom:8px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14px;font-weight:600">' + escapeHtml(m.name) + '</div>' +
          '<div style="font-size:12.5px;color:#71717a">' + escapeHtml(m.email || '-') + '</div>' +
          '<div data-rbac-scope style="font-size:12px;color:#52525b;margin-top:2px"></div>' +
        '</div>' +
        '<select data-rbac-role="' + escapeHtml(m.memberId) + '" style="height:32px;border:1px solid #d4d4d8;border-radius:6px;padding:0 8px;font-size:13px;background:#fff">' + options + '</select>' +
        '<button data-rbac-save="' + escapeHtml(m.memberId) + '" style="height:32px;padding:0 14px;border-radius:6px;border:1px solid #16a34a;background:#16a34a;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">保存</button>' +
        '<button data-rbac-reset="' + escapeHtml(m.memberId) + '" style="height:32px;padding:0 10px;border-radius:6px;border:1px solid #d4d4d8;background:#fff;color:#71717a;font-size:12.5px;cursor:pointer">重置</button>' +
        '<button data-rbac-pwd="' + escapeHtml(m.memberId) + '" style="height:32px;padding:0 10px;border-radius:6px;border:1px solid #d97706;background:#fff;color:#b45309;font-size:12.5px;cursor:pointer">重置密码</button>' +
      '</div>';
    }).join('');
    listEl.innerHTML = rows;
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-rbac-role]'), function (sel) {
      var memberId = sel.getAttribute('data-rbac-role');
      var member = members.find(function (m) { return m.memberId === memberId; });
      var scopeEl = sel.parentElement.querySelector('[data-rbac-scope]');
      if (scopeEl && member) scopeEl.textContent = (scopesByRole[member.role] && scopesByRole[member.role].description) || '';
      sel.addEventListener('change', function () {
        if (scopeEl) scopeEl.textContent = (scopesByRole[sel.value] && scopesByRole[sel.value].description) || '';
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-rbac-save]'), function (btn) {
      btn.addEventListener('click', function () {
        var memberId = btn.getAttribute('data-rbac-save');
        var sel = listEl.querySelector('[data-rbac-role="' + memberId + '"]');
        var role = sel && sel.value;
        setRbacButtonBusy(btn, true);
        window.fetch('/conv-api/rbac/roles/' + encodeURIComponent(memberId), {
          method: 'PUT', credentials: 'same-origin',
          headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ role: role }),
        })
          .then(function (response) { return readChannelApiResponse(response, '保存失败'); })
          .then(function () { root.querySelector('[data-rbac-error]').style.display = 'none'; })
          .catch(function (error) {
            var errorEl = root.querySelector('[data-rbac-error]');
            errorEl.style.display = 'block';
            errorEl.style.color = '#e1262b';
            errorEl.textContent = error.message || '保存失败';
          })
          .finally(function () { setRbacButtonBusy(btn, false); });
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-rbac-reset]'), function (btn) {
      btn.addEventListener('click', function () {
        var memberId = btn.getAttribute('data-rbac-reset');
        if (!window.confirm('确认将该成员的角色重置为默认的「销售」？')) return;
        setRbacButtonBusy(btn, true);
        window.fetch('/conv-api/rbac/roles/' + encodeURIComponent(memberId), {
          method: 'DELETE', credentials: 'same-origin', headers: getTwentyAuthHeaders(),
        })
          .then(function (response) { return readChannelApiResponse(response, '重置失败'); })
          .then(function () {
            var sel = listEl.querySelector('[data-rbac-role="' + memberId + '"]');
            if (sel) sel.value = 'sales';
            var scopeEl = sel && sel.parentElement.querySelector('[data-rbac-scope]');
            if (scopeEl) scopeEl.textContent = (scopesByRole['sales'] && scopesByRole['sales'].description) || '';
          })
          .catch(function (error) {
            var errorEl = root.querySelector('[data-rbac-error]');
            errorEl.style.display = 'block';
            errorEl.style.color = '#e1262b';
            errorEl.textContent = error.message || '重置失败';
          })
          .finally(function () { setRbacButtonBusy(btn, false); });
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-rbac-pwd]'), function (btn) {
      btn.addEventListener('click', function () {
        var memberId = btn.getAttribute('data-rbac-pwd');
        var member = members.find(function (m) { return m.memberId === memberId; });
        openResetPwdModal(root, member || { memberId: memberId, name: '', email: '' });
      });
    });
  }

  // 管理员为成员重置登录密码：小弹窗输入新密码 + 二次确认，前端先做 ≥8 位校验，
  // 提交到 POST /conv-api/rbac/members/:id/reset-password（后端 requireAdmin 二次把关）。
  function openResetPwdModal(root, member) {
    var existing = document.getElementById('__rbac_pwd_modal__');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = '__rbac_pwd_modal__';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100003;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px';
    var card = document.createElement('div');
    card.style.cssText = 'width:min(420px,100%);border-radius:10px;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);font-family:inherit;overflow:hidden';
    card.innerHTML =
      '<div style="padding:16px 18px 6px;font-size:15px;font-weight:700;color:#111">重置登录密码</div>' +
      '<div style="padding:0 18px;font-size:12.5px;color:#71717a">为 <b>' + escapeHtml(member.name || member.email || '该成员') + '</b>' + (member.email ? '（' + escapeHtml(member.email) + '）' : '') + ' 设置新的登录密码。重置后请把新密码线下告知本人。</div>' +
      '<div style="padding:14px 18px 4px">' +
        '<input type="password" data-pwd-1 placeholder="新密码（至少 8 位）" autocomplete="new-password" style="width:100%;box-sizing:border-box;height:36px;border:1px solid #d4d4d8;border-radius:6px;padding:0 10px;font-size:13px;margin-bottom:10px" />' +
        '<input type="password" data-pwd-2 placeholder="再次输入新密码" autocomplete="new-password" style="width:100%;box-sizing:border-box;height:36px;border:1px solid #d4d4d8;border-radius:6px;padding:0 10px;font-size:13px" />' +
        '<div data-pwd-err style="display:none;margin-top:8px;font-size:12px;color:#e1262b"></div>' +
      '</div>' +
      '<div style="padding:12px 18px 16px;display:flex;justify-content:flex-end;gap:10px">' +
        '<button data-pwd-cancel style="height:34px;padding:0 14px;border-radius:6px;border:1px solid #d4d4d8;background:#fff;color:#52525b;font-size:13px;cursor:pointer">取消</button>' +
        '<button data-pwd-submit style="height:34px;padding:0 16px;border-radius:6px;border:1px solid #d97706;background:#d97706;color:#fff;font-size:13px;font-weight:700;cursor:pointer">确认重置</button>' +
      '</div>';
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    card.querySelector('[data-pwd-cancel]').addEventListener('click', function () { overlay.remove(); });
    var errEl = card.querySelector('[data-pwd-err]');
    var submitBtn = card.querySelector('[data-pwd-submit]');
    function showErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
    submitBtn.addEventListener('click', function () {
      var p1 = card.querySelector('[data-pwd-1]').value || '';
      var p2 = card.querySelector('[data-pwd-2]').value || '';
      if (p1.length < 8) return showErr('新密码至少 8 位');
      if (p1 !== p2) return showErr('两次输入的密码不一致');
      errEl.style.display = 'none';
      setRbacButtonBusy(submitBtn, true);
      window.fetch('/conv-api/rbac/members/' + encodeURIComponent(member.memberId) + '/reset-password', {
        method: 'POST', credentials: 'same-origin',
        headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ newPassword: p1 }),
      })
        .then(function (response) { return readChannelApiResponse(response, '重置失败'); })
        .then(function () {
          overlay.remove();
          var okEl = root.querySelector('[data-rbac-error]');
          if (okEl) { okEl.style.display = 'block'; okEl.style.color = '#16a34a'; okEl.textContent = '已重置 ' + (member.name || member.email || '该成员') + ' 的登录密码，请线下告知新密码。'; }
        })
        .catch(function (error) {
          setRbacButtonBusy(submitBtn, false);
          showErr(error.message || '重置失败');
        });
    });
    document.body.appendChild(overlay);
    var first = card.querySelector('[data-pwd-1]');
    if (first) first.focus();
  }

  function roleLabel(role) {
    return ({ admin: '后台管理员', manager: '销售主管', sales: '销售', boss: '总经理' })[role] || role;
  }

  function setRbacButtonBusy(button, isBusy) {
    if (isBusy) {
      button.setAttribute('data-rbac-original', button.textContent || '');
      button.textContent = '保存中…';
      button.disabled = true;
      button.style.opacity = '0.65';
      button.style.cursor = 'wait';
      return;
    }
    button.textContent = button.getAttribute('data-rbac-original') || button.textContent;
    button.disabled = false;
    button.style.opacity = '';
    button.style.cursor = 'pointer';
  }

  function removeSettingsAccountsCards() {
    [EMAILS_SETTINGS_CARD_ID, CHANNELS_SETTINGS_CARD_ID].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    var group = document.getElementById('__settings_accounts_entry_group__');
    if (group && !group.children.length) group.remove();
  }

  function findSettingsAccountsCardsHost() {
    var headings = Array.from(document.querySelectorAll('h1, h2, [role="heading"]'));
    var settingsHeading = headings.find(function (el) {
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return ['Settings', '设置', 'Accounts', 'Account', '账户', '账号'].indexOf(text) !== -1;
    });
    var section = settingsHeading && (settingsHeading.closest('section') || settingsHeading.parentElement);
    if (!section) section = document.querySelector('main') || document.querySelector('[role="main"]');
    if (!section) return null;
    var existing = document.getElementById('__settings_accounts_entry_group__');
    if (existing) return existing;
    // Keep the injected entry group beside the native account sections. The
    // first flex container may be the blocklist or email settings section.
    var host = document.createElement('div');
    host.id = '__settings_accounts_entry_group__';
    host.style.cssText = [
      'display:flex', 'gap:12px', 'width:100%', 'box-sizing:border-box',
      'margin:0 0 24px', 'align-items:stretch', 'order:-10'
    ].join(';');
    var firstContent = Array.from(section.children).find(function (el) {
      if (settingsHeading && (el === settingsHeading || el.contains(settingsHeading))) return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 300 && rect.height > 20;
    });
    section.insertBefore(host, firstContent || null);
    return host;
  }

  function buildSettingsAccountsCard(opts) {
    var card = document.createElement('div');
    card.id = opts.id;
    card.style.cssText = 'border:1px solid #e4e4e7;border-radius:8px;padding:16px;min-width:220px;flex:1;cursor:pointer;background:#fff;color:#71717a';
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;color:#3f3f46;font-weight:600">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + opts.svg + '</svg>' +
        '<span style="flex:1">' + opts.label + '</span><span style="color:#a1a1aa">›</span>' +
      '</div>' +
      '<div style="padding-left:32px;margin-top:8px;font-size:13px">' + opts.description + '</div>';
    card.addEventListener('click', function () { window.location.href = opts.href; });
    return card;
  }

  function ensureSettingsAccountsCards() {
    if (window.location.pathname !== '/settings/accounts') {
      removeSettingsAccountsCards();
      return;
    }
    if (document.getElementById(EMAILS_SETTINGS_CARD_ID) && document.getElementById(CHANNELS_SETTINGS_CARD_ID)) return;
    var cardsHost = findSettingsAccountsCardsHost();
    if (!cardsHost) return;
    if (!document.getElementById(EMAILS_SETTINGS_CARD_ID)) {
      cardsHost.appendChild(buildSettingsAccountsCard({
        id: EMAILS_SETTINGS_CARD_ID,
        href: '/settings/accounts/emails',
        label: '电子邮件',
        description: '绑定和管理 CRM 邮箱账号。',
        svg: EMAILS_SVG,
      }));
    }
    if (!document.getElementById(CHANNELS_SETTINGS_CARD_ID)) {
      cardsHost.appendChild(buildSettingsAccountsCard({
        id: CHANNELS_SETTINGS_CARD_ID,
        href: CHANNELS_SETTINGS_PATH,
        label: CHANNELS_SETTINGS_LABEL,
        description: '绑定 WhatsApp 等外部沟通渠道。',
        svg: CHANNELS_SVG,
      }));
    }
  }
