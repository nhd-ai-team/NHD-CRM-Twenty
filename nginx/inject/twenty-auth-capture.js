(function () {
  'use strict';

  if (window.__nhdTwentyAuthCaptureInstalled) return;
  window.__nhdTwentyAuthCaptureInstalled = true;

  function decodeJwtPayload(token) {
    try {
      var payload = String(token || '').split('.')[1];
      if (!payload) return null;
      return JSON.parse(window.atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (_error) {
      return null;
    }
  }

  function isUsableAccessToken(token) {
    var payload = token ? decodeJwtPayload(token) : null;
    if (!payload || !payload.workspaceId) return false;
    var now = Math.floor(Date.now() / 1000);
    return typeof payload.exp !== 'number' || payload.exp > now + 30;
  }

  function rememberToken(token) {
    if (!isUsableAccessToken(token)) return;
    try {
      window.sessionStorage.setItem('twentyAccessToken', token);
    } catch (_error) {}
  }

  function extractBearer(value) {
    var auth = String(value || '');
    return auth.toLowerCase().indexOf('bearer ') === 0 ? auth.slice(7).trim() : '';
  }

  function getHeaderValue(headers, name) {
    if (!headers) return '';
    try {
      if (typeof headers.get === 'function') return headers.get(name) || '';
      var lower = name.toLowerCase();
      if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i++) {
          if (String(headers[i][0]).toLowerCase() === lower) return headers[i][1];
        }
      }
      for (var key in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lower) return headers[key];
      }
    } catch (_error) {}
    return '';
  }

  var originalFetch = window.fetch;
  var authFailureCount = 0;
  var authFailureTimer = 0;

  function hasUsableCurrentToken() {
    try {
      var raw = decodeURIComponent(String(document.cookie || '').split(';').map(function (part) { return part.trim(); }).find(function (part) { return part.indexOf('tokenPair=') === 0; }) || '').slice(10);
      var parsed = raw ? JSON.parse(raw) : null;
      var token = parsed && parsed.accessToken && parsed.accessToken.token;
      if (isUsableAccessToken(token)) return true;
      var stores = [window.sessionStorage, window.localStorage];
      for (var s = 0; s < stores.length; s++) {
        var store = stores[s];
        for (var i = 0; i < store.length; i++) {
          var value = decodeURIComponent(String(store.getItem(store.key(i)) || ''));
          if (isUsableAccessToken(value)) return true;
          var candidate = null;
          try { candidate = JSON.parse(value || '{}'); } catch (_parseError) { candidate = null; }
          if (!candidate) continue;
          if (candidate.accessToken && isUsableAccessToken(candidate.accessToken.token)) return true;
          if (candidate.tokenPair && candidate.tokenPair.accessToken && isUsableAccessToken(candidate.tokenPair.accessToken.token)) return true;
        }
      }
      return false;
    } catch (_error) {
      return false;
    }
  }

  function showAuthExpired(reason) {
    if (window.__NHD_AUTH_EXPIRED__) return;
    window.__NHD_AUTH_EXPIRED__ = true;
    window.dispatchEvent(new CustomEvent('twenty-auth-expired', { detail: { reason: reason || '登录状态已失效，请刷新 CRM 后重新登录。' } }));
    var existing = document.getElementById('__nhd_auth_expired__');
    if (existing) return;
    var overlay = document.createElement('div');
    overlay.id = '__nhd_auth_expired__';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(255,255,255,.96);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;color:#18181b;';
    overlay.innerHTML = '<div style="width:min(420px,calc(100% - 40px));text-align:center"><div style="font-size:18px;font-weight:700">登录状态已失效</div><div style="margin-top:10px;color:#71717a;font-size:13px;line-height:1.7">页面数据已停止加载，请刷新 CRM 后重新登录。</div><button id="__nhd_auth_expired_reload__" style="margin-top:20px;height:36px;padding:0 16px;border:0;border-radius:6px;background:#16a34a;color:#fff;font-size:13px;font-weight:700;cursor:pointer">刷新并重新登录</button></div>';
    document.body.appendChild(overlay);
    document.getElementById('__nhd_auth_expired_reload__').addEventListener('click', function () { window.location.reload(); });
  }

  function noteAuthFailure(reason) {
    authFailureCount += 1;
    window.clearTimeout(authFailureTimer);
    authFailureTimer = window.setTimeout(function () {
      if (!hasUsableCurrentToken() && authFailureCount >= 1) showAuthExpired(reason);
      authFailureCount = 0;
    }, 2000);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === 'twenty-auth-expired') {
      showAuthExpired(event.data.reason);
    }
  });

  if (typeof originalFetch === 'function') {
    window.fetch = function () {
      try {
        var input = arguments[0];
        var init = arguments[1] || {};
        var token = extractBearer(getHeaderValue(init.headers, 'authorization'));
        if (!token && input && input.headers) token = extractBearer(getHeaderValue(input.headers, 'authorization'));
        rememberToken(token);
      } catch (_error) {}
      return originalFetch.apply(this, arguments).then(function (response) {
        if (response.status === 401) {
          noteAuthFailure('登录状态已失效，请刷新 CRM 后重新登录。');
        } else if (response.ok && response.url && response.url.indexOf('/graphql') !== -1) {
          response.clone().json().then(function (payload) {
            var text = JSON.stringify(payload || {});
            if (/UNAUTHENTICATED|unauthenticated|unauthorized/i.test(text)) {
              noteAuthFailure('登录状态已失效，请刷新 CRM 后重新登录。');
            }
          }).catch(function () {});
        }
        return response;
      }, function (error) {
        throw error;
      });
    };
  }

  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function () {
    this.__nhdRequestUrl = arguments[1] || '';
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (String(name || '').toLowerCase() === 'authorization') rememberToken(extractBearer(value));
    return originalSetRequestHeader.apply(this, arguments);
  };
})();
