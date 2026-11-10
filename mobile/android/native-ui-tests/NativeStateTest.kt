package com.app.pakeplus.nativeui

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

internal fun fixtureSnapshot(context: String = "device:context:1", draft: String = "", revision: Long = 0): JSONObject = params(
    "version" to 1, "ready" to true, "contextId" to context, "draft" to draft, "draftRevision" to revision,
    "canSend" to true, "connection" to "online", "threadId" to "thread-1", "title" to "Android 原生界面验收",
    "backendName" to "测试电脑", "projectName" to "Codex Mobile", "navigationLoading" to false,
    "backends" to JSONArray().put(params("id" to "all", "title" to "全部设备")).put(params("id" to "device", "title" to "测试电脑", "connected" to true)),
    "model" to "GPT", "effort" to "高", "modelValue" to "model", "effortValue" to "high",
    "models" to JSONArray().put(params("id" to "model", "title" to "GPT", "value" to "model")),
    "efforts" to JSONArray().put(params("id" to "high", "title" to "高", "value" to "high")),
    "messages" to JSONArray().put(params("id" to "u1", "role" to "user", "text" to "为 Android 做一个 Material You 原生版本"))
        .put(params("id" to "a1", "role" to "assistant", "text" to "原生界面已连接共享业务。\n\n- 会话与项目\n- 原生输入与审批\n- 动态配色和动效")),
    "groups" to JSONArray().put(params("id" to "project", "title" to "Codex Mobile", "category" to "project", "items" to JSONArray().put(params("id" to "thread", "title" to "Android 原生界面验收", "selected" to true,
        "command" to params("name" to "thread.open", "params" to params("backendId" to "device", "threadId" to "thread-1")))))))

@RunWith(AndroidJUnit4::class)
class NativeStateTest {
    @Test fun oldDraftEchoCannotOverwriteNewerInputAndContextSwitchResetsRevision() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val emitted = mutableListOf<JSONObject>()
            val state = NativeState { emitted.add(it) }
            state.receive(NativeSnapshot.decode(fixtureSnapshot(draft = "旧输入", revision = 4)))
            state.editDraft(TextFieldValue("新输入👋", TextRange(5)))
            state.receive(NativeSnapshot.decode(fixtureSnapshot(draft = "旧输入", revision = 4)))
            assertEquals("新输入👋", state.draft.text)
            assertEquals(5, emitted.last().getJSONObject("params").getInt("caretOffset"))
            assertEquals(5L, emitted.last().getJSONObject("params").getLong("revision"))
            state.receive(NativeSnapshot.decode(fixtureSnapshot(context = "device:context:2", draft = "另一个草稿")))
            assertEquals("另一个草稿", state.draft.text)
            state.dispose()
        }
    }
    @Test fun doubleSendEmitsOneSubmissionAndFailureKeepsDraft() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val emitted = mutableListOf<JSONObject>()
            val state = NativeState { emitted.add(it) }
            state.receive(NativeSnapshot.decode(fixtureSnapshot(draft = "请保留输入")))
            state.send(); state.send()
            val sends = emitted.filter { it.string("name") == "message.send" }
            assertEquals(1, sends.size)
            assertTrue(state.sending)
            assertEquals("请保留输入", state.draft.text)
            val next = fixtureSnapshot(draft = "请保留输入", revision = 1).put("commandResults", JSONArray().put(params(
                "id" to sends.single().string("id"), "name" to "message.send", "ok" to false, "contextId" to "device:context:1", "error" to "网络断开")))
            state.receive(NativeSnapshot.decode(next))
            assertFalse(state.sending)
            assertEquals("请保留输入", state.draft.text)
            assertEquals("网络断开", state.localError)
            state.dispose()
        }
    }
    @Test fun expiredEditorCannotMutateTheNewConversationDuringExitAnimation() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val emitted = mutableListOf<JSONObject>(); val state = NativeState { emitted.add(it) }
            state.receive(NativeSnapshot.decode(fixtureSnapshot(context = "new", draft = "新会话草稿")))
            state.editDraft(TextFieldValue("旧键盘回调"), "old"); state.send("old")
            assertEquals("新会话草稿", state.draft.text); assertTrue(emitted.isEmpty()); state.dispose()
        }
    }
    @Test fun searchWaitsForCurrentAcknowledgementAndClearsWhenSidebarCloses() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val state = NativeState {}
            state.receive(NativeSnapshot.decode(fixtureSnapshot().put("sidebarOpen", true)))
            state.editSearch("新关键词")
            state.receive(NativeSnapshot.decode(fixtureSnapshot().put("sidebarOpen", true).put("search", "旧关键词")))
            assertEquals("新关键词", state.search)
            state.receive(NativeSnapshot.decode(fixtureSnapshot().put("sidebarOpen", false).put("search", "")))
            assertEquals("", state.search); state.dispose()
        }
    }
    @Test fun addingCommandParametersDoesNotMutateCapturedContext() {
        val command = NativeCommand("model.select", params("contextId" to "old", "value" to "a"))
        val edited = command.adding(params("value" to "b"))
        assertEquals("a", command.params.string("value"))
        assertEquals("old", edited.params.string("contextId"))
        assertEquals("b", edited.params.string("value"))
        assertEquals(1, NativeSnapshot.decode(fixtureSnapshot()).backends.size)
    }
}
