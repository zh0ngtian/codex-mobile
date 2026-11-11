package com.app.pakeplus.nativeui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun NativeSidebar(state: NativeState, onClose: () -> Unit) {
    val snapshot = state.snapshot
    val search = state.search
    var more by remember { mutableStateOf(false) }
    var searchVisible by remember { mutableStateOf(search.isNotEmpty()) }
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    LaunchedEffect(snapshot.sidebarOpen) { if (!snapshot.sidebarOpen) { searchVisible = false; more = false } }
    Column(Modifier.fillMaxSize().testTag("native-sidebar")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = {
                searchVisible = !searchVisible
                if (!searchVisible) { state.editSearch(""); focus.clearFocus() }
            }) { Icon(if (searchVisible) Icons.Default.Close else Icons.Default.Search, if (searchVisible) "关闭搜索" else "搜索会话", Modifier.size(22.dp)) }
            IconButton(onClick = { state.dispatch(NativeCommand("navigation.refresh")) }) { Icon(Icons.Default.Refresh, "刷新会话", Modifier.size(22.dp)) }
            Box {
                IconButton(onClick = { more = true }) { Icon(Icons.Default.MoreHoriz, "侧栏菜单", Modifier.size(22.dp)) }
                DropdownMenu(expanded = more, onDismissRequest = { more = false }) {
                    if (snapshot.backends.isNotEmpty()) {
                        Text("设备范围", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        DropdownMenuItem(text = { Text("全部设备") }, leadingIcon = {
                            Icon(if (snapshot.raw.string("listBackendId") in listOf("", "all")) Icons.Default.Check else Icons.Default.Devices, null)
                        }, onClick = { more = false; state.dispatch(NativeCommand("backend.select", params("id" to "all"))) })
                        snapshot.backends.forEach { backend ->
                            DropdownMenuItem(text = { Text(backend.string("title")) }, leadingIcon = {
                                if (backend.string("id") == snapshot.raw.string("listBackendId")) Icon(Icons.Default.Check, null)
                                else ConnectionDot(backend.optBoolean("connected"))
                            }, onClick = { more = false; state.dispatch(NativeCommand("backend.select", params("id" to backend.string("id")))) })
                        }
                        HorizontalDivider()
                    }
                    DropdownMenuItem(text = { Text("草稿箱") }, leadingIcon = { Icon(Icons.Default.Drafts, null) }, onClick = { more = false; onClose(); state.dispatch(NativeCommand("drafts.open")) })
                    DropdownMenuItem(text = { Text("管理设备") }, leadingIcon = { Icon(Icons.Default.Devices, null) }, onClick = { more = false; onClose(); state.dispatch(NativeCommand("settings.open", params("id" to "devices"))) })
                    DropdownMenuItem(text = { Text("设置") }, leadingIcon = { Icon(Icons.Default.Settings, null) }, onClick = { more = false; onClose(); state.dispatch(NativeCommand("settings.open", params("id" to "settings"))) })
                }
            }
            Spacer(Modifier.weight(1f))
            FilledTonalButton(onClick = { state.dispatch(NativeCommand("thread.new")); onClose() }, contentPadding = PaddingValues(horizontal = 12.dp), modifier = Modifier.testTag("native-new-chat")) {
                Icon(Icons.Default.Edit, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Chat")
            }
        }
        AnimatedVisibility(searchVisible, enter = expandVertically(NativeMotion.spatial()) + fadeIn(NativeMotion.effects()), exit = shrinkVertically(NativeMotion.spatial()) + fadeOut(NativeMotion.effects())) {
            val requester = remember { androidx.compose.ui.focus.FocusRequester() }
            LaunchedEffect(Unit) { requester.requestFocus() }
            OutlinedTextField(value = search, onValueChange = state::editSearch,
                placeholder = { Text("搜索会话") }, leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(20.dp)) },
                trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { state.editSearch("") }) { Icon(Icons.Default.Close, "清除搜索") } },
                singleLine = true, textStyle = MaterialTheme.typography.bodyMedium, shape = MaterialTheme.shapes.extraLarge,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 8.dp).focusRequester(requester).testTag("native-search"))
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(top = 8.dp), contentPadding = PaddingValues(bottom = 12.dp)) {
            if (snapshot.navigationLoading) item { LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp)) }
            items(snapshot.groups, key = { it.id }) { group ->
                Column(Modifier.animateItem().animateContentSize(NativeMotion.spatial())) {
                    val rotation by animateFloatAsState(if (group.collapsed) -90f else 0f, NativeMotion.spatial(), label = "project-chevron")
                    Row(Modifier.fillMaxWidth().combinedClickable(enabled = group.command != null,
                        onClick = { state.dispatch(group.command) }, onLongClick = {})
                        .heightIn(min = 48.dp).padding(start = 20.dp, end = 12.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (group.category == "pinned") Icons.Default.PushPin else Icons.Default.Folder, null,
                            tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(group.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                if (group.collapsed && group.allItems.any { it.running }) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp)
                                else if (group.collapsed && group.allItems.any { it.unread }) Badge(containerColor = MaterialTheme.colorScheme.primary)
                            }
                            if (group.subtitle.isNotEmpty()) Text(group.subtitle, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (group.newCommand != null) IconButton(onClick = { state.dispatch(group.newCommand); onClose() }) { Icon(Icons.Default.Add, "在项目中新建对话", Modifier.size(20.dp)) }
                        if (group.command != null) Icon(Icons.Default.ExpandMore, if (group.collapsed) "展开项目" else "收起项目", Modifier.rotate(rotation))
                    }
                    AnimatedVisibility(visible = !group.collapsed,
                        enter = expandVertically(NativeMotion.spatial()) + fadeIn(NativeMotion.effects()),
                        exit = shrinkVertically(NativeMotion.spatial()) + fadeOut(NativeMotion.effects())) {
                        Column {
                            group.items.forEach { entry -> key(entry.id) { NativeThreadRow(state, entry, onClose) } }
                            if (group.loading.isNotEmpty()) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp))
                            group.actions.forEach { NativePanelItemView(state, it, "navigation:${group.id}") }
                        }
                    }
                }
            }
            if (!snapshot.navigationLoading && snapshot.groups.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Default.ChatBubbleOutline, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.outline)
                    Text(if (search.isNotEmpty()) "没有找到匹配的会话" else if (snapshot.backends.isEmpty()) "添加设备，开始连接 Codex" else "暂无会话", style = MaterialTheme.typography.bodyMedium)
                    if (snapshot.backends.isEmpty()) Button(onClick = { onClose(); state.dispatch(NativeCommand("settings.open", params("id" to "devices"))) }) { Text("添加设备") }
                }
            }
        }

    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun NativeThreadRow(state: NativeState, entry: NativeEntry, onClose: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf<NativeCommand?>(null) }
    var title by remember(entry.title) { mutableStateOf(entry.title) }
    Box {
        Surface(onClick = { state.dispatch(entry.command); onClose() },
            shape = MaterialTheme.shapes.small,
            color = if (entry.selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp)) {
            Row(Modifier.combinedClickable(onClick = { state.dispatch(entry.command); onClose() }, onLongClick = { expanded = true })
                .heightIn(min = 48.dp).padding(start = 12.dp, end = 0.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(entry.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f, fill = false), fontWeight = if (entry.unread || entry.selected) FontWeight.Medium else FontWeight.Normal)
                        if (entry.running) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp)
                        else if (entry.unread) Badge(Modifier.size(6.dp), containerColor = MaterialTheme.colorScheme.primary)
                    }
                    if (entry.subtitle.isNotEmpty()) Text(entry.subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { expanded = true }, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.MoreVert, "会话操作", Modifier.size(18.dp)) }
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            entry.actions.forEach { item -> DropdownMenuItem(text = { Text(item.title) }, enabled = !item.disabled, onClick = {
                expanded = false
                if (item.command?.name == "thread.manage" && item.command.params.string("action") == "rename") rename = item.command
                else state.dispatch(item.command)
            }) }
        }
    }
    rename?.let { command -> AlertDialog(onDismissRequest = { rename = null }, title = { Text("重命名会话") },
        text = { OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("名称") }, singleLine = true) },
        confirmButton = { TextButton(onClick = { state.dispatch(command, params("value" to title)); rename = null }, enabled = title.isNotBlank()) { Text("保存") } },
        dismissButton = { TextButton(onClick = { rename = null }) { Text("取消") } }) }
}

@Composable
internal fun ConnectionDot(connected: Boolean) {
    Surface(color = if (connected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
        shape = MaterialTheme.shapes.extraLarge, modifier = Modifier.size(8.dp)) {}
}
