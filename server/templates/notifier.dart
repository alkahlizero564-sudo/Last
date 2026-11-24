// APK Forge — الإشعارات بين التطبيقات عبر Firebase Realtime Database (لا تعدّل هذا الملف).
// الاستخدام:
//   await Notifier.instance.init();                       // مرة واحدة في main أو initState
//   Notifier.instance.send('admin', 'طلب جديد', 'تفاصيل', {'orderId': 5});
//   Notifier.instance.stream.listen((n) { ... });         // عند وصول إشعار
import 'dart:async';
import 'dart:convert';

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;

import 'config.dart';

class AppNotification {
  final String id;
  final String from;
  final String title;
  final String body;
  final Map<String, dynamic> data;
  AppNotification(this.id, this.from, this.title, this.body, this.data);
}

class Notifier {
  Notifier._();
  static final Notifier instance = Notifier._();

  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  final StreamController<AppNotification> _controller = StreamController<AppNotification>.broadcast();
  final Set<String> _seen = <String>{};
  bool _started = false;

  Stream<AppNotification> get stream => _controller.stream;
  String get _base => '${AppConfig.firebaseDbUrl}/notifications/${AppConfig.projectSlug}';

  Future<void> init() async {
    if (_started || AppConfig.firebaseDbUrl.isEmpty) return;
    _started = true;
    try {
      const settings = InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher'));
      await _plugin.initialize(settings);
      await _plugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
    } catch (_) {}
    unawaited(_listen());
  }

  Future<void> send(String toAppId, String title, String body, [Map<String, dynamic> data = const {}]) async {
    if (AppConfig.firebaseDbUrl.isEmpty) return;
    await http.post(
      Uri.parse('$_base/${Uri.encodeComponent(toAppId)}.json'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({
        'title': title,
        'body': body,
        'data': data,
        'from': AppConfig.appId,
        'ts': {'.sv': 'timestamp'},
      }),
    );
  }

  Future<void> _listen() async {
    while (true) {
      final client = http.Client();
      try {
        final req = http.Request('GET', Uri.parse('$_base/${AppConfig.appId}.json'))
          ..headers['Accept'] = 'text/event-stream';
        final res = await client.send(req);
        var event = '';
        await for (final line in res.stream.transform(utf8.decoder).transform(const LineSplitter())) {
          if (line.startsWith('event:')) {
            event = line.substring(6).trim();
          } else if (line.startsWith('data:') && (event == 'put' || event == 'patch')) {
            _onData(line.substring(5).trim());
          }
        }
      } catch (_) {
        // إعادة الاتصال تلقائياً
      } finally {
        client.close();
      }
      await Future<void>.delayed(const Duration(seconds: 3));
    }
  }

  void _onData(String raw) {
    dynamic msg;
    try {
      msg = jsonDecode(raw);
    } catch (_) {
      return;
    }
    if (msg is! Map) return;
    final path = (msg['path'] ?? '/').toString();
    final data = msg['data'];
    if (data == null) return;
    if (path == '/') {
      if (data is Map) data.forEach((k, v) => _handle(k.toString(), v));
    } else {
      final key = path.substring(1);
      if (!key.contains('/')) _handle(key, data);
    }
  }

  Future<void> _handle(String key, dynamic v) async {
    if (v is! Map || _seen.contains(key)) return;
    _seen.add(key);
    final n = AppNotification(
      key,
      (v['from'] ?? '').toString(),
      (v['title'] ?? '').toString(),
      (v['body'] ?? '').toString(),
      v['data'] is Map ? Map<String, dynamic>.from(v['data'] as Map) : <String, dynamic>{},
    );
    _controller.add(n);
    try {
      await _plugin.show(
        key.hashCode & 0x7fffffff,
        n.title,
        n.body,
        const NotificationDetails(
          android: AndroidNotificationDetails('app_events', 'App events',
              importance: Importance.high, priority: Priority.high),
        ),
      );
    } catch (_) {}
    try {
      await http.delete(Uri.parse('$_base/${AppConfig.appId}/$key.json'));
    } catch (_) {}
  }
}
