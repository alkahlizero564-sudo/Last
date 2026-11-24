# APK Forge — الإشعارات بين التطبيقات عبر Firebase Realtime Database (لا تعدّل هذا الملف).
# الاستخدام:
#   import notifier
#   notifier.start()                                   # في build() أو on_start()
#   notifier.on_notification(lambda n: ...)            # يُستدعى على خيط الواجهة
#   notifier.send("admin", "New order", "details", {"order_id": 5})
import json
import threading
import time

import requests
from kivy.clock import Clock

import config

_BASE = f"{config.FIREBASE_DB_URL}/notifications/{config.PROJECT_SLUG}"
_listeners = []
_seen = set()
_lock = threading.Lock()
_started = False


def on_notification(callback):
    _listeners.append(callback)


def send(to_app_id, title, body, data=None):
    payload = {
        "title": str(title),
        "body": str(body),
        "data": data or {},
        "from": config.APP_ID,
        "ts": {".sv": "timestamp"},
    }

    def run():
        try:
            requests.post(f"{_BASE}/{to_app_id}.json", json=payload, timeout=15)
        except Exception as e:  # noqa: BLE001
            print("notifier.send failed:", e)

    threading.Thread(target=run, daemon=True).start()


def _system_notify(title, body):
    try:
        from plyer import notification

        notification.notify(title=title, message=body, app_name=config.APP_NAME or "App")
    except Exception as e:  # noqa: BLE001
        print("system notification unavailable:", e)


def _handle(key, value):
    if not isinstance(value, dict):
        return
    with _lock:
        if key in _seen:
            return
        _seen.add(key)
    n = {
        "id": key,
        "from": value.get("from", ""),
        "title": value.get("title", ""),
        "body": value.get("body", ""),
        "data": value.get("data") or {},
    }
    _system_notify(n["title"], n["body"])
    for cb in list(_listeners):
        Clock.schedule_once(lambda dt, cb=cb: cb(n))
    try:
        requests.delete(f"{_BASE}/{config.APP_ID}/{key}.json", timeout=15)
    except Exception:  # noqa: BLE001
        pass


def _on_data(raw):
    try:
        msg = json.loads(raw)
    except ValueError:
        return
    if not isinstance(msg, dict) or msg.get("data") is None:
        return
    path, data = msg.get("path", "/"), msg["data"]
    if path == "/":
        if isinstance(data, dict):
            for k, v in data.items():
                _handle(k, v)
    else:
        key = path.lstrip("/")
        if "/" not in key:
            _handle(key, data)


def _listen():
    url = f"{_BASE}/{config.APP_ID}.json"
    while True:
        try:
            with requests.get(url, headers={"Accept": "text/event-stream"}, stream=True, timeout=(15, None)) as r:
                event = ""
                for line in r.iter_lines(decode_unicode=True):
                    if not line:
                        continue
                    if line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:") and event in ("put", "patch"):
                        _on_data(line[5:].strip())
        except Exception as e:  # noqa: BLE001
            print("notifier reconnecting:", e)
        time.sleep(3)


def start():
    global _started
    if _started or not config.FIREBASE_DB_URL:
        return
    _started = True
    try:
        from android.permissions import request_permissions  # type: ignore

        request_permissions(["android.permission.POST_NOTIFICATIONS"])
    except Exception:  # noqa: BLE001
        pass
    threading.Thread(target=_listen, daemon=True).start()
