package com.app.pakeplus.nativeui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.json.JSONArray

@Composable
internal fun NativePanelItemView(state: NativeState, item: NativeItem, scope: String) {
    when (item.kind) {
        "section" -> Column(Modifier.fillMaxWidth().animateContentSize(NativeMotion.spatial()).padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (item.title.isNotEmpty()) Text(item.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            if (item.text.isNotEmpty()) SelectionContainer { Text(item.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            item.children.forEach { child -> key(child.id) { NativePanelItemView(state, child, scope) } }
            HorizontalDivider()
        }
        "disclosure" -> {
            var expanded by remember(scope, item.id) { mutableStateOf(false) }
            val rotation by animateFloatAsState(if (expanded) 180f else 0f, NativeMotion.spatial(), label = "disclosure-chevron")
            Column(Modifier.fillMaxWidth().animateContentSize(NativeMotion.spatial())) {
                Surface(onClick = { expanded = !expanded }, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(item.title, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                        Icon(Icons.Default.ExpandMore, if (expanded) "收起" else "展开", Modifier.rotate(rotation))
                    }
                }
                AnimatedVisibility(expanded) {
                    Column(Modifier.padding(top = 8.dp, start = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (item.text.isNotEmpty()) Text(item.text, style = MaterialTheme.typography.bodySmall)
                        item.children.forEach { child -> key(child.id) { NativePanelItemView(state, child, scope) } }
                    }
                }
            }
        }
        "action" -> FilledTonalButton(onClick = { state.dispatch(item.command) }, enabled = !item.disabled,
            modifier = Modifier.fillMaxWidth().testTag("native-action-${item.id}"), shape = MaterialTheme.shapes.medium) {
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Text(item.title)
                if (item.text.isNotEmpty()) Text(item.text, style = MaterialTheme.typography.bodySmall)
            }
        }
        "textField", "secureField", "multilineField" -> NativePanelField(state, item, scope)
        "singleChoice" -> {
            var expanded by remember(scope, item.id) { mutableStateOf(false) }
            Box(Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = { expanded = true }, enabled = !item.disabled, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium) {
                    Text(item.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.width(12.dp))
                    Text(item.options.find { it.value == item.value }?.title ?: item.value,
                        Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.End)
                    Icon(Icons.Default.ExpandMore, null, Modifier.padding(start = 8.dp).size(18.dp))
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    item.options.forEach { option -> DropdownMenuItem(text = {
                        Column { Text(option.title); if (option.subtitle.isNotEmpty()) Text(option.subtitle, style = MaterialTheme.typography.bodySmall) }
                    }, leadingIcon = { if (option.value == item.value) Icon(Icons.Default.Check, null) }, onClick = {
                        expanded = false; state.dispatch(item.command, params("value" to option.value))
                    }) }
                }
            }
        }
        "toggle" -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(item.title, Modifier.weight(1f)); Switch(checked = item.value == "true", enabled = !item.disabled, onCheckedChange = { state.dispatch(item.command, params("value" to it)) })
        }
        "multiChoice" -> Column {
            Text(item.title, style = MaterialTheme.typography.titleSmall)
            val selected = item.raw.optJSONArray("values")?.let { values -> (0 until values.length()).map { values.optString(it) } } ?: emptyList()
            item.options.forEach { option ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = option.value in selected, enabled = !item.disabled, onCheckedChange = { checked ->
                        state.dispatch(item.command, params("values" to JSONArray(if (checked) selected + option.value else selected - option.value)))
                    }); Text(option.title)
                }
            }
        }
        "markdown" -> NativeMarkdown(state, item.text)
        "source", "code", "diff" -> NativeCode(item.text, item.title, item.kind == "diff", state.codeWrap)
        "image", "html", "video", "audio" -> NativeMediaCard(state, item)
        "file" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (item.command != null) OutlinedButton(onClick = { state.dispatch(item.command) }, enabled = !item.disabled) { Icon(Icons.Default.Description, null); Spacer(Modifier.width(8.dp)); Text(item.title.ifEmpty { "查看文件" }) }
            if (item.value.isNotEmpty()) NativeFileDownload(state, item.value, item.title.ifEmpty { "file" })
        }
        "link" -> TextButton(onClick = { state.openLink(item.value) }) { Text(item.title.ifEmpty { item.value }) }
        else -> SelectionContainer {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (item.title.isNotEmpty()) Text(item.title, style = MaterialTheme.typography.titleSmall)
                if (item.text.isNotEmpty()) Text(item.text, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun NativePanelField(state: NativeState, item: NativeItem, scope: String) {
    val fieldKey = listOf(state.snapshot.context, scope, item.id).joinToString("|") { "${it.toByteArray().size}:$it" }
    var value by remember(fieldKey) { mutableStateOf(item.value) }
    var revision by remember(fieldKey) { mutableLongStateOf(0) }
    val acknowledged = state.fieldAcknowledgements[fieldKey] ?: 0L
    LaunchedEffect(item.value, acknowledged) { if (acknowledged >= revision && value != item.value) value = item.value }
    OutlinedTextField(value = value, onValueChange = {
        value = it; revision = state.nextFieldRevision()
        state.dispatch(item.command, params("value" to it, "fieldKey" to fieldKey, "fieldRevision" to revision))
    }, label = { Text(item.title) }, enabled = !item.disabled,
        singleLine = item.kind != "multilineField", minLines = if (item.kind == "multilineField") 3 else 1,
        maxLines = if (item.kind == "multilineField") 10 else 1,
        visualTransformation = if (item.kind == "secureField") PasswordVisualTransformation() else VisualTransformation.None,
        textStyle = MaterialTheme.typography.bodyLarge,
        supportingText = if (item.text.isEmpty()) null else ({ Text(item.text, style = MaterialTheme.typography.bodySmall) }),
        modifier = Modifier.fillMaxWidth().testTag("native-field-${item.id}"))
}

@Composable
internal fun NativeCode(text: String, title: String = "", diff: Boolean = false, wrap: Boolean = true) {
    val context = androidx.compose.ui.platform.LocalContext.current
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(title.ifEmpty { if (diff) "Diff" else "代码" }, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, maxLines = 1)
                IconButton(onClick = { copyNativeText(context, text) }, modifier = Modifier.size(36.dp)) { Icon(Icons.Default.ContentCopy, "复制代码", Modifier.size(18.dp)) }
            }
            val scroll = rememberScrollState()
            SelectionContainer { Text(text, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                modifier = if (wrap) Modifier.fillMaxWidth() else Modifier.fillMaxWidth().horizontalScroll(scroll)) }
        }
    }
}
