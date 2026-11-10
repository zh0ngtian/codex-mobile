package com.app.pakeplus.nativeui

import org.json.JSONArray
import org.json.JSONObject

internal fun JSONObject.string(key: String): String = if (isNull(key)) "" else optString(key, "")
internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else
    (0 until length()).mapNotNull { optJSONObject(it) }
internal fun JSONObject.items(key: String) = optJSONArray(key).objects().map(::NativeItem)

/** DTO 只消费展示快照；不持有网关配置、网络客户端或远端状态。 */
internal data class NativeCommand(val name: String, val params: JSONObject = JSONObject()) {
    fun adding(extra: JSONObject): NativeCommand {
        val merged = JSONObject(params.toString())
        extra.keys().forEach { merged.put(it, extra.get(it)) }
        return copy(params = merged)
    }
    companion object {
        fun decode(value: JSONObject?): NativeCommand? = value?.string("name")?.takeIf { it.isNotEmpty() }
            ?.let { NativeCommand(it, value.optJSONObject("params") ?: JSONObject()) }
    }
}

internal data class NativeOption(val id: String, val title: String, val value: String, val subtitle: String) {
    companion object {
        fun decode(value: JSONObject) = NativeOption(value.string("id"), value.string("title"), value.string("value"), value.string("subtitle"))
    }
}

internal class NativeItem(val raw: JSONObject) {
    val id = raw.string("id")
    val kind = raw.string("kind")
    val title = raw.string("title")
    val text = raw.string("text")
    val value = raw.string("value")
    val previewURL = raw.string("previewURL")
    val disabled = raw.optBoolean("disabled")
    val command = NativeCommand.decode(raw.optJSONObject("command"))
    val children = raw.items("children")
    val options = raw.optJSONArray("options").objects().map(NativeOption::decode)
}

internal class NativePanel(val raw: JSONObject) {
    val id = raw.string("id")
    val title = raw.string("title")
    val dismissible = raw.optBoolean("dismissible", true)
    val items = raw.items("items")
}

internal class NativeEntry(val raw: JSONObject) {
    val id = raw.string("id")
    val title = raw.string("title")
    val subtitle = raw.string("subtitle")
    val selected = raw.optBoolean("selected")
    val unread = raw.optBoolean("isUnread")
    val running = raw.optBoolean("running")
    val command = NativeCommand.decode(raw.optJSONObject("command"))
    val actions = raw.items("actions")
}

internal class NativeGroup(val raw: JSONObject) {
    val id = raw.string("id")
    val title = raw.string("title")
    val subtitle = raw.string("subtitle")
    val collapsed = raw.optBoolean("collapsed")
    val category = raw.string("category")
    val loading = raw.string("loading")
    val command = NativeCommand.decode(raw.optJSONObject("command"))
    val newCommand = NativeCommand.decode(raw.optJSONObject("newCommand"))
    val items = raw.optJSONArray("items").objects().map(::NativeEntry)
    val allItems = raw.optJSONArray("allItems")?.objects()?.map(::NativeEntry) ?: items
    val actions = raw.items("actions")
}

internal class NativeMessage(val raw: JSONObject) {
    val id = raw.string("id")
    val role = raw.string("role")
    val text = raw.string("text")
    val rawText = raw.string("rawText").ifEmpty { text }
    val status = raw.string("status")
    val activityKind = raw.string("activityKind")
    val anchor = raw.string("scrollAnchorId").ifEmpty { id }
    val blocks = raw.items("blocks")
    val actions = raw.items("actions")
    val historyEdit = raw.optJSONObject("historyEdit")?.let(::NativePanel)
    val commentary = raw.optJSONArray("commentary").objects()
    val commentaryRunning = raw.optBoolean("commentaryIsRunning")
    val timestamp = raw.optDouble("timestamp", 0.0)
    val quoteSource: JSONObject? = raw.optJSONObject("quoteSource")
}

internal class NativeSnapshot(val raw: JSONObject = JSONObject()) {
    val ready = raw.optBoolean("ready")
    val context = raw.string("contextId")
    val title = raw.string("title").ifEmpty { "Codex Mobile" }
    val threadId = raw.string("threadId")
    val backendName = raw.string("backendName")
    val projectName = raw.string("projectName")
    val connection = raw.string("connection")
    val error = raw.string("error")
    val busy = raw.optBoolean("busy")
    val pending = raw.optBoolean("pending")
    val readOnly = raw.optBoolean("readOnly")
    val canSend = raw.optBoolean("canSend")
    val canInterrupt = raw.optBoolean("canInterrupt")
    val sidebarOpen = raw.optBoolean("sidebarOpen")
    val navigationLoading = raw.optBoolean("navigationLoading", !ready)
    val loading = raw.string("loading")
    val draft = raw.string("draft")
    val revision = raw.optLong("draftRevision")
    val caret = raw.optInt("caretOffset", draft.length).coerceIn(0, draft.length)
    val model = raw.string("model").ifEmpty { "模型" }
    val effort = raw.string("effort")
    val speed = raw.string("speed")
    val modelValue = raw.string("modelValue")
    val effortValue = raw.string("effortValue")
    val speedValue = raw.string("speedValue")
    val permissionValue = raw.string("permissionValue")
    val approvalCount = raw.optInt("approvalCount")
    val sidechatActive = raw.optBoolean("sidechatActive")
    val groups = raw.optJSONArray("groups").objects().map(::NativeGroup)
    val backends = raw.optJSONArray("backends").objects().filter { it.string("id") != "all" }
    val messages = raw.optJSONArray("messages").objects().map(::NativeMessage)
    val attachments = raw.optJSONArray("attachments").objects()
    val queued = raw.optJSONArray("queued").objects().map(::NativeEntry)
    val quotes = raw.optJSONArray("quotes").objects()
    val actions = raw.items("conversationActions")
    val sidechatActions = raw.items("sidechatActions")
    val models = raw.optJSONArray("models").objects().map(NativeOption::decode)
    val efforts = raw.optJSONArray("efforts").objects().map(NativeOption::decode)
    val speeds = raw.optJSONArray("speeds").objects().map(NativeOption::decode)
    val permissions = raw.optJSONArray("permissions").objects().map(NativeOption::decode)
    val panel = raw.optJSONObject("panel")?.let(::NativePanel)
    val results = raw.optJSONArray("commandResults").objects()
    val search = raw.string("search")
    val preferences = raw.optJSONObject("preferences") ?: JSONObject()
    fun command(name: String, params: JSONObject = JSONObject()) = NativeCommand(name, params.put("contextId", context))
    companion object {
        fun decode(value: JSONObject): NativeSnapshot {
            require(value.optInt("version") == 1) { "不支持的原生界面协议版本" }
            return NativeSnapshot(value)
        }
    }
}

internal fun params(vararg values: Pair<String, Any?>) = JSONObject().apply {
    values.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
}
