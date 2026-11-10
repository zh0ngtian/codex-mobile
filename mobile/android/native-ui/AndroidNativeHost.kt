package com.app.pakeplus.nativeui

import android.content.Context
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.app.pakeplus.InAppBrowserActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject

/** 唯一业务 WebView 常驻，Compose 只消费 DTO；外部浏览器与预览从不安装此桥。 */
class AndroidNativeHost(private val activity: AppCompatActivity, private val webView: WebView) {
    private val preferences = activity.getSharedPreferences("codex-mobile-native-ui", Context.MODE_PRIVATE)
    private val active = preferences.getBoolean("enabled", true)
    private val token = UUID.randomUUID().toString()
    private val parser = Executors.newSingleThreadExecutor()
    private val latest = AtomicReference<String?>()
    private var disposed = false
    private var qrRequest: String? = null
    private var compose: ComposeView? = null
    private var foreground = true
    private val state = NativeState { command -> evaluate("window.codexMobileNativeCommand?.($command)") }
    private val scanner = activity.registerForActivityResult(ScanContract()) { result ->
        val id = qrRequest ?: return@registerForActivityResult
        qrRequest = null
        val response = params("id" to id)
        if (result.contents.isNullOrBlank()) response.put("error", "已取消扫描") else response.put("value", result.contents)
        evaluate("window.codexMobileQRComplete?.($response)")
    }

    fun install() {
        state.savedNative = active; state.nativeActive = active
        state.restartBusiness = { webView.reload() }
        state.openLink = { link ->
            val resource = state.snapshot.raw.items("richContent").find { it.kind == "image" && link in listOf(it.text, it.value, it.previewURL) }
            if (resource != null) state.preview = resource
            else if (link.startsWith("file://") || link.startsWith('/')) state.dispatch(state.snapshot.command("file.open", params("href" to link)))
            else if (Uri.parse(link).scheme in listOf("https", "http")) {
                activity.startActivity(InAppBrowserActivity.createIntent(activity, link))
            } else state.localError = "此链接无法打开"
        }
        state.appearance = preferences.getString("appearance", "system") ?: "system"
        state.codeWrap = preferences.getBoolean("codeWrap", true)
        state.saveCodeWrap = { value ->
            if (preferences.edit().putBoolean("codeWrap", value).commit()) state.codeWrap = value
            else state.localError = "无法保存代码换行设置，请重试"
        }
        state.saveAppearance = { value ->
            if (preferences.edit().putString("appearance", value).commit()) state.appearance = value
            else state.localError = "无法保存外观设置，请重试"
        }
        if (active) {
            webView.alpha = 0.01f
            webView.isFocusable = false
            webView.isFocusableInTouchMode = false
            webView.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            compose = ComposeView(activity).apply {
                setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
                setContent { CodexMaterialTheme(state.appearance, state.snapshot.raw.optDouble("fontScale", 1.0).toFloat()) { NativeApp(state) } }
            }
            activity.findViewById<FrameLayout>(android.R.id.content).addView(compose,
                ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            state.localError = "当前 Android System WebView 不支持原生界面桥接，请更新系统 WebView 后重新打开应用"
            return
        }
        WebViewCompat.addWebMessageListener(webView, "CodexNativeUI", setOf("*")) { view, message, _, isMainFrame, _ ->
            // file: 的 origin 为 null；精确首页、主 frame 和每次宿主随机 token 共同限定权限。
            if (disposed || view !== webView || !isMainFrame || view.url != HOME) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            // 共享层已按真实附件上限校验；合法 100 MiB 文件的 base64 预览不能在宿主另设小上限丢弃。
            if (data.contains("\"type\":\"snapshot\"")) {
                if (latest.getAndSet(data) == null) parser.execute { drainSnapshots() }
            } else parser.execute {
                try {
                    val envelope = JSONObject(data)
                    if (envelope.string("token") == token) activity.runOnUiThread { receive(envelope) }
                } catch (_: Exception) { /* 非协议消息不执行操作。 */ }
            }
        }
        val source = activity.assets.open("native-ui-bootstrap.js").bufferedReader().use { it.readText() }
            .replace("__NATIVE_TOKEN__", JSONObject.quote(token))
            .replace("__NATIVE_ENABLED__", active.toString())
        WebViewCompat.addDocumentStartJavaScript(webView, source, setOf("*"))
    }

    private fun drainSnapshots() {
        while (!disposed) {
            val data = latest.getAndSet(null) ?: break
            try {
                val envelope = JSONObject(data)
                if (envelope.string("token") != token || envelope.string("type") != "snapshot") continue
                val snapshot = NativeSnapshot.decode(envelope.getJSONObject("snapshot"))
                activity.runOnUiThread {
                    if (!disposed && webView.url == HOME) state.receive(snapshot)
                }
            } catch (_: Exception) {
                activity.runOnUiThread { if (!disposed) state.localError = "原生界面数据读取失败，请重试" }
            }
        }
    }

    private fun receive(envelope: JSONObject) {
        if (disposed || webView.url != HOME) return
        when (envelope.string("type")) {
            "snapshot" -> state.receive(NativeSnapshot.decode(envelope.getJSONObject("snapshot")))
            "nativePreference" -> {
                val response = params("id" to envelope.string("id"), "active" to active)
                if (envelope.has("enabled")) {
                    val value = envelope.opt("enabled")
                    if (value !is Boolean) response.put("error", "原生界面设置无效")
                    else {
                        val previous = preferences.getBoolean("enabled", true)
                        if (!preferences.edit().putBoolean("enabled", value).commit()) {
                            preferences.edit().putBoolean("enabled", previous).commit()
                            response.put("error", "无法保存原生界面设置")
                        } else {
                            state.savedNative = value
                            state.preferenceNotice = "下次完整启动 App 时生效"
                        }
                    }
                }
                response.put("enabled", preferences.getBoolean("enabled", true))
                evaluate("window.codexMobileNativePreferenceComplete?.($response)")
            }
            "scanQR" -> {
                val id = envelope.string("id")
                if (id.isEmpty()) return
                if (qrRequest != null) {
                    evaluate("window.codexMobileQRComplete?.(${params("id" to id, "error" to "二维码扫描正在使用中")})")
                } else {
                    qrRequest = id
                    try {
                        scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                            .setPrompt("扫描 Codex Mobile 网关二维码").setBeepEnabled(false).setOrientationLocked(true))
                    } catch (_: Exception) {
                        qrRequest = null
                        evaluate("window.codexMobileQRComplete?.(${params("id" to id, "error" to "无法启动相机，请检查相机权限")})")
                    }
                }
            }
        }
    }

    private fun evaluate(script: String) {
        if (!disposed && webView.url == HOME) webView.evaluateJavascript("if(location.href===${JSONObject.quote(HOME)}){$script;}", null)
    }
    fun setActive(value: Boolean) {
        foreground = value
        evaluate("window.codexMobileSetNativeActive?.($value)")
    }
    fun pageReady() { setActive(foreground) }
    fun dispose() {
        disposed = true; latest.set(null); parser.shutdownNow(); state.dispose()
        compose?.disposeComposition(); compose = null
    }
    companion object { private const val HOME = "file:///android_asset/index.html" }
}
