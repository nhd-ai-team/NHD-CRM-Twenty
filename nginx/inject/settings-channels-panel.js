(function () {
  'use strict';

  var PANEL_ID = '__settings_channels_page__';
  var CACHE_KEY = '__nhd_wa_status_cache__';
  var CACHE_TTL_MS = 30000;
  var MIN_STATUS_INTERVAL_MS = 1500;
  var QR_CACHE_TTL_MS = 15000;
  var STATUS_POLL_MS = 5000;
  var statusInFlight = null;
  var qrInFlight = null;
  var lastStatusStartedAt = 0;
  var statusPoller = null;

  function getCookie(name) {
    var prefix = name + '=';
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part.indexOf(prefix) === 0) return part.slice(prefix.length);
    }
    return '';
  }

  function decodeJwtPayload(token) {
    try {
      var payload = token.split('.')[1];
      if (!payload) return null;
      return JSON.parse(window.atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) {
      return null;
    }
  }

  function isUsableAccessToken(token) {
    var payload = token ? decodeJwtPayload(token) : null;
    if (!payload || !payload.workspaceId) return false;
    var now = Math.floor(Date.now() / 1000);
    return typeof payload.exp !== 'number' || payload.exp > now + 30;
  }

  function getTokenFromValue(value) {
    try {
      var raw = decodeURIComponent(String(value || ''));
      if (!raw) return '';
      if (raw.split('.').length === 3) return raw;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.accessToken && parsed.accessToken.token) return parsed.accessToken.token;
      if (parsed && parsed.tokenPair && parsed.tokenPair.accessToken && parsed.tokenPair.accessToken.token) return parsed.tokenPair.accessToken.token;
      if (parsed && parsed.token && String(parsed.token).split('.').length === 3) return parsed.token;
    } catch (e) {
      if (String(value || '').split('.').length === 3) return String(value || '');
    }
    return '';
  }

  function getTokenFromWebStorage(storage) {
    try {
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        var token = getTokenFromValue(storage.getItem(key));
        if (isUsableAccessToken(token)) return token;
      }
    } catch (e) {}
    return '';
  }

  function getTwentyAccessToken() {
    var candidates = [
      getTokenFromValue(getCookie('tokenPair')),
      sessionStorage.getItem('twentyAccessToken'),
      getTokenFromWebStorage(window.sessionStorage),
      getTokenFromWebStorage(window.localStorage),
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (isUsableAccessToken(candidates[i])) return candidates[i];
    }
    return '';
  }

  function waitForTwentyAccessToken(timeoutMs) {
    var token = getTwentyAccessToken();
    if (token) return Promise.resolve(token);
    return new Promise(function (resolve) {
      var startedAt = Date.now();
      var timer = window.setInterval(function () {
        var nextToken = getTwentyAccessToken();
        if (nextToken || Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer);
          resolve(nextToken || '');
        }
      }, 250);
    });
  }

  function getTwentyAuthHeaders(extra) {
    var token = getTwentyAccessToken();
    var headers = extra || {};
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Twenty-Access-Token'] = token;
      var payload = decodeJwtPayload(token);
      if (payload && payload.sub) headers['X-Twenty-User-Id'] = payload.sub;
    }
    return headers;
  }

  function readJsonResponse(response, fallbackMessage) {
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
      if (!response.ok) throw new Error(data && (data.error || data.detail) || fallbackMessage);
      return data;
    }).catch(function (error) {
      if (error instanceof TypeError) throw new Error('无法连接渠道服务，请检查网络后重试。');
      throw error;
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

  function formatNow() {
    var now = new Date();
    var pad = function (value) { return String(value).padStart(2, '0'); };
    return pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  }

  function statusLabel(status) {
    if (status === 'WORKING') return '已连接';
    if (status === 'SCAN_QR_CODE') return '等待扫码';
    if (status === 'STARTING') return '启动中';
    if (status === 'STOPPED') return '未启动';
    if (status === 'FAILED') return '连接失败';
    return status || '未知';
  }

  function getCachedStatus() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (cached && cached.data && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
    } catch (e) {}
    return null;
  }

  function setCachedStatus(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: data }));
    } catch (e) {}
  }

  function clearCachedStatus() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  function setButtonBusy(root, selector, busyText, isBusy) {
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

  function renderStatus(root, state, fromCache) {
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
      ? '已绑定到我的账号'
      : boundByOther
        ? '已被其他用户绑定：' + (binding.ownerName || '其他 CRM 用户')
        : connected
          ? '已连接，未绑定到 CRM 账号'
          : '未绑定';
    root.querySelector('[data-wa-updated]').textContent = (fromCache ? '缓存状态 ' : '最后刷新 ') + formatNow();

    var startButton = root.querySelector('[data-wa-start]');
    if (startButton) {
      var startDisabled = connected || boundByOther;
      startButton.setAttribute('data-connected-disabled', startDisabled ? '1' : '0');
      startButton.disabled = startDisabled;
      startButton.style.opacity = startDisabled ? '0.5' : '';
      startButton.style.cursor = startDisabled ? 'not-allowed' : 'pointer';
    }

    var codeButton = root.querySelector('[data-wa-code]');
    var phoneInput = root.querySelector('[data-wa-phone-input]');
    if (codeButton) {
      var codeDisabled = connected || boundByOther;
      codeButton.setAttribute('data-connected-disabled', codeDisabled ? '1' : '0');
      codeButton.disabled = codeDisabled;
      codeButton.style.opacity = codeDisabled ? '0.5' : '';
      codeButton.style.cursor = codeDisabled ? 'not-allowed' : 'pointer';
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
        ? (state.status === 'FAILED' ? '当前会话异常，系统会自动重新生成二维码。请稍等几秒后扫码。' : '请用 WhatsApp 手机端扫描下方二维码，完成后页面会自动刷新状态。')
        : '如未显示二维码，请点击“启动/刷新二维码”。';

    var qrBox = root.querySelector('[data-wa-qr-box]');
    qrBox.style.display = waitingQr ? 'block' : 'none';
    if (waitingQr && !fromCache) loadQr(root);
  }

  function loadQr(root) {
    var qr = root.querySelector('[data-wa-qr]');
    if (!qr) return;
    var loadedAt = Number(qr.dataset.loadedAt || 0);
    if (qr.src && loadedAt && Date.now() - loadedAt < QR_CACHE_TTL_MS) return;
    if (qrInFlight) return qrInFlight;
    qrInFlight = window.fetch('/conv-api/channel-accounts/whatsapp/qr?t=' + Date.now(), {
      credentials: 'same-origin',
      headers: getTwentyAuthHeaders(),
    })
      .then(function (response) {
        if (!response.ok) return readJsonResponse(response, '二维码生成失败');
        return response.blob();
      })
      .then(function (blob) {
        if (!blob || !blob.type) return;
        if (qr.dataset.objectUrl) window.URL.revokeObjectURL(qr.dataset.objectUrl);
        var url = window.URL.createObjectURL(blob);
        qr.dataset.objectUrl = url;
        qr.dataset.loadedAt = String(Date.now());
        qr.src = url;
        root.querySelector('[data-wa-error]').textContent = '';
      })
      .catch(function (error) {
        root.querySelector('[data-wa-error]').textContent = error.message || '二维码生成中，请稍后刷新状态';
      })
      .finally(function () { qrInFlight = null; });
    return qrInFlight;
  }

  function loadStatus(root, force) {
    root.querySelector('[data-wa-error]').textContent = '';
    if (!force) {
      var cached = getCachedStatus();
      if (cached) {
        renderStatus(root, cached, true);
        return Promise.resolve(cached);
      }
      if (statusInFlight) return statusInFlight;
      if (Date.now() - lastStatusStartedAt < MIN_STATUS_INTERVAL_MS) return Promise.resolve(null);
    }
    lastStatusStartedAt = Date.now();
    statusInFlight = waitForTwentyAccessToken(6000)
      .then(function (token) {
        if (!token) throw new Error('登录状态正在初始化，请刷新 CRM 后重试。');
        return window.fetch('/conv-api/channel-accounts/whatsapp/status', { credentials: 'same-origin', cache: 'no-store', headers: getTwentyAuthHeaders() });
      })
      .then(function (response) { return readJsonResponse(response, '状态加载失败'); })
      .then(function (data) {
        setCachedStatus(data);
        renderStatus(root, data, false);
        return data;
      })
      .catch(function (error) {
        root.querySelector('[data-wa-error]').textContent = error.message || '状态加载失败';
      })
      .finally(function () { statusInFlight = null; });
    return statusInFlight;
  }

  function createPanel() {
    var root = document.createElement('div');
    root.id = PANEL_ID;
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
      clearCachedStatus();
      setButtonBusy(root, '[data-wa-refresh]', '刷新中...', true);
      loadStatus(root, true).finally(function () { setButtonBusy(root, '[data-wa-refresh]', '刷新中...', false); });
    });
    root.querySelector('[data-wa-start]').addEventListener('click', function () {
      root.querySelector('[data-wa-error]').textContent = '';
      clearCachedStatus();
      setButtonBusy(root, '[data-wa-start]', '生成中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp/restart', { method: 'POST', credentials: 'same-origin', headers: getTwentyAuthHeaders() })
        .then(function (response) { return readJsonResponse(response, '二维码生成失败'); })
        .then(function () { return loadStatus(root, true); })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '启动失败'; })
        .finally(function () { setButtonBusy(root, '[data-wa-start]', '生成中...', false); });
    });
    root.querySelector('[data-wa-code]').addEventListener('click', function () {
      var phoneInput = root.querySelector('[data-wa-phone-input]');
      var resultBox = root.querySelector('[data-wa-code-result]');
      var codeValue = root.querySelector('[data-wa-code-value]');
      root.querySelector('[data-wa-error]').textContent = '';
      resultBox.style.display = 'none';
      codeValue.textContent = '';
      clearCachedStatus();
      setButtonBusy(root, '[data-wa-code]', '生成中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp/request-code', {
        method: 'POST',
        credentials: 'same-origin',
        headers: getTwentyAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ phoneNumber: phoneInput.value }),
      })
        .then(function (response) { return readJsonResponse(response, '配对码生成失败'); })
        .then(function (data) {
          codeValue.textContent = data.code || '-';
          resultBox.style.display = 'block';
          return loadStatus(root, true);
        })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '配对码生成失败'; })
        .finally(function () { setButtonBusy(root, '[data-wa-code]', '生成中...', false); });
    });
    root.querySelector('[data-wa-bind]').addEventListener('click', function () {
      root.querySelector('[data-wa-error]').textContent = '';
      clearCachedStatus();
      setButtonBusy(root, '[data-wa-bind]', '绑定中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp/bind', { method: 'POST', credentials: 'same-origin', headers: getTwentyAuthHeaders() })
        .then(function (response) { return readJsonResponse(response, '绑定失败'); })
        .then(function () { return loadStatus(root, true); })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '绑定失败'; })
        .finally(function () { setButtonBusy(root, '[data-wa-bind]', '绑定中...', false); });
    });
    root.querySelector('[data-wa-unbind]').addEventListener('click', function () {
      if (!window.confirm('确认解绑当前 WhatsApp？解绑后该账号将不能继续在 CRM 中收发 WhatsApp，需要重新扫码或配对后再绑定。')) return;
      root.querySelector('[data-wa-error]').textContent = '';
      clearCachedStatus();
      setButtonBusy(root, '[data-wa-unbind]', '解绑中...', true);
      window.fetch('/conv-api/channel-accounts/whatsapp', { method: 'DELETE', credentials: 'same-origin', headers: getTwentyAuthHeaders() })
        .then(function (response) { return readJsonResponse(response, '解绑失败'); })
        .then(function () { return loadStatus(root, true); })
        .catch(function (error) { root.querySelector('[data-wa-error]').textContent = error.message || '解绑失败'; })
        .finally(function () { setButtonBusy(root, '[data-wa-unbind]', '解绑中...', false); });
    });
    return root;
  }

  function setChannelNavActive() {
    Array.from(document.querySelectorAll('a[href="/settings/profile#channels"], a[href="/settings/accounts/channels"]')).forEach(function (el) {
      el.setAttribute('data-active', '1');
      el.style.background = 'var(--twenty-background-tertiary,rgba(0,0,0,.06))';
      el.style.color = 'var(--twenty-font-color-secondary,#52525b)';
    });
  }

  function open() {
    var root = document.getElementById(PANEL_ID) || createPanel();
    var wasOpen = root.style.display !== 'none';
    root.style.left = settingsDrawerRight() + 'px';
    root.style.display = 'block';
    setChannelNavActive();
    if (!statusPoller) {
      statusPoller = window.setInterval(function () {
        var page = document.getElementById(PANEL_ID);
        if (page && page.style.display !== 'none' && window.location.hash === '#channels' && document.visibilityState === 'visible') {
          clearCachedStatus();
          loadStatus(page, true);
        }
      }, STATUS_POLL_MS);
    }
    if (!wasOpen) loadStatus(root, false);
    else {
      var cached = getCachedStatus();
      if (cached) renderStatus(root, cached, true);
      else loadStatus(root, false);
    }
  }

  function isOpen() {
    var root = document.getElementById(PANEL_ID);
    return !!root && root.style.display !== 'none';
  }

  window.NHDSettingsChannels = { open: open, clearCache: clearCachedStatus, isOpen: isOpen };
})();
