package com.app.pakeplus.nativeui

import android.widget.TextView
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.espresso.matcher.RootMatchers.isPlatformPopup
import androidx.test.espresso.NoMatchingViewException
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeSelectionTest {
    @get:Rule val ui = createComposeRule()
    @Test fun tableColumnsAndTheRealAndroidSelectionMenuKeepTheirTableSource() {
        val emitted = render("| 字段 | 值 |\n| --- | --- |\n| 项目 | 表格选文 |")
        waitForText("字段"); waitForText("值")
        quote("表格选文")
        assertQuote(emitted, "table")
    }
    @Test fun codeInsideAQuotationUsesTheCodeSource() {
        val emitted = render("> 引用说明\n>\n> ```kotlin\n> nestedQuoteCode()\n> ```")
        quote("nestedQuoteCode()")
        assertQuote(emitted, "code")
    }
    @Test fun codeInsideAListUsesTheCodeSource() {
        val emitted = render("- 列表说明\n\n    ```kotlin\n    nestedListCode()\n    ```")
        quote("nestedListCode()")
        assertQuote(emitted, "code")
    }
    @Test fun aFileCitationOpensItsEncodedPathWithoutDisablingTextSelection() {
        var opened = ""
        ui.setContent {
            val state = androidx.compose.runtime.remember { NativeState {}.also {
                it.receive(NativeSnapshot.decode(fixtureSnapshot())); it.openLink = { link -> opened = link }
            } }
            CodexMaterialTheme("light") { NativeMarkdown(state, ":codex-file-citation{path=\"/Users/test/中文 文件.kt\"}") }
        }
        waitForText("中文 文件.kt")
        onView(withText("中文 文件.kt")).perform(GeneralClickAction(Tap.SINGLE, { view ->
            val location = IntArray(2); view.getLocationOnScreen(location)
            val label = view as TextView
            floatArrayOf(location[0] + label.totalPaddingLeft + label.layout.getPrimaryHorizontal(1),
                location[1] + label.totalPaddingTop + label.layout.getLineBottom(0) / 2f)
        }, Press.FINGER))
        ui.runOnIdle { assertEquals("/Users/test/%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.kt", opened) }
    }
    private fun render(markdown: String): MutableList<JSONObject> {
        val emitted = mutableListOf<JSONObject>()
        ui.setContent {
            val state = androidx.compose.runtime.remember { NativeState { emitted.add(it) }.also { it.receive(NativeSnapshot.decode(fixtureSnapshot())) } }
            CodexMaterialTheme("light") {
                NativeMarkdown(state, markdown, params("backendId" to "device", "threadId" to "thread-1", "turnId" to "turn-1", "itemId" to "answer", "region" to "body", "revision" to "original"))
            }
        }
        return emitted
    }
    private fun waitForText(text: String) {
        ui.waitUntil(5000) {
            try { onView(withText(text)).check(matches(isDisplayed())); true } catch (_: NoMatchingViewException) { false }
        }
    }
    private fun quote(text: String) {
        waitForText(text)
        // 在实际文字上长按，避免宽单元格中央的留白。
        onView(withText(text)).perform(GeneralClickAction(Tap.LONG, { view ->
            val location = IntArray(2); view.getLocationOnScreen(location)
            val label = view as TextView
            floatArrayOf(location[0] + label.totalPaddingLeft + label.layout.getPrimaryHorizontal(1),
                location[1] + label.totalPaddingTop + label.layout.getLineBottom(0) / 2f)
        }, Press.FINGER))
        // 系统浮动工具栏属于非焦点 popup；额外动作可能收在“更多”中。
        try {
            onView(org.hamcrest.Matchers.allOf(withText("引用到输入"), isDisplayed())).inRoot(isPlatformPopup()).check(matches(isDisplayed()))
        } catch (_: NoMatchingViewException) {
            onView(withContentDescription("More options")).inRoot(isPlatformPopup()).perform(ViewActions.click())
        }
        onView(org.hamcrest.Matchers.allOf(withText("引用到输入"), isDisplayed())).inRoot(isPlatformPopup()).perform(ViewActions.click())
    }
    private fun assertQuote(emitted: List<JSONObject>, region: String) {
        ui.runOnIdle {
            val command = emitted.single { it.string("name") == "message.quote" }.getJSONObject("params")
            assertEquals(region, command.getJSONObject("source").string("region"))
            assertEquals("original", command.getJSONObject("source").string("revision"))
            assertTrue(command.string("text").isNotEmpty())
            assertEquals("device:context:1", command.string("contextId"))
        }
    }
}
