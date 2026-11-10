package com.app.pakeplus.nativeui

import android.annotation.SuppressLint
import android.net.Uri
import android.util.Base64
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.MediaController
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

@Composable
internal fun NativeMediaCard(state: NativeState, item: NativeItem) {
    if (item.kind == "image") {
        ElevatedCard(onClick = { state.preview = item }, modifier = Modifier.fillMaxWidth()) {
            NativeImage(source = item.value, description = item.title.ifEmpty { "图片，点击预览" },
                contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().heightIn(min = 100.dp, max = 300.dp))
        }
    } else if (item.kind == "html") {
        OutlinedCard(onClick = { state.preview = item }, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp)) {
                NativeHTML(state, item.value, Modifier.fillMaxWidth().height(200.dp))
                TextButton(onClick = { state.preview = item }) { Text(item.title.ifEmpty { "打开预览" }); Icon(Icons.Default.OpenInFull, null, Modifier.size(16.dp)) }
            }
        }
    } else OutlinedCard(onClick = { state.preview = item }, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FilledIconButton(onClick = { state.preview = item }) { Icon(Icons.Default.PlayArrow, "播放") }
            Column(Modifier.weight(1f)) {
                Text(item.title.ifEmpty { if (item.kind == "audio") "音频" else "视频" }, style = MaterialTheme.typography.titleSmall)
                Text("点击播放", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
internal fun NativeMediaPreview(state: NativeState, item: NativeItem) {
    Dialog(onDismissRequest = { state.preview = null }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().systemBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { state.preview = null }) { Icon(Icons.Default.Close, "关闭预览") }
                    Text(item.title.ifEmpty { "预览" }, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 1)
                }
                when (item.kind) {
                    "image" -> ZoomableImage(item.previewURL.ifEmpty { item.value }, Modifier.weight(1f))
                    "html" -> NativeHTML(state, item.value, Modifier.fillMaxWidth().weight(1f))
                    "audio", "video" -> NativeVideo(state, item.value, Modifier.fillMaxWidth().weight(1f))
                }
            }
        }
    }
}

@Composable
private fun ZoomableImage(source: String, modifier: Modifier) {
    var scale by remember(source) { mutableFloatStateOf(1f) }
    var offset by remember(source) { mutableStateOf(Offset.Zero) }
    val transformation = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 8f)
        offset = if (scale > 1f) offset + pan else Offset.Zero
    }
    val animated by animateFloatAsState(scale, NativeMotion.spatial(), label = "image-zoom")
    Box(modifier.fillMaxWidth().transformable(transformation).pointerInput(source) {
        detectTapGestures(onDoubleTap = { scale = if (scale > 1f) 1f else 2.5f; offset = Offset.Zero })
    }, contentAlignment = Alignment.Center) {
        NativeImage(source = source, description = "图片预览，双指缩放或双击放大", contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize().graphicsLayer {
                scaleX = if (transformation.isTransformInProgress) scale else animated
                scaleY = scaleX; translationX = offset.x; translationY = offset.y
            })
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun NativeHTML(state: NativeState, source: String, modifier: Modifier) {
    // 预览是隔离文档，无业务桥、持久存储或本地文件权限。
    AndroidView(factory = { WebView(it).apply {
        settings.javaScriptEnabled = !source.trimStart().startsWith("<svg")
        settings.domStorageEnabled = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        setBackgroundColor(android.graphics.Color.TRANSPARENT)
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.isForMainFrame) state.openLink(request.url.toString())
                return true
            }
        }
    } }, update = { view ->
        if (view.tag != source) {
            view.tag = source
            view.loadDataWithBaseURL("https://preview.invalid/", source, "text/html", "UTF-8", null)
        }
    }, modifier = modifier, onRelease = { it.stopLoading(); it.destroy() })
}

@Composable
private fun NativeVideo(state: NativeState, source: String, modifier: Modifier) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var local by remember(source) { mutableStateOf<Uri?>(null) }
    var video by remember { mutableStateOf<VideoView?>(null) }
    val ownerContext = state.snapshot.context
    val temporary = remember(source) { java.util.concurrent.atomic.AtomicReference<File?>(null) }
    DisposableEffect(source) { onDispose { temporary.getAndSet(null)?.delete() } }
    LaunchedEffect(source) {
        try {
            local = withContext(Dispatchers.IO) {
                if (source.startsWith("data:")) {
                    val file = File.createTempFile("media-", ".preview", context.cacheDir)
                    temporary.set(file)
                    file.outputStream().use { it.write(Base64.decode(source.substringAfter(','), Base64.DEFAULT)) }
                    Uri.fromFile(file)
                } else Uri.parse(source).takeIf { it.scheme in listOf("https", "http") }
                    ?: throw IllegalArgumentException("媒体地址无效")
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            temporary.getAndSet(null)?.delete()
            if (state.snapshot.context == ownerContext) state.localError = "无法读取媒体文件，请重试"
        } finally { if (!currentCoroutineContext().isActive) temporary.getAndSet(null)?.delete() }
    }
    DisposableEffect(owner, local) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) video?.pause() }
        owner.lifecycle.addObserver(observer)
        onDispose {
            owner.lifecycle.removeObserver(observer); video?.stopPlayback()
        }
    }
    local?.let { uri -> AndroidView(factory = { VideoView(it).apply {
        video = this
        val player = this
        setMediaController(MediaController(context).apply { setAnchorView(player) })
        setOnPreparedListener { start() }
        setOnErrorListener { _, _, _ -> if (state.snapshot.context == ownerContext) state.localError = "媒体播放失败，请检查连接后重试"; true }
        setVideoURI(uri)
    } }, modifier = modifier, onRelease = { it.stopPlayback(); video = null }) }
}

@Composable
internal fun NativeFileDownload(state: NativeState, source: String, title: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var downloading by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    var chosenSource by remember { mutableStateOf("") }
    val ownerContext = state.snapshot.context
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { destination ->
        if (destination != null && state.snapshot.context == ownerContext) scope.launch {
            val downloadSource = chosenSource
            downloading = true; status = "正在保存…"
            try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(destination, "w")?.use { output ->
                        if (downloadSource.startsWith("data:")) {
                            output.write(Base64.decode(downloadSource.substringAfter(','), Base64.DEFAULT))
                        } else {
                            require(Uri.parse(downloadSource).scheme in listOf("http", "https")) { "文件地址无效" }
                            val connection = URL(downloadSource).openConnection() as HttpURLConnection
                            try {
                                connection.instanceFollowRedirects = false
                                connection.connectTimeout = 15000; connection.readTimeout = 30000
                                require(connection.responseCode in 200..299) { "下载失败，请检查连接" }
                                connection.inputStream.use { it.copyTo(output) }
                            } finally { connection.disconnect() }
                        }
                    } ?: throw IllegalStateException("无法写入所选位置")
                }
                status = "文件已保存"
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status = "保存失败，请重试"; if (state.snapshot.context == ownerContext) state.localError = status }
            finally { downloading = false }
        }
    }
    Column {
        OutlinedButton(onClick = {
            chosenSource = source
            picker.launch(title.substringAfterLast('/').replace(Regex("[\\\\\u0000-\u001f]"), "_").ifEmpty { "file" })
        }, enabled = !downloading) {
            if (downloading) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Default.Download, null)
            Spacer(Modifier.width(8.dp)); Text(title)
        }
        if (status.isNotEmpty()) Text(status, style = MaterialTheme.typography.labelSmall)
    }
}
