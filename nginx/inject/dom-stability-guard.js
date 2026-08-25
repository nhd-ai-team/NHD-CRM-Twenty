(function () {
  'use strict';
  if (window.__NHD_DOM_STABILITY_GUARD__) return;
  window.__NHD_DOM_STABILITY_GUARD__ = {
    version: '20260825-dom-guard-v1',
    insertBeforeFallbacks: 0,
    events: [],
  };

  function record(type, detail) {
    try {
      var state = window.__NHD_DOM_STABILITY_GUARD__;
      state.events.push({
        type: type,
        detail: detail || '',
        at: Date.now(),
        path: location.pathname + location.search + location.hash,
      });
      if (state.events.length > 30) state.events.shift();
    } catch (_) {}
  }

  try {
    var originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (newNode, referenceNode) {
      if (referenceNode && referenceNode.parentNode !== this) {
        try { window.__NHD_DOM_STABILITY_GUARD__.insertBeforeFallbacks += 1; } catch (_) {}
        record('insertBefore-reference-mismatch', referenceNode && referenceNode.nodeName);
        return originalInsertBefore.call(this, newNode, null);
      }
      return originalInsertBefore.call(this, newNode, referenceNode);
    };
  } catch (error) {
    record('install-failed', error && error.message);
  }
})();
