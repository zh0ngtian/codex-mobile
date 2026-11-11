package com.app.pakeplus.nativeui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp

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
    Column(Modifier.fillMaxWidth().animateContentSize(NativeMotion.spatial()).padding(horizontal = NativeSpacing.medium, vertical = NativeSpacing.small)) {
        // 补充内容独立滚动，软键盘出现及连续排队时仍保留输入与停止/发送区。
        val extraHeight = (LocalConfiguration.current.screenHeightDp * 0.22f).dp.coerceAtMost(200.dp)
        Column(Modifier.fillMaxWidth().heightIn(max = extraHeight).testTag("native-composer-supplements").verticalScroll(rememberScrollState())) {
        if (snapshot.queued.isNotEmpty()) {
            snapshot.queued.forEach { queue ->
                Card(Modifier.fillMaxWidth().padding(bottom = NativeSpacing.small), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                    Column(Modifier.padding(NativeSpacing.medium), verticalArrangement = Arrangement.spacedBy(NativeSpacing.small)) {
                        Text(queue.subtitle.ifEmpty { "排队中" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
                        Text(queue.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        Row(Modifier.horizontalScroll(rememberScrollState())) {
                            if (queue.command != null) TextButton(onClick = { state.dispatch(queue.command) }, modifier = Modifier.heightIn(min = NativeSpacing.touchTarget).testTag("native-queue-primary-${queue.id}")) { Text(if (snapshot.busy) "改为引导" else "重试") }
                            queue.actions.forEach { action -> TextButton(onClick = { state.dispatch(action.command) }, enabled = !action.disabled,
                                modifier = Modifier.heightIn(min = NativeSpacing.touchTarget).testTag("native-queue-action-${queue.id}-${action.id}")) { Text(action.title) } }
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
                    trailingIcon = { IconButton(onClick = { state.dispatch(snapshot.command("attachment.remove", params("id" to attachment.string("id")))) }, modifier = Modifier.size(NativeSpacing.touchTarget)) { Icon(Icons.Default.Close, "移除附件", Modifier.size(20.dp)) } })
            }
        }
        }
        Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.testTag("native-composer-surface")) {
            Column(Modifier.fillMaxWidth().padding(NativeSpacing.small)) {
                BasicTextField(value = state.draft, onValueChange = { state.editDraft(it, snapshot.context) },
                    enabled = !snapshot.readOnly && snapshot.context.isNotEmpty() && snapshot.context == state.snapshot.context,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary), minLines = 1, maxLines = 6,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = NativeSpacing.small, vertical = NativeSpacing.small).heightIn(min = NativeSpacing.touchTarget)
                        .focusRequester(requester).testTag("native-composer-input"),
                    decorationBox = { input ->
                        Box {
                            if (state.draft.text.isEmpty()) Text(if (snapshot.readOnly) "当前会话只读" else if (snapshot.busy) "继续输入，消息将排队发送" else "发消息给 Codex…",
                                style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            input()
                        }
                    })
                // 配置独占一行，标准字阶下常用名称无需和固定操作争抢宽度。
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val choiceWidth = maxWidth * 0.7f
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).testTag("native-configuration-scroll"),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(NativeSpacing.small)) {
                        Box {
                            NativeComposerChoice(snapshot.model, "模型", "native-model", choiceWidth, !snapshot.readOnly && !snapshot.pending && snapshot.models.isNotEmpty()) { configuration = "model" }
                            NativeConfigurationMenu(configuration == "model", { configuration = "" }, state, snapshot, "模型", snapshot.models, snapshot.modelValue, "model.select")
                        }
                        Box {
                            NativeComposerChoice(snapshot.effort.ifEmpty { "强度" }, "推理强度", "native-effort", choiceWidth, !snapshot.readOnly && !snapshot.pending && snapshot.efforts.isNotEmpty()) { configuration = "effort" }
                            NativeConfigurationMenu(configuration == "effort", { configuration = "" }, state, snapshot, "推理强度", snapshot.efforts, snapshot.effortValue, "effort.select")
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = NativeSpacing.small).testTag("native-composer-tools"), verticalAlignment = Alignment.CenterVertically) {
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
                    Box {
                        IconButton(onClick = { configuration = "permission" }, enabled = !snapshot.readOnly && !snapshot.pending) { Icon(Icons.Default.Security, "权限模式") }
                        NativeConfigurationMenu(configuration == "permission", { configuration = "" }, state, snapshot, "权限模式", snapshot.permissions, snapshot.permissionValue, "permission.select")
                    }
                    Box {
                        IconButton(onClick = { configuration = "speed" }, enabled = !snapshot.readOnly && !snapshot.pending) { Icon(Icons.Default.Bolt, "运行速度", tint = if (snapshot.speedValue in listOf("priority", "fast")) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant) }
                        NativeConfigurationMenu(configuration == "speed", { configuration = "" }, state, snapshot, "运行速度", snapshot.speeds, snapshot.speedValue, "speed.select")
                    }
                    Spacer(Modifier.weight(1f))
                    if (snapshot.canInterrupt) IconButton(onClick = { state.dispatch(snapshot.command("turn.stop")) }, modifier = Modifier.testTag("native-stop")) { Icon(Icons.Default.StopCircle, "停止执行", tint = MaterialTheme.colorScheme.error) }
                    FilledIconButton(onClick = { state.send(snapshot.context); focus.clearFocus() }, enabled = snapshot.canSend && !state.sending && !snapshot.readOnly && snapshot.context == state.snapshot.context,
                        modifier = Modifier.size(48.dp).testTag("native-send")) {
                        AnimatedContent(targetState = state.sending, label = "send-state") { sending ->
                            if (sending) CircularProgressIndicator(Modifier.size(20.dp), color = LocalContentColor.current, strokeWidth = 2.dp) else Icon(Icons.Default.ArrowUpward, "发送")
                        }
                    }
                }
            }
        }
        if (snapshot.threadId.isEmpty() && snapshot.backends.isNotEmpty()) TextButton(onClick = { state.dispatch(snapshot.command("panel.open", params("id" to "workspace"))) }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text(listOf(snapshot.backendName, snapshot.projectName).filter(String::isNotEmpty).joinToString(" · ").ifEmpty { "选择设备与项目" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun NativeComposerChoice(title: String, label: String, tag: String, maxWidth: androidx.compose.ui.unit.Dp, enabled: Boolean, onClick: () -> Unit) {
    FilledTonalButton(onClick = onClick, enabled = enabled,
        contentPadding = PaddingValues(horizontal = NativeSpacing.medium),
        modifier = Modifier.heightIn(min = NativeSpacing.touchTarget).widthIn(max = maxWidth).testTag(tag)) {
        Text(title, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Spacer(Modifier.width(NativeSpacing.small))
        Icon(Icons.Default.ExpandMore, label, Modifier.size(18.dp))
    }
}

@Composable
private fun NativeConfigurationMenu(expanded: Boolean, dismiss: () -> Unit, state: NativeState, snapshot: NativeSnapshot,
    title: String, options: List<NativeOption>, selected: String, command: String) {
    // 弹出时捕获创建上下文，旧菜单不会把选择发送到新会话。
    val context = remember(expanded) { snapshot.context }
    DropdownMenu(expanded = expanded, onDismissRequest = dismiss) {
        Text(title, Modifier.padding(horizontal = NativeSpacing.medium, vertical = NativeSpacing.small), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        options.forEach { option -> NativeOptionMenuItem(option, option.value == selected) {
            dismiss(); state.dispatch(NativeCommand(command, params("value" to option.value, "contextId" to context)))
        } }
    }
}
