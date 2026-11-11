package com.app.pakeplus.nativeui

import android.graphics.Bitmap
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.remember
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.Before
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class NativeLayoutTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    @Before fun matchProductionWindowInsets() {
        ui.runOnUiThread { prepareNativeTestWindow(ui.activity) }
    }

    @Test fun standardComposerKeepsModelEffortAndPrimaryActionsSeparate() {
        val emitted = mutableListOf<JSONObject>()
        lateinit var state: NativeState
        ui.setContent {
            state = remember { NativeState { emitted.add(it) }.also { it.receive(NativeSnapshot.decode(layoutSnapshot())) } }
            CodexMaterialTheme("light") { NativeApp(state) }
        }
        val bounds = ui.onNodeWithTag("native-composer-surface").getUnclippedBoundsInRoot()
        assertTrue("标准密度应为输入、配置和操作分别保留空间", bounds.bottom - bounds.top in 176.dp..208.dp)
        val modelBounds = ui.onNodeWithTag("native-model").getUnclippedBoundsInRoot()
        val effortBounds = ui.onNodeWithTag("native-effort").getUnclippedBoundsInRoot()
        val sendBounds = ui.onNodeWithTag("native-send").getUnclippedBoundsInRoot()
        assertTrue("模型与强度都有独立48dp触区", modelBounds.bottom - modelBounds.top >= 48.dp && effortBounds.bottom - effortBounds.top >= 48.dp)
        assertTrue("常用配置应同时可见且不重叠", modelBounds.right <= effortBounds.left && effortBounds.right <= bounds.right)
        assertTrue("发送位于独立工具行，不能挤压模型选择", sendBounds.top >= modelBounds.bottom)
        val modelLayouts = mutableListOf<TextLayoutResult>()
        ui.onNodeWithText("GPT-6.1", useUnmergedTree = true).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(modelLayouts) }
        val modelLayout = modelLayouts.single()
        // Compose 的整数像素尺寸可能比排版宽度少不足1px；核对实际字形边界和完整可见字符。
        assertFalse("常用模型名不应省略", modelLayout.isLineEllipsized(0))
        assertEquals("GPT-6.1".length, modelLayout.getLineEnd(0, visibleEnd = true))
        assertTrue("常用模型名字形不能超出控件", modelLayout.getLineRight(0) <= modelLayout.size.width + 1f)
        ui.onNodeWithTag("native-model").assertIsDisplayed()
        ui.onNodeWithTag("native-effort").assertIsDisplayed().performClick()
        ui.onNodeWithText("高", useUnmergedTree = true).assertIsDisplayed().performClick()
        ui.runOnIdle {
            assertEquals("effort.select", emitted.last().string("name"))
            assertEquals("device:context:1", emitted.last().getJSONObject("params").string("contextId"))
        }
        ui.onNodeWithTag("native-model").performClick()
        ui.onAllNodesWithText("GPT-6.1").filter(hasAnyAncestor(isPopup())).onFirst().performClick()
        ui.runOnIdle { assertEquals("model.select", emitted.last().string("name")) }
        ui.onNodeWithContentDescription("用量与会话设置").performClick()
        ui.runOnIdle { assertEquals("workspace", emitted.last().getJSONObject("params").string("id")) }
        ui.onNodeWithContentDescription("新建对话").performClick()
        ui.runOnIdle { assertEquals("thread.new", emitted.last().string("name")) }
        saveScreenshot("standard-conversation-light.png")
        ui.runOnIdle { state.dispose() }
    }

    @Test fun longModelMenuWrapsAndScrollKeepsEffortStopAndSendReachable() {
        val longName = "GPT-6.1 Codex · Extended reasoning model with a long name"
        lateinit var state: NativeState
        ui.setContent {
            state = remember { NativeState {}.also { it.receive(NativeSnapshot.decode(layoutSnapshot(longName).put("busy", true).put("canInterrupt", true))) } }
            CodexMaterialTheme("dark") { NativeApp(state) }
        }
        ui.onNodeWithTag("native-model").performClick()
        val option = ui.onAllNodesWithText(longName).filter(hasAnyAncestor(isPopup())).onFirst()
        val layouts = mutableListOf<TextLayoutResult>()
        option.performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertTrue(layouts.isNotEmpty())
        assertFalse("完整模型名不能被菜单裁切", layouts.first().hasVisualOverflow)
        saveScreenshot("long-model-menu-dark.png")
        option.performClick()
        ui.onNodeWithTag("native-effort").performScrollTo().assertIsDisplayed().performClick()
        ui.onNodeWithText("高", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("native-stop").assertIsDisplayed().assertIsEnabled()
        ui.onNodeWithTag("native-send").assertIsDisplayed().assertIsEnabled()
        saveScreenshot("long-model-tools-dark.png")
        ui.runOnIdle { state.dispose() }
    }

    @Test fun sidebarShowsFiveThreadsWithoutSearchWhitespaceAndClearsHiddenSearch() {
        val emitted = mutableListOf<JSONObject>()
        lateinit var state: NativeState
        val snapshot = layoutSnapshot().put("sidebarOpen", true)
        val entries = JSONArray()
        repeat(5) { index -> entries.put(params("id" to "row$index", "title" to "${index + 1}. 完整页面布局与交互优化", "selected" to (index == 0),
            "command" to params("name" to "thread.open", "params" to params("backendId" to "device", "threadId" to "thread-$index")))) }
        snapshot.put("groups", JSONArray().put(params("id" to "project", "title" to "Codex Mobile", "category" to "project", "items" to entries))
            .put(params("id" to "project2", "title" to "另一个项目", "category" to "project", "items" to JSONArray().put(params("id" to "more", "title" to "继续处理待办事项")))))
        ui.setContent {
            state = remember { NativeState { emitted.add(it) }.also { it.receive(NativeSnapshot.decode(snapshot)) } }
            CodexMaterialTheme("light") { NativeApp(state) }
        }
        ui.onNodeWithTag("native-search").assertDoesNotExist()
        ui.onNodeWithText("5. 完整页面布局与交互优化").assertIsDisplayed()
        ui.onNodeWithTag("native-thread-row0").assertIsSelected()
        ui.onNodeWithTag("native-thread-row1").assertIsNotSelected()
        saveScreenshot("standard-sidebar-light.png")
        ui.onNodeWithContentDescription("搜索会话").performClick()
        ui.onNodeWithTag("native-search").performTextInput("搜索内容")
        ui.onNodeWithContentDescription("关闭搜索").performClick()
        ui.runOnIdle { assertEquals("", emitted.last { it.string("name") == "navigation.search" }.getJSONObject("params").string("value")) }
        ui.onNodeWithContentDescription("搜索会话").performClick()
        ui.onNodeWithTag("native-search").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString("")))
        ui.onNodeWithContentDescription("关闭搜索").performClick()
        ui.onNodeWithContentDescription("侧栏菜单").performClick()
        ui.onNodeWithText("测试电脑").performClick()
        ui.runOnIdle {
            assertEquals("device", emitted.last().getJSONObject("params").string("id"))
            state.receive(NativeSnapshot.decode(snapshot.put("listBackendId", "device")))
        }
        ui.onNodeWithContentDescription("侧栏菜单").performClick()
        ui.onNodeWithText("全部设备").performClick()
        ui.runOnIdle {
            assertEquals("backend.select", emitted.last().string("name"))
            assertEquals("all", emitted.last().getJSONObject("params").string("id"))
        }
        ui.onNodeWithContentDescription("侧栏菜单").performClick()
        ui.onNodeWithText("设置").performClick()
        ui.runOnIdle { assertEquals("settings", emitted.last { it.string("name") == "settings.open" }.getJSONObject("params").string("id")); state.dispose() }
    }

    @Test fun longQueueErrorKeepsRetryEditRemoveAndKeyboardComposerReachable() {
        lateinit var state: NativeState
        val emitted = mutableListOf<JSONObject>()
        val queue = params("id" to "failed", "title" to "仍待发送的消息", "subtitle" to "发送失败：连接中断，请检查设备网关状态后重试。".repeat(8),
            "command" to params("name" to "queue.send", "params" to params("id" to "failed", "contextId" to "device:context:1")),
            "actions" to JSONArray().put(params("id" to "edit", "title" to "编辑", "command" to params("name" to "queue.edit")))
                .put(params("id" to "remove", "title" to "移除", "command" to params("name" to "queue.remove"))))
        ui.setContent {
            state = remember { NativeState { emitted.add(it) }.also { it.receive(NativeSnapshot.decode(layoutSnapshot().put("queued", JSONArray().put(queue)))) } }
            CodexMaterialTheme("light") { NativeApp(state) }
        }
        ui.onNodeWithTag("native-composer-input").performClick()
        ui.waitUntil(5000) {
            var visible = false
            ui.runOnUiThread { visible = androidx.core.view.ViewCompat.getRootWindowInsets(ui.activity.window.decorView)?.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()) == true }
            visible
        }
        ui.waitForIdle()
        android.os.SystemClock.sleep(400)
        ui.onNodeWithTag("native-composer-input").performTextInput("继续输入，不被错误遮挡")
        // 用真实滑动露出长错误后的动作，避免仅语义点击在裁切区外也能触发而误报通过。
        ui.onNodeWithTag("native-composer-supplements").performTouchInput { swipeUp() }
        listOf("native-queue-primary-failed" to "queue.send", "native-queue-action-failed-edit" to "queue.edit", "native-queue-action-failed-remove" to "queue.remove").forEach { (tag, name) ->
            ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
            ui.mainClock.advanceTimeBy(1000); ui.waitForIdle()
            val action = ui.onNodeWithTag(tag).getUnclippedBoundsInRoot()
            val supplements = ui.onNodeWithTag("native-composer-supplements").getUnclippedBoundsInRoot()
            val composer = ui.onNodeWithTag("native-composer-surface").getUnclippedBoundsInRoot()
            assertTrue("队列操作必须完整处于滚动可见区: action=$action supplements=$supplements composer=$composer",
                action.top >= supplements.top && action.bottom <= supplements.bottom && action.bottom <= composer.top)
            ui.onNodeWithTag(tag).performTouchInput { click(center) }
            ui.runOnIdle { assertEquals(name, emitted.last().string("name")) }
        }
        saveScreenshot("queue-error-keyboard-light.png")
        ui.onNodeWithTag("native-composer-input").assertIsDisplayed()
        ui.onNodeWithTag("native-send").assertIsDisplayed()
        var keyboardTop = 0
        ui.runOnUiThread {
            val decor = ui.activity.window.decorView
            keyboardTop = decor.height - (androidx.core.view.ViewCompat.getRootWindowInsets(decor)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())?.bottom ?: 0)
        }
        val sendBounds = ui.onNodeWithTag("native-send").fetchSemanticsNode().boundsInWindow
        val rootBounds = ui.onNodeWithTag("android-native-root").fetchSemanticsNode().boundsInWindow
        assertEquals("键盘不能把页头移出窗口", 0f, rootBounds.top, 1f)
        ui.onNodeWithContentDescription("打开侧栏").assertIsDisplayed()
        assertTrue("发送按钮必须完整处于键盘上方", sendBounds.bottom <= keyboardTop + 1f)
        assertTrue("输入区应贴近键盘上缘，不应出现重复避让留白: root=$rootBounds send=$sendBounds keyboardTop=$keyboardTop", keyboardTop - sendBounds.bottom < 100)
        ui.runOnIdle { state.dispose() }
    }

    private fun layoutSnapshot(model: String = "GPT-6.1"): JSONObject = fixtureSnapshot().put("model", model)
        .put("title", "页面布局与交互优化").put("effort", "High")
        .put("models", JSONArray().put(params("id" to "model", "title" to model, "value" to "model")))

    private fun saveScreenshot(name: String) {
        ui.mainClock.advanceTimeBy(1500); ui.waitForIdle()
        android.os.SystemClock.sleep(350)
        val file = File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null), name)
        file.outputStream().use { InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}

/** debug manifest 在首次窗口 attach 前采用 MainActivity 相同的 adjustResize。 */
internal fun prepareNativeTestWindow(activity: ComponentActivity) {
    activity.enableEdgeToEdge()
    val declaredMode = activity.packageManager.getActivityInfo(activity.componentName, 0).softInputMode
    assertEquals(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE,
        declaredMode and WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST)
}
