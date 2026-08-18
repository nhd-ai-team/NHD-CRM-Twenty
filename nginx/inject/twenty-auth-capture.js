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
  if (typeof originalFetch === 'function') {
    window.fetch = function () {
      try {
        var input = arguments[0];
        var init = arguments[1] || {};
        var token = extractBearer(getHeaderValue(init.headers, 'authorization'));
        if (!token && input && input.headers) token = extractBearer(getHeaderValue(input.headers, 'authorization'));
        rememberToken(token);
      } catch (_error) {}
      return originalFetch.apply(this, arguments);
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
