// APK Forge — الإشعارات بين التطبيقات عبر Firebase Realtime Database (لا تعدّل هذا الملف).
// الاستخدام:
//   Notifier.start(this)                                    // في onCreate داخل MainActivity
//   Notifier.send("admin", "طلب جديد", "تفاصيل", mapOf("orderId" to 5))
//   LaunchedEffect(Unit) { Notifier.events.collect { n -> ... } }
package __PACKAGE__

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class AppNotification(
    val id: String,
    val from: String,
    val title: String,
    val body: String,
    val data: JSONObject,
)

object Notifier {
    private const val CHANNEL = "app_events"
    private val client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _events = MutableSharedFlow<AppNotification>(extraBufferCapacity = 64)
    val events: SharedFlow<AppNotification> = _events
    private val seen = HashSet<String>()
    private var started = false
    private var appContext: Context? = null
    private val base: String get() = "${Config.FIREBASE_DB_URL}/notifications/${Config.PROJECT_SLUG}"

    fun start(activity: Activity) {
        if (started || Config.FIREBASE_DB_URL.isEmpty()) return
        started = true
        appContext = activity.applicationContext
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = activity.getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(NotificationChannel(CHANNEL, "App events", NotificationManager.IMPORTANCE_HIGH))
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7001)
        }
        scope.launch { listenLoop() }
    }

    fun send(toAppId: String, title: String, body: String, data: Map<String, Any?> = emptyMap()) {
        scope.launch {
            val json = JSONObject()
                .put("title", title)
                .put("body", body)
                .put("from", Config.APP_ID)
                .put("data", JSONObject(data))
                .put("ts", JSONObject().put(".sv", "timestamp"))
            runCatching {
                val req = Request.Builder()
                    .url("$base/$toAppId.json")
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(req).execute().close()
            }
        }
    }

    private suspend fun listenLoop() {
        while (true) {
            runCatching {
                val req = Request.Builder()
                    .url("$base/${Config.APP_ID}.json")
                    .header("Accept", "text/event-stream")
                    .build()
                client.newCall(req).execute().use { res ->
                    val src = res.body?.source() ?: return@use
                    var event = ""
                    while (!src.exhausted()) {
                        val line = src.readUtf8Line() ?: break
                        if (line.startsWith("event:")) {
                            event = line.substring(6).trim()
                        } else if (line.startsWith("data:") && (event == "put" || event == "patch")) {
                            onData(line.substring(5).trim())
                        }
                    }
                }
            }
            delay(3000)
        }
    }

    private fun onData(raw: String) {
        val msg = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val path = msg.optString("path", "/")
        val data = msg.opt("data")
        if (data == null || data == JSONObject.NULL) return
        if (path == "/") {
            if (data is JSONObject) {
                val keys = data.keys().asSequence().toList()
                for (k in keys) data.optJSONObject(k)?.let { handle(k, it) }
            }
        } else {
            val key = path.trimStart('/')
            if (!key.contains('/') && data is JSONObject) handle(key, data)
        }
    }

    private fun handle(key: String, v: JSONObject) {
        synchronized(seen) { if (!seen.add(key)) return }
        val n = AppNotification(
            key,
            v.optString("from"),
            v.optString("title"),
            v.optString("body"),
            v.optJSONObject("data") ?: JSONObject(),
        )
        _events.tryEmit(n)
        showSystem(n)
        runCatching {
            client.newCall(Request.Builder().url("$base/${Config.APP_ID}/$key.json").delete().build()).execute().close()
        }
    }

    private fun showSystem(n: AppNotification) {
        val ctx = appContext ?: return
        if (Build.VERSION.SDK_INT >= 33 &&
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        val pi = PendingIntent.getActivity(
            ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, CHANNEL) else Notification.Builder(ctx)
        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setAutoCancel(true)
            .setContentIntent(pi)
        nm.notify(n.id.hashCode(), builder.build())
    }
}
