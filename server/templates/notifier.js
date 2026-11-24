// APK Forge — الإشعارات بين التطبيقات عبر Firebase Realtime Database.
// API: Notifier.start()  Notifier.send(toAppId, title, body, data)  Notifier.onNotification(fn)
// المسار: notifications/<projectSlug>/<appId>/<pushId> — كل تطبيق يستمع لصندوقه، ويحذف الإشعار بعد استلامه.
// في المعاينة (داخل iframe) تُمرَّر الإشعارات عبر لوحة APK Forge بدل Firebase.
function createNotifier(cfg) {
  var inPreview = (function () { try { return window.parent !== window; } catch (e) { return true; } })();
  var listeners = [];
  var seen = {};
  var started = false;
  var base = String(cfg.firebaseDbUrl || '').replace(/\/$/, '') + '/notifications/' + cfg.projectSlug;
  var cap = function () { return window.Capacitor && typeof window.Capacitor.nativePromise === 'function' ? window.Capacitor : null; };

  function id32(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) || 1; }

  function toast(n) {
    if (!document.body) return;
    var el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:2147483646;background:#111827;color:#fff;' +
      'padding:12px 14px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.3);font:14px/1.4 system-ui,Tahoma,sans-serif;' +
      'transition:opacity .3s,transform .3s;transform:translateY(-10px);opacity:0;direction:auto';
    var t = document.createElement('b'); t.textContent = '🔔 ' + (n.title || '');
    var b = document.createElement('div'); b.textContent = n.body || ''; b.style.opacity = '.85';
    el.appendChild(t); el.appendChild(b);
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'none'; });
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 400); }, 4500);
  }

  function system(n) {
    var c = cap();
    if (c) {
      c.nativePromise('LocalNotifications', 'schedule', {
        notifications: [{ id: id32(n.id), title: n.title || '', body: n.body || '', extra: n.data || {} }],
      }).catch(function (e) { console.warn('LocalNotifications', e); });
      return;
    }
    if (!inPreview && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(n.title || '', { body: n.body || '' }); } catch (e) { /* */ }
    }
  }

  function deliver(n) {
    if (!n || seen[n.id]) return;
    seen[n.id] = 1;
    system(n);
    toast(n);
    listeners.slice().forEach(function (fn) { try { fn(n); } catch (e) { console.error(e); } });
  }

  function handle(key, v) {
    if (!v || typeof v !== 'object') return;
    deliver({ id: key, from: v.from || '', title: v.title || '', body: v.body || '', data: v.data || {}, ts: v.ts || Date.now() });
    fetch(base + '/' + cfg.appId + '/' + encodeURIComponent(key) + '.json', { method: 'DELETE' }).catch(function () {});
  }

  function listen() {
    if (inPreview) {
      window.addEventListener('message', function (e) {
        var d = e.data;
        if (d && d.__apkf === 'deliver') deliver(d.payload);
      });
      return;
    }
    if (!cfg.firebaseDbUrl) { console.warn('Notifier: firebaseDbUrl غير مضبوط'); return; }
    var es = new EventSource(base + '/' + cfg.appId + '.json');
    var onEvt = function (e) {
      var msg; try { msg = JSON.parse(e.data); } catch (x) { return; }
      if (!msg || msg.data == null) return;
      if (msg.path === '/') {
        if (typeof msg.data === 'object') Object.keys(msg.data).forEach(function (k) { handle(k, msg.data[k]); });
      } else {
        var k = msg.path.replace(/^\//, '');
        if (k.indexOf('/') === -1) handle(k, msg.data);
      }
    };
    es.addEventListener('put', onEvt);
    es.addEventListener('patch', onEvt);
  }

  function requestPermission() {
    var c = cap();
    if (c) return c.nativePromise('LocalNotifications', 'requestPermissions', {}).catch(function () {});
    if (!inPreview && 'Notification' in window && Notification.permission === 'default') {
      try { return Notification.requestPermission(); } catch (e) { /* */ }
    }
    return Promise.resolve();
  }

  return {
    appId: cfg.appId,
    start: function () { if (started) return; started = true; requestPermission(); listen(); },
    send: function (toAppId, title, body, data) {
      var payload = { title: String(title || ''), body: String(body || ''), data: data || {}, from: cfg.appId };
      if (inPreview) {
        payload.id = 'p' + Date.now() + Math.random().toString(36).slice(2, 8);
        window.parent.postMessage({ __apkf: 'notify', from: cfg.appId, to: toAppId, payload: payload }, '*');
        return Promise.resolve();
      }
      if (!cfg.firebaseDbUrl) return Promise.reject(new Error('firebaseDbUrl غير مضبوط'));
      payload.ts = { '.sv': 'timestamp' };
      return fetch(base + '/' + encodeURIComponent(toAppId) + '.json', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      }).then(function (r) { if (!r.ok) throw new Error('Firebase ' + r.status); return r.json(); });
    },
    onNotification: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
    },
    requestPermission: requestPermission,
  };
}
