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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun NativeSidebar(state: NativeState, onClose: () -> Unit) {
    val snapshot = state.snapshot
    val search = state.search
    var devices by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().testTag("native-sidebar")) {
        Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 12.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Codex", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            IconButton(onClick = { state.dispatch(NativeCommand("navigation.refresh")) }) { Icon(Icons.Default.Refresh, "刷新会话") }
            IconButton(onClick = onClose) { Icon(Icons.Default.Close, "关闭侧栏") }
        }
        OutlinedTextField(value = search, onValueChange = state::editSearch,
            placeholder = { Text("搜索会话") }, leadingIcon = { Icon(Icons.Default.Search, null) },
            trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { state.editSearch("") }) { Icon(Icons.Default.Close, "清除搜索") } },
            singleLine = true, shape = MaterialTheme.shapes.extraLarge,
            modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("native-search"))
        Box(Modifier.padding(horizontal = 16.dp)) {
            FilledTonalButton(onClick = { devices = true }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.Devices, null); Spacer(Modifier.width(8.dp))
                Text(snapshot.backends.find { it.string("id") == snapshot.raw.string("listBackendId") }?.string("title") ?: "全部设备", modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Default.KeyboardArrowDown, null)
            }
            DropdownMenu(expanded = devices, onDismissRequest = { devices = false }) {
                DropdownMenuItem(text = { Text("全部设备") }, onClick = { devices = false; state.dispatch(NativeCommand("backend.select", params("id" to "all"))) })
                snapshot.backends.forEach { backend ->
                    DropdownMenuItem(text = { Text(backend.string("title")) }, leadingIcon = { ConnectionDot(backend.optBoolean("connected")) }, onClick = {
                        devices = false; state.dispatch(NativeCommand("backend.select", params("id" to backend.string("id"))))
                    })
                }
                HorizontalDivider()
                DropdownMenuItem(text = { Text("管理设备") }, leadingIcon = { Icon(Icons.Default.Settings, null) }, onClick = {
                    devices = false; onClose(); state.dispatch(NativeCommand("settings.open", params("id" to "devices")))
                })
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(top = 8.dp), contentPadding = PaddingValues(bottom = 12.dp)) {
            if (snapshot.navigationLoading) item { LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp)) }
            items(snapshot.groups, key = { it.id }) { group ->
                Column(Modifier.animateItem().animateContentSize(NativeMotion.spatial())) {
                    val rotation by animateFloatAsState(if (group.collapsed) -90f else 0f, NativeMotion.spatial(), label = "project-chevron")
                    Row(Modifier.fillMaxWidth().combinedClickable(enabled = group.command != null,
                        onClick = { state.dispatch(group.command) }, onLongClick = {})
                        .padding(start = 24.dp, end = 12.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (group.category == "pinned") Icons.Default.PushPin else Icons.Default.Folder, null,
                            tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(10.dp))
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
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { onClose(); state.dispatch(NativeCommand("settings.open", params("id" to "settings"))) }) { Icon(Icons.Default.Settings, "设置") }
            IconButton(onClick = { onClose(); state.dispatch(NativeCommand("drafts.open")) }) { Icon(Icons.Default.Drafts, "草稿箱") }
            Spacer(Modifier.weight(1f))
            ExtendedFloatingActionButton(onClick = { state.dispatch(NativeCommand("thread.new")); onClose() },
                icon = { Icon(Icons.Default.Edit, null) }, text = { Text("新对话") }, modifier = Modifier.testTag("native-new-chat"))
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
            shape = MaterialTheme.shapes.extraLarge,
            color = if (entry.selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp)) {
            Row(Modifier.combinedClickable(onClick = { state.dispatch(entry.command); onClose() }, onLongClick = { expanded = true })
                .padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (entry.running) { CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp); Spacer(Modifier.width(10.dp)) }
                else if (entry.unread) { Badge(); Spacer(Modifier.width(10.dp)) }
                Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                    Text(entry.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (entry.unread || entry.selected) FontWeight.SemiBold else FontWeight.Normal)
                    if (entry.subtitle.isNotEmpty()) Text(entry.subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { expanded = true }) { Icon(Icons.Default.MoreVert, "会话操作", Modifier.size(18.dp)) }
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
