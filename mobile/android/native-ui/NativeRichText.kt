package com.app.pakeplus.nativeui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Typeface
import android.text.Spanned
import android.view.GestureDetector
import android.view.MotionEvent
import android.text.style.ClickableSpan
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.widget.TextView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.MarkwonVisitor
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.image.AsyncDrawableScheduler
import org.commonmark.node.*
import org.commonmark.node.Text as MarkdownText
import org.commonmark.ext.gfm.tables.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal fun copyNativeText(context: Context, text: String) {
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
        .setPrimaryClip(ClipData.newPlainText("Codex Mobile", text))
}

internal fun markdownChildren(node: Node): List<Node> = buildList {
    var child = node.firstChild
    while (child != null) { add(child); child = child.next }
}

internal fun nativeQuoteRegion(source: JSONObject?, region: String): JSONObject? = source?.let {
    JSONObject(it.toString()).apply { if (string("region") == "body") put("region", region) }
}

internal data class NativeMarkdownBlock(val node: Node, val depth: Int = 0, val quoteDepth: Int = 0, val marker: String? = null)

internal fun nativeMarkdownBlocks(root: Node): List<NativeMarkdownBlock> {
    fun special(node: Node): Boolean = node is TableBlock || node is FencedCodeBlock || node is IndentedCodeBlock
    fun containsSpecial(node: Node): Boolean = special(node) || markdownChildren(node).any(::containsSpecial)
    fun split(nodes: List<Node>, depth: Int, quotes: Int): List<NativeMarkdownBlock> = buildList {
        var body: Document? = null
        for (node in nodes) {
            when {
                special(node) -> { body = null; add(NativeMarkdownBlock(node, depth, quotes)) }
                node is BlockQuote && containsSpecial(node) -> {
                    body = null; addAll(split(markdownChildren(node), depth + 1, quotes + 1))
                }
                node is ListBlock && containsSpecial(node) -> {
                    body = null
                    markdownChildren(node).forEachIndexed { index, item ->
                        val marker = if (node is OrderedList) "${node.startNumber + index}." else "•"
                        addAll(split(markdownChildren(item), depth + 1, quotes).mapIndexed { i, block ->
                            if (i == 0) block.copy(marker = listOfNotNull(marker, block.marker).joinToString(" ")) else block
                        })
                    }
                }
                else -> {
                    if (body == null) { body = Document(); add(NativeMarkdownBlock(body, depth, quotes)) }
                    body.appendChild(node)
                }
            }
        }
    }
    return split(markdownChildren(root), 0, 0)
}

/** 原始消息保持不变；仅在 CommonMark 的普通文本节点转换桌面文件引用。 */
internal fun nativeFileReferences(root: Node) {
    val roots = listOf("/Users/", "/home/", "/tmp/", "/private/", "/var/", "/opt/", "/workspace/", "/workspaces/", "/repo/", "/app/")
    fun fileLink(path: String, title: String): Link? {
        if (roots.none(path::startsWith) || path.any { it.code < 32 || it.code == 127 } ||
            path.drop(1).split('/').any { it.isEmpty() || it == "." || it == ".." } || Regex(":\\d+(?::\\d+)?$").containsMatchIn(path)) return null
        val href = path.split('/').joinToString("/") { Uri.encode(it) }
        if (Uri.decode(href) != path) return null
        return Link(href, null).also { it.appendChild(MarkdownText(title)) }
    }
    val directive = Regex("(?<!:):{1,2}codex-file-citation\\{")
    val attribute = Regex("\\s*([A-Za-z_][A-Za-z0-9_-]*)\\s*=\\s*(?:\"([^\"\\r\\n]*)\"|'([^'\\r\\n]*)')")
    val htmlTags = mutableListOf<String>()
    fun html(value: String) {
        Regex("<!--[\\s\\S]*?(?:-->|$)|<(/?)([A-Za-z][A-Za-z0-9-]*)\\b[^>]*>").findAll(value).forEach { match ->
            val name = match.groupValues[2].lowercase()
            if (name.isEmpty()) return@forEach
            if (match.groupValues[1] == "/") { val index = htmlTags.lastIndexOf(name); if (index >= 0) htmlTags.subList(index, htmlTags.size).clear() }
            else if (!match.value.endsWith("/>") && name !in listOf("area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr")) htmlTags.add(name)
        }
    }
    var attachments = false
    fun visit(node: Node, protected: Boolean = false) {
        if (node is HtmlInline) { html(node.literal); return }
        if (node is HtmlBlock) { html(node.literal); return }
        if (node is Code || node is FencedCodeBlock || node is IndentedCodeBlock) return
        if (node is Heading && node.parent === root && htmlTags.isEmpty()) {
            val title = markdownChildren(node).singleOrNull() as? MarkdownText
            if (node.level == 1) attachments = title?.literal?.trim() == "Files mentioned by the user:"
            if (node.level == 2 && title?.literal?.trim() == "My request:") attachments = false
            if (attachments && node.level == 2 && title != null) {
                val match = Regex("^(.+?):\\s+(/[^\\r\\n]+)$").matchEntire(title.literal)
                val link = match?.let { fileLink(it.groupValues[2], it.groupValues[1]) }
                if (link != null) { title.insertBefore(link); title.unlink(); return }
            }
        }
        if (node is MarkdownText && !protected && htmlTags.isEmpty()) {
            val value = node.literal
            var offset = 0; var cursor = 0
            while (cursor < value.length) {
                val match = directive.find(value, cursor) ?: break
                var end = match.range.last + 1; var depth = 1; var quote: Char? = null
                val start = end
                while (end < value.length && value[end] !in listOf('\n', '\r')) {
                    val ch = value[end]
                    if (quote != null) { if (ch == quote) quote = null }
                    else if (ch == '\'' || ch == '"') quote = ch
                    else if (ch == '{') depth++
                    else if (ch == '}' && --depth == 0) break
                    end++
                }
                cursor = end + 1
                if (depth != 0) continue
                val attrs = value.substring(start, end)
                var index = 0; var path: String? = null; var valid = true
                while (index < attrs.length && attrs.substring(index).isNotBlank()) {
                    val attr = attribute.find(attrs, index)
                    if (attr == null || attr.range.first != index) { valid = false; break }
                    if (attr.groupValues[1] == "path") { if (path != null) { valid = false; break }; path = attr.groupValues[2].ifEmpty { attr.groupValues[3] } }
                    index = attr.range.last + 1
                    if (index < attrs.length && !attrs[index].isWhitespace()) { valid = false; break }
                }
                val link = if (valid && path != null) fileLink(path, path.substringAfterLast('/')) else null
                if (link != null) {
                    if (match.range.first > offset) node.insertBefore(MarkdownText(value.substring(offset, match.range.first)))
                    node.insertBefore(link); offset = end + 1
                }
            }
            if (offset > 0) { if (offset < value.length) node.insertBefore(MarkdownText(value.substring(offset))); node.unlink() }
            return
        }
        markdownChildren(node).forEach { visit(it, protected || node is Link || node is Image) }
    }
    visit(root)
}

@Composable
private fun rememberNativeMarkwon(state: NativeState): Markwon {
    val context = LocalContext.current
    val ownerContext = state.snapshot.context
    return remember(context, ownerContext) {
        Markwon.builder(context).usePlugin(StrikethroughPlugin.create()).usePlugin(TablePlugin.create(context))
            .usePlugin(TaskListPlugin.create(context)).usePlugin(NativeMarkdownImages(context))
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureVisitor(builder: MarkwonVisitor.Builder) {
                    // 表格单元格由 Compose 单独布局，不使用 Markwon 的不可选绘制型行 Span。
                    builder.on(TableCell::class.java) { visitor, cell -> visitor.visitChildren(cell) }
                }
                override fun configureConfiguration(builder: MarkwonConfiguration.Builder) {
                    builder.linkResolver { _, link -> if (state.snapshot.context == ownerContext) state.openLink(link) }
                }
            }).build()
    }
}

/** CommonMark/GFM AST 分离代码和表格；TextView/Span 与 Compose 均为原生呈现。 */
@Composable
internal fun NativeMarkdown(state: NativeState, text: String, quoteSource: JSONObject? = null, plain: Boolean = false) {
    val markwon = rememberNativeMarkwon(state)
    val rich = state.snapshot.raw.items("richContent")
    val resolved = remember(text, rich.map { it.value }) {
        rich.filter { it.kind == "image" && it.text.isNotEmpty() }.fold(text) { source, image ->
            source.replace("(${image.text})", "(${image.value})").replace("<${image.text}>", "<${image.value}>")
        }
    }
    val blocks by produceState<List<NativeMarkdownBlock>>(emptyList(), resolved, plain, markwon) {
        value = if (plain) emptyList() else withContext(Dispatchers.Default) {
            nativeMarkdownBlocks(markwon.parse(resolved).also(::nativeFileReferences))
        }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (plain) NativeSelectableText(state, text, quoteSource, plain = true)
        else blocks.forEachIndexed { index, block -> key(index) {
            val outline = MaterialTheme.colorScheme.outlineVariant
            Row(Modifier.fillMaxWidth().drawBehind {
                repeat(block.quoteDepth) { level ->
                    val x = (level * 12 + 2).dp.toPx()
                    drawLine(outline, Offset(x, 0f), Offset(x, size.height), 2.dp.toPx())
                }
            }.padding(start = (block.depth * 12).dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                block.marker?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Column(Modifier.weight(1f)) {
                when (val node = block.node) {
                is FencedCodeBlock, is IndentedCodeBlock -> {
                    val source = if (node is FencedCodeBlock) node.literal.trimEnd('\n') else (node as IndentedCodeBlock).literal.trimEnd('\n')
                    val language = (node as? FencedCodeBlock)?.info.orEmpty()
                    if (language.lowercase() == "mermaid") {
                        val resource = rich.find { it.kind == "html" && it.text == source }
                        if (resource != null) NativeMediaCard(state, resource)
                        else { LaunchedEffect(source) { state.dispatch(state.snapshot.command("diagram.render", params("source" to source))) }; NativeCode(source, "Mermaid") }
                    } else Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                        Column(Modifier.padding(12.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(language.ifEmpty { "代码" }, style = MaterialTheme.typography.labelSmall)
                                val context = LocalContext.current
                                IconButton(onClick = { copyNativeText(context, source) }, modifier = Modifier.size(24.dp)) { androidx.compose.material3.Text("复制", style = MaterialTheme.typography.labelSmall) }
                            }
                            NativeSelectableText(state, source, nativeQuoteRegion(quoteSource, "code"), plain = true, code = true)
                        }
                    }
                }
                is TableBlock -> {
                    val source = nativeQuoteRegion(quoteSource, "table")
                    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerLow) {
                        Column(Modifier.horizontalScroll(rememberScrollState()).padding(8.dp)) {
                            markdownChildren(node).flatMap(::markdownChildren).forEach { row ->
                                Row { markdownChildren(row).forEach { cell ->
                                    Box(Modifier.width(180.dp).padding(10.dp)) { NativeSelectableText(state, "", source, node = cell, renderer = markwon) }
                                } }
                                HorizontalDivider()
                            }
                        }
                    }
                }
                else -> NativeSelectableText(state, "", quoteSource, node = node, renderer = markwon)
                }
                }
            }
        } }
    }
}

@Composable
private fun NativeSelectableText(state: NativeState, text: String, quoteSource: JSONObject?, plain: Boolean = false, code: Boolean = false, node: Node? = null, renderer: Markwon? = null) {
    val context = LocalContext.current
    val color = MaterialTheme.colorScheme.onSurface.toArgb()
    val linkColor = MaterialTheme.colorScheme.primary.toArgb()
    val scale = state.snapshot.raw.optDouble("fontScale", 1.0).toFloat()
    val ownerContext = state.snapshot.context
    val fallback = rememberNativeMarkwon(state)
    val markwon = renderer ?: fallback
    var rendered by remember { mutableStateOf<Spanned?>(null) }
    LaunchedEffect(text, node, plain, markwon) {
        if (!plain) rendered = withContext(Dispatchers.Default) { if (node != null) markwon.render(node) else markwon.toMarkdown(text) }
    }
    AndroidView(factory = { TextView(it).apply {
        setTextIsSelectable(true)
        setPadding(0, 0, 0, 0)
        includeFontPadding = false
        setLineSpacing(0f, 1.3f)
        if (code) typeface = Typeface.MONOSPACE
        // 保留 ArrowKeyMovementMethod 的原生选文；只为实际链接单击分发 Span。
        val label = this
        val taps = GestureDetector(it, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(event: MotionEvent) = true
            override fun onSingleTapUp(event: MotionEvent): Boolean {
                val spans = label.text as? Spanned ?: return false
                val offset = label.getOffsetForPosition(event.x, event.y)
                val link = spans.getSpans(offset, offset, ClickableSpan::class.java).firstOrNull() ?: return false
                link.onClick(label)
                return true
            }
        })
        setOnTouchListener { _, event -> taps.onTouchEvent(event); false }
    } }, modifier = Modifier.fillMaxWidth(), update = { view ->
        if (code) view.setHorizontallyScrolling(!state.codeWrap)
        view.setTextColor(color); view.setLinkTextColor(linkColor); view.textSize = (if (code) 13f else 16f) * scale
        if (plain) { if (view.text.toString() != text) view.text = text }
        else rendered?.let { if (view.tag !== it) { markwon.setParsedMarkdown(view, it); view.tag = it } }
        view.customSelectionActionModeCallback = object : ActionMode.Callback {
            override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
                if (quoteSource != null) {
                    menu.add(0, 61001, 20, "引用到输入")
                    if (!state.snapshot.sidechatActive) menu.add(0, 61002, 21, "在 Sidechat 中提问")
                }
                return true
            }
            override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = false
            override fun onDestroyActionMode(mode: ActionMode) {}
            override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
                if (item.itemId !in listOf(61001, 61002) || quoteSource == null) return false
                val start = minOf(view.selectionStart, view.selectionEnd).coerceAtLeast(0)
                val end = maxOf(view.selectionStart, view.selectionEnd).coerceAtMost(view.text.length)
                if (end <= start || state.snapshot.context != ownerContext) return true
                val selection = view.text.subSequence(start, end).toString()
                state.dispatch(NativeCommand(if (item.itemId == 61001) "message.quote" else "sidechat.quote",
                    params("source" to quoteSource, "renderedText" to selection, "start" to 0, "end" to selection.length,
                        "text" to selection, "contextId" to ownerContext)))
                mode.finish(); return true
            }
        }
    }, onRelease = { AsyncDrawableScheduler.unschedule(it) })
}
