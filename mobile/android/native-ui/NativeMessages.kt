package com.app.pakeplus.nativeui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.text.DateFormat
import java.util.Date

@Composable
internal fun NativeMessageView(state: NativeState, snapshot: NativeSnapshot, message: NativeMessage, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val user = message.role == "user"
    Column(modifier.fillMaxWidth().animateContentSize(NativeMotion.spatial()), verticalArrangement = Arrangement.spacedBy(6.dp),
        horizontalAlignment = if (user) Alignment.End else Alignment.Start) {
        if (message.commentary.isNotEmpty()) {
            var expanded by remember(message.id) { mutableStateOf(message.commentaryRunning) }
            LaunchedEffect(message.commentaryRunning) { expanded = message.commentaryRunning }
            TextButton(onClick = { expanded = !expanded }) {
                Icon(Icons.Default.History, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
                Text("执行过程 (${message.commentary.size})"); Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
            }
            AnimatedVisibility(expanded) {
                Column(Modifier.padding(start = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    message.commentary.forEach { entry ->
                        key(entry.string("id")) {
                            NativeMarkdown(state, entry.string("text"), entry.optJSONObject("quoteSource"))
                            entry.items("blocks").forEach { NativePanelItemView(state, it, "commentary:${entry.string("id")}") }
                        }
                    }
                }
            }
        }
        message.historyEdit?.let { panel ->
            Card { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(panel.title, style = MaterialTheme.typography.titleMedium)
                panel.items.forEach { NativePanelItemView(state, it, "history:${snapshot.context}:${message.id}:${panel.id}") }
            } }
        } ?: run {
            val references = message.raw.optJSONArray("references").objects()
            references.forEachIndexed { index, reference ->
                var expanded by remember(message.id, index) { mutableStateOf(false) }
                OutlinedCard(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("引用 ${index + 1}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(reference.string("text"), maxLines = if (expanded) Int.MAX_VALUE else 2, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            if (message.text.isNotEmpty()) {
                if (user) Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.widthIn(max = 340.dp)) {
                    Box(Modifier.padding(horizontal = NativeSpacing.medium, vertical = 12.dp)) { NativeMarkdown(state, message.text, message.quoteSource, plain = true) }
                } else NativeMarkdown(state, message.text, message.quoteSource)
            }
            message.blocks.filter { it.id != message.raw.string("commentaryBlockId") || message.commentary.isEmpty() }
                .forEach { NativePanelItemView(state, it, "message:${message.id}") }
        }
        if (message.timestamp > 0 && message.role != "activity") Text(
            DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(if (message.timestamp < 100000000000.0) (message.timestamp * 1000).toLong() else message.timestamp.toLong())),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (message.actions.isNotEmpty() && message.historyEdit == null) Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            message.actions.forEach { item ->
                IconButton(onClick = {
                    if (item.command?.name == "message.copy") copyNativeText(context, message.rawText) else state.dispatch(item.command)
                }, enabled = !item.disabled, modifier = Modifier.size(NativeSpacing.touchTarget)) {
                    Icon(if (item.command?.name == "message.edit") Icons.Default.Edit else Icons.Default.ContentCopy, item.title, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
