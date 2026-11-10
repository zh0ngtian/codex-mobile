package com.app.pakeplus.nativeui

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import java.util.UUID
import org.json.JSONObject

/** 仅拥有呈现状态。所有业务动作走共享 NativeRuntime 的命令与回执。 */
internal class NativeState(private val emit: (JSONObject) -> Unit) {
    var snapshot by mutableStateOf(NativeSnapshot()); private set
    var draft by mutableStateOf(TextFieldValue()); private set
    var search by mutableStateOf(""); private set
    var localError by mutableStateOf("")
    var sending by mutableStateOf(false); private set
    var savedNative by mutableStateOf(true)
    var nativeActive by mutableStateOf(true)
    var preferenceNotice by mutableStateOf("")
    var preview by mutableStateOf<NativeItem?>(null)
    var appearance by mutableStateOf("system")
    var codeWrap by mutableStateOf(true)
    var saveAppearance: (String) -> Unit = {}
    var saveCodeWrap: (Boolean) -> Unit = {}
    var restartBusiness: () -> Unit = {}
    var openLink: (String) -> Unit = {}
    val fieldAcknowledgements = mutableStateMapOf<String, Long>()
    private var revision = 0L
    private var searchRevision = 0L
    private var fieldRevision = 0L
    private var submissionId: String? = null
    private val main = Handler(Looper.getMainLooper())
    private val completed = LinkedHashSet<String>()

    fun receive(value: NativeSnapshot) {
        val changed = snapshot.context != value.context
        if (changed) {
            revision = value.revision
            draft = TextFieldValue(value.draft, TextRange(value.caret))
            sending = false; submissionId = null; preview = null
            fieldAcknowledgements.clear()
        } else if (value.revision >= revision) {
            revision = value.revision
            if (draft.text != value.draft) draft = TextFieldValue(value.draft, TextRange(value.caret))
        }
        snapshot = value
        for (result in value.results) {
            val id = result.string("id")
            if (!completed.add(id)) continue
            if (completed.size > 256) completed.remove(completed.first())
            if (id == submissionId) { sending = false; submissionId = null }
            val fieldKey = result.string("fieldKey")
            if (fieldKey.isNotEmpty() && result.optBoolean("ok")) {
                fieldAcknowledgements[fieldKey] = maxOf(fieldAcknowledgements[fieldKey] ?: 0L, result.optLong("fieldRevision"))
                fieldRevision = maxOf(fieldRevision, result.optLong("fieldRevision"))
            }
            if (!result.optBoolean("ok") && (result.string("contextId").isEmpty() || result.string("contextId") == value.context)) {
                localError = result.string("error").ifEmpty { "操作失败，请重试" }
            }
        }
        if (!value.sidebarOpen || (fieldAcknowledgements["navigation:search"] ?: 0L) >= searchRevision) search = value.search
    }

    fun dispatch(command: NativeCommand?, extra: JSONObject = JSONObject()): String? {
        if (command == null) return null
        localError = ""
        val id = UUID.randomUUID().toString()
        val payload = command.adding(extra)
        emit(params("id" to id, "name" to payload.name, "params" to payload.params))
        return id
    }

    fun editDraft(value: TextFieldValue, ownerContext: String = snapshot.context) {
        if (ownerContext != snapshot.context || snapshot.context.isEmpty() || snapshot.readOnly) return
        draft = value
        revision++
        dispatch(snapshot.command("draft.set", params("value" to value.text, "revision" to revision, "caretOffset" to value.selection.end)))
    }

    fun send(ownerContext: String = snapshot.context) {
        if (ownerContext != snapshot.context || sending || snapshot.readOnly || !snapshot.canSend) return
        val context = snapshot.context
        // 输入最后一个版本先同步执行；运行时在处理下一条发送前会 flush 草稿。
        editDraft(draft)
        sending = true
        val id = dispatch(snapshot.command("message.send"))
        submissionId = id
        main.postDelayed({
            if (submissionId == id && snapshot.context == context) {
                sending = false; submissionId = null
                localError = "发送结果尚未确认，请保留输入并等待同步"
            }
        }, 30000)
    }

    fun nextFieldRevision(): Long = ++fieldRevision

    fun editSearch(value: String) {
        if (!snapshot.sidebarOpen) return
        search = value; searchRevision = nextFieldRevision()
        dispatch(NativeCommand("navigation.search", params("value" to value, "fieldKey" to "navigation:search", "fieldRevision" to searchRevision)))
    }

    fun setSidebar(open: Boolean) = dispatch(NativeCommand("navigation.sidebar", params("open" to open)))
    fun closePanel(panel: NativePanel) {
        if (panel.dismissible) dispatch(snapshot.command("panel.close", params("id" to panel.id)))
    }
    fun dispose() { main.removeCallbacksAndMessages(null) }
}
