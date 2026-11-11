package com.app.pakeplus.nativeui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.remember
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.lang.ref.WeakReference
import org.json.JSONArray
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeNavigationTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()
    @Before fun matchProductionWindowInsets() {
        ui.runOnUiThread { prepareNativeTestWindow(ui.activity) }
    }

    @Test fun repeatedUpdatesReleaseOldConversationSnapshots() {
        lateinit var state: NativeState
        val old = mutableListOf<WeakReference<NativeSnapshot>>()
        ui.setContent {
            state = remember { NativeState {}.also { it.receive(NativeSnapshot.decode(fixtureSnapshot())) } }
            CodexMaterialTheme("light") { NativeApp(state) }
        }
        repeat(80) { revision ->
            ui.runOnIdle {
                old.add(WeakReference(state.snapshot))
                state.receive(NativeSnapshot.decode(fixtureSnapshot(revision = revision.toLong() + 1).put("title", "刷新 $revision")))
            }
            ui.waitForIdle()
        }
        ui.mainClock.advanceTimeBy(2000)
        ui.waitForIdle()
        // 等待 ART 完成引用处理，避免只请求一次 GC 就读取尚未清理的 WeakReference。
        repeat(10) { System.gc(); System.runFinalization(); Thread.sleep(100) }
        val retained = old.count { it.get() != null }
        assertTrue("80次更新后仍持有 $retained 份旧页面快照", retained <= 4)
        ui.onNodeWithText("刷新 79").assertIsDisplayed()
        ui.runOnIdle { state.dispose() }
    }

    @Test fun navigatingKeepsOutgoingContentUntilTheTransitionFinishes() {
        lateinit var state: NativeState
        fun page(context: String, text: String) = NativeSnapshot.decode(fixtureSnapshot(context = context)
            .put("title", text).put("messages", JSONArray()))
        ui.setContent {
            state = remember { NativeState {}.also { it.receive(page("old", "旧页面正文")) } }
            CodexMaterialTheme("light") { NativeApp(state) }
        }
        ui.onNodeWithText("旧页面正文").assertIsDisplayed()
        ui.mainClock.autoAdvance = false
        ui.runOnIdle { state.receive(page("new", "新页面正文")) }
        ui.mainClock.advanceTimeByFrame()
        ui.onNodeWithText("旧页面正文").assertExists()
        ui.onNodeWithText("新页面正文").assertExists()
        ui.mainClock.advanceTimeBy(3000)
        ui.mainClock.autoAdvance = true
        ui.waitForIdle()
        ui.onNodeWithText("新页面正文").assertIsDisplayed()
        ui.onNodeWithText("旧页面正文").assertDoesNotExist()
        ui.runOnIdle { state.dispose() }
    }
}
