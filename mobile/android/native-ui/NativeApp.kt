package com.app.pakeplus.nativeui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeApp(state: NativeState) {
    val snapshot = state.snapshot
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    LaunchedEffect(snapshot.context) { focus.clearFocus(force = true) }
    var retainedPanel by remember(snapshot.context) { mutableStateOf(snapshot.panel) }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true,
        confirmValueChange = { state.snapshot.panel?.dismissible != false || it != SheetValue.Hidden })
    LaunchedEffect(snapshot.panel, snapshot.context) {
        if (snapshot.panel != null) retainedPanel = snapshot.panel
        else if (retainedPanel != null) { sheet.hide(); retainedPanel = null }
    }
    LaunchedEffect(snapshot.sidebarOpen) {
        if (snapshot.sidebarOpen) drawer.open() else drawer.close()
    }
    LaunchedEffect(drawer) {
        snapshotFlow { drawer.currentValue }.collect { value ->
            val open = value == DrawerValue.Open
            if (state.snapshot.sidebarOpen != open) state.setSidebar(open)
        }
    }
    BackHandler(enabled = !drawer.isOpen) {
        when {
            state.preview != null -> state.preview = null
            snapshot.panel != null -> state.closePanel(snapshot.panel)
            snapshot.sidechatActive -> state.dispatch(snapshot.command("sidechat.return"))
            else -> scope.launch { drawer.open() }
        }
    }
    Surface(Modifier.fillMaxSize().testTag("android-native-root"), color = MaterialTheme.colorScheme.background) {
        ModalNavigationDrawer(drawerState = drawer,
            gesturesEnabled = snapshot.panel == null && state.preview == null,
            drawerContent = {
                ModalDrawerSheet(Modifier.fillMaxWidth(0.88f), drawerContainerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
                    NativeSidebar(state, onClose = { scope.launch { drawer.close() } })
                }
            }) {
            AnimatedContent(targetState = snapshot, contentKey = { it.context }, label = "conversation-navigation",
                transitionSpec = { (fadeIn(NativeMotion.effects()) + slideInHorizontally(NativeMotion.spatial()) { it / 12 })
                    .togetherWith(fadeOut(NativeMotion.effects()) + slideOutHorizontally(NativeMotion.spatial()) { -it / 16 }) }) { page ->
                NativeConversation(state, page, onMenu = { scope.launch { drawer.open() } })
            }
        }
        (snapshot.panel ?: retainedPanel)?.let { panel ->
            key(panel.id, snapshot.context) {
                ModalBottomSheet(onDismissRequest = { state.closePanel(panel) }, sheetState = sheet,
                    modifier = Modifier.testTag("native-panel")) {
                    Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState())
                        .padding(horizontal = 24.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(panel.title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                            if (panel.dismissible) IconButton(onClick = { state.closePanel(panel) }) { Icon(Icons.Default.Close, "关闭") }
                        }
                        if (panel.id == "settings:root") NativeAppearanceSettings(state)
                        panel.items.forEach { item -> key(item.id) { NativePanelItemView(state, item, panel.id) } }
                        if (panel.id == "settings:root") {
                            FilledTonalButton(onClick = { state.dispatch(NativeCommand("settings.open", params("id" to "devices"))) }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Default.Devices, null); Spacer(Modifier.width(8.dp)); Text("管理设备")
                            }
                        }
                    }
                }
            }
        }
        state.preview?.let { NativeMediaPreview(state, it) }
    }
}

@Composable
private fun NativeAppearanceSettings(state: NativeState) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("外观", style = MaterialTheme.typography.titleMedium)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色").forEachIndexed { index, (value, title) ->
                SegmentedButton(selected = state.appearance == value, onClick = { state.saveAppearance(value) },
                    shape = SegmentedButtonDefaults.itemShape(index, 3)) { Text(title) }
            }
        }
        Text("采用 Material You 配色；Android 12 及以上随系统壁纸动态取色。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("代码块自动换行", Modifier.weight(1f))
            Switch(checked = state.codeWrap, onCheckedChange = state.saveCodeWrap)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text("使用原生界面", style = MaterialTheme.typography.titleSmall)
                Text(state.preferenceNotice.ifEmpty { "更改后在下次完整启动 App 时生效" }, style = MaterialTheme.typography.bodySmall)
            }
            Switch(checked = state.savedNative, onCheckedChange = {
                state.dispatch(NativeCommand("settings.native-ui", params("enabled" to it)))
            }, modifier = Modifier.testTag("native-interface-switch"))
        }
        HorizontalDivider()
    }
}
