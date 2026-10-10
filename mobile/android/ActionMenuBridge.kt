package com.app.pakeplus

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.PopupMenu
import org.json.JSONArray
import org.json.JSONObject

/** 原生菜单只由内置首页桥调用。 */
class ActionMenuBridge(private val activity: Activity, private val webView: WebView) {
    private var popup: PopupMenu? = null
    private var requestId: String? = null
    private var anchorView: View? = null

    fun show(request: String) {
        val body = try { JSONObject(request) } catch (_: Exception) { return }
        activity.runOnUiThread {
            if (!webView.url.orEmpty().startsWith("file:///android_asset/")) return@runOnUiThread
            dismiss()
            val id = body.optString("requestId")
            val actions = body.optJSONArray("actions") ?: JSONArray()
            if (id.isEmpty() || actions.length() !in 1..12) return@runOnUiThread
            requestId = id
            val rect = body.optJSONObject("anchor") ?: JSONObject()
            val density = activity.resources.displayMetrics.density
            val position = IntArray(2)
            webView.getLocationOnScreen(position)
            val anchor = View(activity)
            val root = activity.window.decorView as ViewGroup
            root.addView(anchor, ViewGroup.LayoutParams(1, 1))
            val rootPosition = IntArray(2)
            root.getLocationOnScreen(rootPosition)
            anchor.x = position[0] - rootPosition[0] + (rect.optDouble("x") * density).toFloat()
            anchor.y = position[1] - rootPosition[1] + ((rect.optDouble("y") + rect.optDouble("height")) * density).toFloat()
            anchorView = anchor
            val menu = PopupMenu(activity, anchor, Gravity.START)
            popup = menu
            for (index in 0 until actions.length()) {
                val action = actions.getJSONObject(index)
                menu.menu.add(0, index, index, action.optString("title")).isEnabled = !action.optBoolean("disabled")
            }
            menu.setOnMenuItemClickListener { selected ->
                val action = actions.getJSONObject(selected.itemId)
                if (action.has("copyText")) {
                    val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("", action.getString("copyText")))
                }
                finish(id, action.optString("id"))
                true
            }
            menu.setOnDismissListener {
                finish(id, null)
                root.removeView(anchor)
                if (anchorView === anchor) anchorView = null
                if (popup === menu) popup = null
            }
            webView.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
            menu.show()
        }
    }

    fun dismiss(id: String? = null) {
        activity.runOnUiThread {
            if (id == null || id == requestId) {
                requestId = null
                popup?.dismiss()
                popup = null
                (anchorView?.parent as? ViewGroup)?.removeView(anchorView)
                anchorView = null
            }
        }
    }

    private fun finish(id: String, actionId: String?) {
        if (id != requestId) return
        requestId = null
        val result = JSONObject().put("requestId", id).put("actionId", actionId ?: JSONObject.NULL)
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('codex-mobile-action-menu', {detail: $result}));", null)
    }
}
