package com.app.pakeplus.nativeui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeConversation(state: NativeState, snapshot: NativeSnapshot, onMenu: () -> Unit) {
    var more by remember(snapshot.context) { mutableStateOf(false) }
    val list = androidx.compose.foundation.lazy.rememberLazyListState()
    val scope = rememberCoroutineScope()
    var follow by remember(snapshot.context) { mutableStateOf(true) }
    var autoScrolling by remember { mutableStateOf(false) }
    LaunchedEffect(list) {
        snapshotFlow { list.isScrollInProgress }.collect { scrolling ->
            if (!autoScrolling && scrolling) follow = false
            if (!autoScrolling && !scrolling) follow = !list.canScrollForward
        }
    }
    val tail = snapshot.messages.lastOrNull()
    LaunchedEffect(tail?.id, tail?.text?.length, snapshot.busy) {
        if (follow && list.layoutInfo.totalItemsCount > 0) {
            autoScrolling = true
            list.scrollToItem(list.layoutInfo.totalItemsCount - 1)
            autoScrolling = false
        }
    }
    Scaffold(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding(),
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(title = {
                Column {
                    Text(if (snapshot.threadId.isEmpty()) "新对话" else snapshot.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleLarge)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        ConnectionDot(snapshot.connection == "online")
                        Text(listOf(snapshot.projectName, snapshot.backendName).filter(String::isNotEmpty).joinToString(" · ").ifEmpty { "Codex Mobile" },
                            maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }, navigationIcon = {
                IconButton(onClick = { if (snapshot.sidechatActive) state.dispatch(snapshot.command("sidechat.return")) else onMenu() }) {
                    Icon(if (snapshot.sidechatActive) Icons.Default.ArrowBack else Icons.Default.Menu, if (snapshot.sidechatActive) "返回主聊天" else "打开侧栏", Modifier.size(22.dp))
                }
            }, actions = {
                IconButton(onClick = { state.dispatch(snapshot.command("panel.open", params("id" to "workspace"))) }) { Icon(Icons.Default.PieChartOutline, "用量与会话设置", Modifier.size(20.dp)) }
                IconButton(onClick = { state.dispatch(NativeCommand("thread.new")) }) { Icon(Icons.Default.Edit, "新建对话", Modifier.size(20.dp)) }
                Box {
                    IconButton(onClick = { more = true }) {
                        BadgedBox(badge = { if (snapshot.approvalCount > 0) Badge { Text(snapshot.approvalCount.toString()) } }) { Icon(Icons.Default.MoreHoriz, "对话菜单", Modifier.size(22.dp)) }
                    }
                    DropdownMenu(expanded = more, onDismissRequest = { more = false }) {
                        (snapshot.actions.filter { it.command?.name != "thread.older" } + snapshot.sidechatActions).forEach { item ->
                            DropdownMenuItem(text = { Text(item.title.ifEmpty { item.text }) }, enabled = !item.disabled, onClick = {
                                more = false; state.dispatch(item.command)
                            })
                        }
                        DropdownMenuItem(text = { Text("设置") }, onClick = { more = false; state.dispatch(NativeCommand("settings.open", params("id" to "settings"))) })
                    }
                }
            }, windowInsets = WindowInsets(0, 0, 0, 0), colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface))
        }, bottomBar = {
            if (snapshot.backends.isNotEmpty()) NativeComposer(state, snapshot)
        }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (snapshot.sidechatActive) Surface(color = MaterialTheme.colorScheme.tertiaryContainer) {
                Text("Sidechat · 文件目录与主聊天共享", Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), style = MaterialTheme.typography.labelMedium)
            }
            val error = state.localError.ifEmpty { snapshot.error }
            AnimatedVisibility(error.isNotEmpty(), enter = fadeIn(NativeMotion.effects()), exit = fadeOut(NativeMotion.effects())) {
                Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(start = NativeSpacing.medium, end = NativeSpacing.small), verticalAlignment = Alignment.CenterVertically) {
                        Text(error, modifier = Modifier.weight(1f).padding(vertical = NativeSpacing.medium), style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = { if (snapshot.ready) state.dispatch(NativeCommand("navigation.refresh")) else state.restartBusiness() }) { Text("重试") }
                    }
                }
            }
            if (snapshot.loading.isNotEmpty() && snapshot.loading != "ready") LinearProgressIndicator(Modifier.fillMaxWidth())
            Box(Modifier.fillMaxSize()) {
                if (snapshot.backends.isEmpty() && !snapshot.navigationLoading) {
                    NativeWelcome(state, "连接你的 Codex", "添加运行网关的电脑，即可查看和继续真实会话。")
                } else if (snapshot.messages.isEmpty() && snapshot.threadId.isEmpty()) {
                    NativeWelcome(state, "有什么想一起完成？", "从一个问题开始，或从侧栏继续已有工作。", addDevice = false)
                } else {
                    LazyColumn(state = list, modifier = Modifier.fillMaxSize().testTag("native-messages"),
                        contentPadding = PaddingValues(start = NativeSpacing.medium, end = NativeSpacing.medium, top = NativeSpacing.medium, bottom = NativeSpacing.large),
                        verticalArrangement = Arrangement.spacedBy(NativeSpacing.large)) {
                        snapshot.actions.firstOrNull { it.command?.name == "thread.older" }?.let { older ->
                            item(key = "load-older") { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { TextButton(onClick = { state.dispatch(older.command) }, enabled = !older.disabled) { Text(older.title) } } }
                        }
                        items(snapshot.messages, key = { it.id }) { message ->
                            NativeMessageView(state, snapshot, message, Modifier.animateItem(fadeInSpec = NativeMotion.effects(), fadeOutSpec = NativeMotion.effects()))
                        }
                        if (snapshot.busy) item(key = "running") {
                            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                Text("正在执行…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                androidx.compose.animation.AnimatedVisibility(visible = !follow && snapshot.messages.isNotEmpty(), modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp)) {
                    SmallFloatingActionButton(onClick = {
                        scope.launch {
                            autoScrolling = true
                            if (list.layoutInfo.totalItemsCount > 0) list.animateScrollToItem(list.layoutInfo.totalItemsCount - 1)
                            follow = true; autoScrolling = false
                        }
                    }) { Icon(Icons.Default.ArrowDownward, "回到最新消息") }
                }
            }
        }
    }
}

@Composable
private fun NativeWelcome(state: NativeState, title: String, subtitle: String, addDevice: Boolean = true) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.primaryContainer) {
            Icon(Icons.Default.AutoAwesome, null, Modifier.padding(18.dp).size(32.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
        }
        Spacer(Modifier.height(18.dp)); Text(title, style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp)); Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (addDevice) { Spacer(Modifier.height(24.dp)); Button(onClick = { state.dispatch(NativeCommand("settings.open", params("id" to "devices"))) }, modifier = Modifier.testTag("native-connect-device")) { Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("添加设备") } }
    }
}
