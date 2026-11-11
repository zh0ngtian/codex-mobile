package com.app.pakeplus.nativeui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.selection.toggleable
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import org.json.JSONArray

@Composable
internal fun NativePanelItemView(state: NativeState, item: NativeItem, scope: String) {
    when (item.kind) {
        "section" -> Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Column(Modifier.fillMaxWidth().animateContentSize(NativeMotion.spatial()).padding(NativeSpacing.medium), verticalArrangement = Arrangement.spacedBy(NativeSpacing.medium)) {
                if (item.title.isNotEmpty()) Text(item.title, style = MaterialTheme.typography.titleMedium)
                if (item.text.isNotEmpty()) SelectionContainer { Text(item.text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                item.children.forEach { child -> key(child.id) { NativePanelItemView(state, child, scope) } }
            }
        }
        "disclosure" -> {
            var expanded by remember(scope, item.id) { mutableStateOf(false) }
            val rotation by animateFloatAsState(if (expanded) 180f else 0f, NativeMotion.spatial(), label = "disclosure-chevron")
            Column(Modifier.fillMaxWidth().animateContentSize(NativeMotion.spatial())) {
                Surface(onClick = { expanded = !expanded }, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(NativeSpacing.medium), verticalAlignment = Alignment.CenterVertically) {
                        Text(item.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
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
            modifier = Modifier.fillMaxWidth().heightIn(min = NativeSpacing.touchTarget).testTag("native-action-${item.id}"),
            // 长说明会撑高列表项，胶囊弧线会裁掉首尾行；内容型操作使用标准容器圆角。
            shape = if (item.text.isNotEmpty()) MaterialTheme.shapes.large else ButtonDefaults.shape) {
            Column(Modifier.fillMaxWidth().padding(vertical = NativeSpacing.small), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(item.title, style = MaterialTheme.typography.labelLarge)
                if (item.text.isNotEmpty()) Text(item.text, style = MaterialTheme.typography.bodyMedium)
            }
        }
        "textField", "secureField", "multilineField" -> NativePanelField(state, item, scope)
        "singleChoice" -> {
            var expanded by remember(scope, item.id) { mutableStateOf(false) }
            Box(Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = { expanded = true }, enabled = !item.disabled, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("native-choice-${item.id}"), shape = MaterialTheme.shapes.small,
                    contentPadding = PaddingValues(NativeSpacing.medium)) {
                    Text(item.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.width(NativeSpacing.medium))
                    Text(item.options.find { it.value == item.value }?.title ?: item.value,
                        Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.End)
                    Icon(Icons.Default.ExpandMore, null, Modifier.padding(start = 8.dp).size(18.dp))
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    item.options.forEach { option -> NativeOptionMenuItem(option, option.value == item.value) {
                        expanded = false; state.dispatch(item.command, params("value" to option.value))
                    } }
                }
            }
        }
        "toggle" -> NativeSwitchRow(item.title, item.value == "true", { state.dispatch(item.command, params("value" to it)) },
            subtitle = item.text, enabled = !item.disabled, modifier = Modifier.testTag("native-toggle-${item.id}"))
        "multiChoice" -> Column {
            Text(item.title, style = MaterialTheme.typography.titleSmall)
            val selected = item.raw.optJSONArray("values")?.let { values -> (0 until values.length()).map { values.optString(it) } } ?: emptyList()
            item.options.forEach { option ->
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).toggleable(value = option.value in selected, enabled = !item.disabled, role = Role.Checkbox, onValueChange = { checked ->
                        state.dispatch(item.command, params("values" to JSONArray(if (checked) selected + option.value else selected - option.value)))
                    }).padding(vertical = NativeSpacing.small), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(NativeSpacing.medium)) {
                    Checkbox(checked = option.value in selected, enabled = !item.disabled, onCheckedChange = null)
                    Text(option.title, style = MaterialTheme.typography.bodyLarge)
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
        Column(Modifier.padding(NativeSpacing.medium), verticalArrangement = Arrangement.spacedBy(NativeSpacing.small)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(title.ifEmpty { if (diff) "Diff" else "代码" }, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, maxLines = 1)
                IconButton(onClick = { copyNativeText(context, text) }, modifier = Modifier.size(NativeSpacing.touchTarget)) { Icon(Icons.Default.ContentCopy, "复制代码", Modifier.size(20.dp)) }
            }
            val scroll = rememberScrollState()
            SelectionContainer { Text(text, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                modifier = if (wrap) Modifier.fillMaxWidth() else Modifier.fillMaxWidth().horizontalScroll(scroll)) }
        }
    }
}

/** 弹出项保留同一图标栏宽度，选中态同时使用颜色、勾选和语义。 */
@Composable
internal fun NativeOptionMenuItem(option: NativeOption, isSelected: Boolean, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    DropdownMenuItem(text = {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(option.title, style = MaterialTheme.typography.bodyLarge)
            if (option.subtitle.isNotEmpty()) Text(option.subtitle, style = MaterialTheme.typography.bodyMedium,
                color = if (isSelected) scheme.onSecondaryContainer else scheme.onSurfaceVariant)
        }
    }, leadingIcon = { Box(Modifier.size(24.dp)) { if (isSelected) Icon(Icons.Default.Check, null) } },
        colors = MenuDefaults.itemColors(textColor = if (isSelected) scheme.onSecondaryContainer else scheme.onSurface,
            leadingIconColor = if (isSelected) scheme.onSecondaryContainer else scheme.onSurfaceVariant),
        modifier = Modifier.heightIn(min = NativeSpacing.touchTarget)
            .background(if (isSelected) scheme.secondaryContainer else scheme.surfaceContainer)
            .semantics { selected = isSelected }, onClick = onClick)
}

/** 整行只提供一个开关操作，点击标题与 Switch 执行同一命令。 */
@Composable
internal fun NativeSwitchRow(title: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit,
    subtitle: String = "", enabled: Boolean = true, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().heightIn(min = 56.dp).toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
        .padding(horizontal = NativeSpacing.medium, vertical = NativeSpacing.small),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(NativeSpacing.medium)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else 0.38f))
            if (subtitle.isNotEmpty()) Text(subtitle, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (enabled) 1f else 0.38f))
        }
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}
