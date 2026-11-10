package com.app.pakeplus.nativeui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.app.pakeplus.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** 真实 Android WebView → React 业务 → Compose，独立安装身份下不配置或修改用户设备。 */
@RunWith(AndroidJUnit4::class)
class NativeHostTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    @Test fun embeddedBusinessBridgeOpensDeviceFormAndReturnsWithoutCreatingADevice() {
        ui.waitUntil(20000) { ui.onAllNodesWithText("连接你的 Codex").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("android-native-root").assertIsDisplayed()
        // 无设备冷启动可能已由共享业务打开首台设备表单。
        if (ui.onAllNodesWithTag("native-field-name").fetchSemanticsNodes().isEmpty()) {
            if (ui.onAllNodesWithTag("native-action-add").fetchSemanticsNodes().isEmpty()) {
                ui.onNodeWithTag("native-connect-device").performClick()
            }
            ui.waitUntil(10000) { ui.onAllNodesWithTag("native-action-add").fetchSemanticsNodes().isNotEmpty() || ui.onAllNodesWithTag("native-field-name").fetchSemanticsNodes().isNotEmpty() }
            if (ui.onAllNodesWithTag("native-field-name").fetchSemanticsNodes().isEmpty()) ui.onNodeWithTag("native-action-add").performClick()
        }
        ui.waitUntil(10000) { ui.onAllNodesWithTag("native-field-name").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("native-field-name").performTextReplacement("临时验收，不保存")
        ui.onNodeWithTag("native-field-gatewayUrl").assertIsDisplayed()
        ui.onNodeWithTag("native-action-cancel").performScrollTo().performClick()
        ui.waitUntil(10000) { ui.onAllNodesWithTag("native-action-add").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.waitUntil(10000) { ui.onAllNodesWithTag("native-panel").fetchSemanticsNodes().isEmpty() }
        ui.onNodeWithText("连接你的 Codex").assertIsDisplayed()
    }
}
