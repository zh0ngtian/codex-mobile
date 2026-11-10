package com.app.pakeplus.nativeui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

@Composable
internal fun NativeComposer(state: NativeState, snapshot: NativeSnapshot) {
    val focus = LocalFocusManager.current
    val requester = remember(snapshot.context) { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(snapshot.raw.string("quoteFocusToken"), snapshot.context) {
        if (snapshot.raw.string("quoteFocusToken").isNotEmpty() && snapshot.context == state.snapshot.context && !snapshot.readOnly) {
            requester.requestFocus(); keyboard?.show()
        }
    }
    var attachments by remember(snapshot.context) { mutableStateOf(false) }
    var configuration by remember(snapshot.context) { mutableStateOf("") }
    var quoteExpanded by remember(snapshot.context) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().animateContentSize(NativeMotion.spatial()).padding(horizontal = 12.dp, vertical = 8.dp)) {
        // 补充内容独立滚动，软键盘出现及连续排队时仍保留输入与停止/发送区。
        val extraHeight = (LocalConfiguration.current.screenHeightDp * 0.22f).dp.coerceAtMost(200.dp)
        Column(Modifier.fillMaxWidth().heightIn(max = extraHeight).verticalScroll(rememberScrollState())) {
        if (snapshot.queued.isNotEmpty()) {
            snapshot.queued.forEach { queue ->
                Card(Modifier.fillMaxWidth().padding(bottom = 6.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                    Column(Modifier.padding(12.dp)) {
                        Text(queue.subtitle.ifEmpty { "排队中" }, style = MaterialTheme.typography.labelSmall)
                        Text(queue.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                        Row {
                            if (queue.command != null) TextButton(onClick = { state.dispatch(queue.command) }) { Text(if (snapshot.busy) "改为引导" else "重试") }
                            queue.actions.forEach { action -> TextButton(onClick = { state.dispatch(action.command) }, enabled = !action.disabled) { Text(action.title) } }
                        }
                    }
                }
            }
        }
        if (snapshot.quotes.isNotEmpty()) {
            FilledTonalButton(onClick = { quoteExpanded = !quoteExpanded }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.FormatQuote, null); Spacer(Modifier.width(8.dp)); Text("${snapshot.quotes.size} 条引用", Modifier.weight(1f)); Icon(if (quoteExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
            }
            AnimatedVisibility(quoteExpanded) {
                Column { snapshot.quotes.forEach { quote ->
                    Row(Modifier.fillMaxWidth().padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(quote.string("text"), Modifier.weight(1f), maxLines = 3, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                        IconButton(onClick = { state.dispatch(snapshot.command("quote.remove", params("id" to quote.string("id")))) }) { Icon(Icons.Default.Close, "移除引用") }
                    }
                } }
            }
        }
        if (snapshot.attachments.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            snapshot.attachments.forEach { attachment ->
                InputChip(selected = false, onClick = {
                    val command = NativeCommand.decode(attachment.optJSONObject("command"))
                    if (command != null) state.dispatch(command)
                    else if (attachment.string("imageURL").isNotEmpty()) state.preview = NativeItem(params("id" to attachment.string("id"), "kind" to "image", "value" to attachment.string("imageURL"), "title" to attachment.string("name")))
                }, label = { Text(attachment.string("name"), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 160.dp)) },
                    leadingIcon = { if (attachment.string("imageURL").isNotEmpty()) NativeImage(source = attachment.string("imageURL"), description = null, modifier = Modifier.size(28.dp)) else Icon(Icons.Default.AttachFile, null) },
                    trailingIcon = { IconButton(onClick = { state.dispatch(snapshot.command("attachment.remove", params("id" to attachment.string("id")))) }, modifier = Modifier.size(28.dp)) { Icon(Icons.Default.Close, "移除附件", Modifier.size(16.dp)) } })
            }
        }
        }
        Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerHigh, tonalElevation = 1.dp) {
            Column(Modifier.fillMaxWidth().padding(8.dp)) {
                TextField(value = state.draft, onValueChange = { state.editDraft(it, snapshot.context) }, enabled = !snapshot.readOnly && snapshot.context.isNotEmpty() && snapshot.context == state.snapshot.context,
                    placeholder = { Text(if (snapshot.readOnly) "当前会话只读" else if (snapshot.busy) "继续输入，消息将排队发送" else "发消息给 Codex…") },
                    minLines = 1, maxLines = 7, modifier = Modifier.fillMaxWidth().focusRequester(requester).testTag("native-composer-input"),
                    colors = TextFieldDefaults.colors(focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh, disabledContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        IconButton(onClick = { attachments = true }, enabled = !snapshot.readOnly) { Icon(Icons.Default.Add, "添加附件") }
                        DropdownMenu(expanded = attachments, onDismissRequest = { attachments = false }) {
                            listOf(Triple("照片和视频", Icons.Default.Photo, snapshot.command("attachment.pick", params("kind" to "photos"))),
                                Triple("文件", Icons.Default.AttachFile, snapshot.command("attachment.pick", params("kind" to "files"))),
                                Triple("当前位置", Icons.Default.LocationOn, snapshot.command("location.insert"))).forEach { (label, icon, command) ->
                                DropdownMenuItem(text = { Text(label) }, leadingIcon = { Icon(icon, null) }, onClick = { attachments = false; state.dispatch(command) })
                            }
                        }
                    }
                    Box(Modifier.weight(1f)) {
                        TextButton(onClick = { configuration = "model" }, enabled = !snapshot.readOnly && !snapshot.pending, modifier = Modifier.fillMaxWidth()) {
                            Text(listOf(snapshot.model, snapshot.effort).filter(String::isNotEmpty).joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge)
                            Icon(Icons.Default.KeyboardArrowDown, null, Modifier.size(16.dp))
                        }
                        NativeConfigurationMenu(configuration == "model", { configuration = "" }, state, snapshot, "模型", snapshot.models, snapshot.modelValue, "model.select", snapshot.efforts)
                    }
                    Box {
                        IconButton(onClick = { configuration = "permission" }, enabled = !snapshot.readOnly && !snapshot.pending) { Icon(Icons.Default.Security, "权限模式") }
                        NativeConfigurationMenu(configuration == "permission", { configuration = "" }, state, snapshot, "权限模式", snapshot.permissions, snapshot.permissionValue, "permission.select")
                    }
                    Box {
                        IconButton(onClick = { configuration = "speed" }, enabled = !snapshot.readOnly && !snapshot.pending) { Icon(Icons.Default.Bolt, "运行速度", tint = if (snapshot.speedValue in listOf("priority", "fast")) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant) }
                        NativeConfigurationMenu(configuration == "speed", { configuration = "" }, state, snapshot, "运行速度", snapshot.speeds, snapshot.speedValue, "speed.select")
                    }
                    if (snapshot.canInterrupt) IconButton(onClick = { state.dispatch(snapshot.command("turn.stop")) }, modifier = Modifier.testTag("native-stop")) { Icon(Icons.Default.StopCircle, "停止执行", tint = MaterialTheme.colorScheme.error) }
                    FilledIconButton(onClick = { state.send(snapshot.context); focus.clearFocus() }, enabled = snapshot.canSend && !state.sending && !snapshot.readOnly && snapshot.context == state.snapshot.context,
                        modifier = Modifier.size(44.dp).testTag("native-send")) {
                        AnimatedContent(targetState = state.sending, label = "send-state") { sending ->
                            if (sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Default.ArrowUpward, "发送")
                        }
                    }
                }
            }
        }
        if (snapshot.threadId.isEmpty() && snapshot.backends.isNotEmpty()) TextButton(onClick = { state.dispatch(snapshot.command("panel.open", params("id" to "workspace"))) }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text(listOf(snapshot.backendName, snapshot.projectName).filter(String::isNotEmpty).joinToString(" · ").ifEmpty { "选择设备与项目" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun NativeConfigurationMenu(expanded: Boolean, dismiss: () -> Unit, state: NativeState, snapshot: NativeSnapshot,
    title: String, options: List<NativeOption>, selected: String, command: String, efforts: List<NativeOption> = emptyList()) {
    // 弹出时捕获创建上下文，旧菜单不会把选择发送到新会话。
    val context = remember(expanded) { snapshot.context }
    DropdownMenu(expanded = expanded, onDismissRequest = dismiss) {
        Text(title, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        options.forEach { option -> DropdownMenuItem(text = {
            Column { Text(option.title); if (option.subtitle.isNotEmpty()) Text(option.subtitle, style = MaterialTheme.typography.bodySmall) }
        }, leadingIcon = { if (option.value == selected) Icon(Icons.Default.Check, null) }, onClick = {
            dismiss(); state.dispatch(NativeCommand(command, params("value" to option.value, "contextId" to context)))
        }) }
        if (efforts.isNotEmpty()) {
            HorizontalDivider(); Text("推理强度", Modifier.padding(16.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            efforts.forEach { option -> DropdownMenuItem(text = { Text(option.title) }, leadingIcon = { if (option.value == snapshot.effortValue) Icon(Icons.Default.Check, null) }, onClick = {
                dismiss(); state.dispatch(NativeCommand("effort.select", params("value" to option.value, "contextId" to context)))
            }) }
        }
    }
}
