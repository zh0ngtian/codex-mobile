package com.app.pakeplus.nativeui

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeComposeTest {
    @get:Rule val ui = createComposeRule()
    @Test fun typingAndSendingUseNativeComposerAndWaitForAcknowledgement() {
        val emitted = mutableListOf<JSONObject>()
        lateinit var state: NativeState
        ui.setContent {
            state = androidx.compose.runtime.remember { NativeState { emitted.add(it) }.also { it.receive(NativeSnapshot.decode(fixtureSnapshot())) } }
            CodexMaterialTheme("light") { NativeApp(state) }
        }
        ui.onNodeWithTag("android-native-root").assertIsDisplayed()
        ui.onNodeWithTag("native-composer-input").performTextInput("原生输入 👋")
        ui.onNodeWithTag("native-send").performClick().assertIsNotEnabled()
        ui.runOnIdle {
            assertEquals("原生输入 👋", emitted.last { it.string("name") == "draft.set" }.getJSONObject("params").string("value"))
            assertEquals(1, emitted.count { it.string("name") == "message.send" })
            state.dispose()
        }
    }
    @Test fun drawerSettingsAndLightDarkRenderingUseMaterialComponents() {
        lateinit var state: NativeState
        ui.setContent {
            state = androidx.compose.runtime.remember { NativeState { command ->
                if (command.string("name") == "navigation.sidebar") state.receive(NativeSnapshot.decode(fixtureSnapshot().put("sidebarOpen", command.getJSONObject("params").optBoolean("open"))))
            }.also { it.receive(NativeSnapshot.decode(fixtureSnapshot())) } }
            CodexMaterialTheme(state.appearance) { NativeApp(state) }
        }
        ui.waitForIdle(); saveScreenshot("conversation-light.png")
        ui.onNodeWithContentDescription("打开侧栏").performClick()
        ui.onNodeWithTag("native-search").assertIsDisplayed()
        ui.onNodeWithTag("native-new-chat").assertIsDisplayed()
        saveScreenshot("drawer-light.png")
        ui.runOnIdle {
            state.appearance = "dark"
            state.receive(NativeSnapshot.decode(fixtureSnapshot().put("sidebarOpen", false).put("panel", params(
                "id" to "settings:root", "title" to "设置", "items" to JSONArray().put(params("id" to "language", "kind" to "singleChoice", "title" to "语言", "value" to "system",
                    "options" to JSONArray().put(params("id" to "system", "value" to "system", "title" to "跟随系统"))))))))
        }
        ui.onNodeWithTag("native-interface-switch").assertIsDisplayed()
        saveScreenshot("settings-dark.png")
        ui.runOnIdle { state.dispose() }
    }
    @Test fun manyQueuedMessagesKeepTheInputAndPrimaryQueueActionVisible() {
        val emitted = mutableListOf<JSONObject>()
        lateinit var state: NativeState
        val queues = JSONArray()
        repeat(8) { index -> queues.put(params("id" to "q$index", "title" to "排队中的两行消息，用于检查补充区滚动与输入区域的高度预算。", "subtitle" to "改为引导", "command" to params("name" to "queue.send", "params" to params("id" to "q$index", "contextId" to "device:context:1")))) }
        ui.setContent {
            state = androidx.compose.runtime.remember { NativeState { emitted.add(it) }.also { it.receive(NativeSnapshot.decode(fixtureSnapshot().put("queued", queues).put("busy", true))) } }
            CodexMaterialTheme("light") { NativeApp(state) }
        }
        ui.onNodeWithTag("native-composer-input").assertIsDisplayed()
        ui.onNodeWithTag("native-send").assertIsDisplayed()
        ui.onAllNodesWithText("改为引导").filter(hasClickAction()).onFirst().performClick()
        ui.runOnIdle { assertEquals("queue.send", emitted.last().string("name")); state.dispose() }
        saveScreenshot("queue-light.png")
    }
    @Test fun reopeningAFieldDoesNotLetOldAcknowledgementsOverwriteNewTyping() {
        lateinit var state: NativeState
        val emitted = mutableListOf<JSONObject>()
        var opened by androidx.compose.runtime.mutableStateOf(true)
        var field by androidx.compose.runtime.mutableStateOf(NativeItem(params("id" to "name", "kind" to "textField", "title" to "设备名", "value" to "", "command" to params("name" to "devices.field"))))
        ui.setContent {
            state = androidx.compose.runtime.remember { NativeState { emitted.add(it) }.also { it.receive(NativeSnapshot.decode(fixtureSnapshot())) } }
            CodexMaterialTheme("light") { if (opened) NativePanelItemView(state, field, "devices") }
        }
        ui.onNodeWithTag("native-field-name").performTextInput("old")
        val old = emitted.last().getJSONObject("params")
        ui.runOnIdle {
            state.receive(NativeSnapshot.decode(fixtureSnapshot().put("commandResults", JSONArray().put(params("id" to "old-ack", "ok" to true, "fieldKey" to old.string("fieldKey"), "fieldRevision" to old.getLong("fieldRevision"))))))
            opened = false
        }
        ui.waitForIdle()
        ui.runOnIdle { opened = true }
        ui.onNodeWithTag("native-field-name").performTextInput("a")
        val first = emitted.last().getJSONObject("params")
        ui.onNodeWithTag("native-field-name").performTextInput("b")
        ui.runOnIdle {
            assertTrue(emitted.last().getJSONObject("params").getLong("fieldRevision") > first.getLong("fieldRevision"))
            assertTrue(first.getLong("fieldRevision") > old.getLong("fieldRevision"))
            field = NativeItem(JSONObject(field.raw.toString()).put("value", "a"))
            state.receive(NativeSnapshot.decode(fixtureSnapshot().put("commandResults", JSONArray().put(params("id" to "first-ack", "ok" to true, "fieldKey" to first.string("fieldKey"), "fieldRevision" to first.getLong("fieldRevision"))))))
        }
        ui.onNodeWithTag("native-field-name").assertTextContains("ab")
        ui.runOnIdle { state.dispose() }
    }
    private fun saveScreenshot(name: String) {
        ui.mainClock.advanceTimeBy(1500); ui.waitForIdle()
        android.os.SystemClock.sleep(350)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.getExternalFilesDir(null), name)
        file.outputStream().use {
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
