package com.app.pakeplus.nativeui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Surface
import androidx.compose.runtime.remember
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeMaterialTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()

    @Test fun settingsWholeRowTogglesOnceAndDisabledRowsCannotDispatch() {
        val emitted = mutableListOf<JSONObject>()
        lateinit var state: NativeState
        ui.setContent {
            state = remember { NativeState { emitted.add(it) } }
            CodexMaterialTheme("light") {
                Surface {
                    Column {
                        NativePanelItemView(state, NativeItem(params("id" to "notifications", "kind" to "toggle", "title" to "通知",
                            "value" to "false", "command" to params("name" to "settings.field", "params" to params("field" to "notifications")))), "settings")
                        NativePanelItemView(state, NativeItem(params("id" to "locked", "kind" to "toggle", "title" to "保存中不可修改",
                            "value" to "true", "disabled" to true, "command" to params("name" to "settings.field"))), "settings")
                    }
                }
            }
        }
        ui.onNodeWithTag("native-toggle-notifications").assertIsOff().performTouchInput { click(Offset(12f, centerY)) }
        ui.runOnIdle {
            assertEquals(1, emitted.size)
            assertEquals("notifications", emitted.single().getJSONObject("params").string("field"))
            assertTrue(emitted.single().getJSONObject("params").getBoolean("value"))
        }
        ui.onNodeWithTag("native-toggle-locked").assertIsOn().assertIsNotEnabled().performTouchInput { click(center) }
        ui.runOnIdle { assertEquals(1, emitted.size); state.dispose() }
    }

    @Test fun menuAnnouncesCurrentSelectionAndDispatchesTheChosenValueOnce() {
        val emitted = mutableListOf<JSONObject>()
        lateinit var state: NativeState
        ui.setContent {
            state = remember { NativeState { emitted.add(it) } }
            CodexMaterialTheme("dark") {
                Surface {
                    NativePanelItemView(state, NativeItem(params("id" to "language", "kind" to "singleChoice", "title" to "语言",
                        "value" to "system", "command" to params("name" to "settings.field", "params" to params("field" to "language")),
                        "options" to JSONArray().put(params("value" to "system", "title" to "跟随系统"))
                            .put(params("value" to "zh", "title" to "简体中文")))), "settings")
                }
            }
        }
        ui.onNodeWithTag("native-choice-language").performClick()
        ui.onAllNodesWithText("跟随系统").filter(hasAnyAncestor(isPopup())).onFirst().assertIsSelected()
        ui.onNodeWithText("简体中文").assertIsNotSelected().performClick()
        ui.onNode(isPopup()).assertDoesNotExist()
        ui.runOnIdle {
            assertEquals(1, emitted.size)
            assertEquals("zh", emitted.single().getJSONObject("params").string("value"))
            state.dispose()
        }
    }
}
