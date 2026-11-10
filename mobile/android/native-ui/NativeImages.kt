package com.app.pakeplus.nativeui

import android.content.Context
import android.graphics.drawable.Drawable
import android.net.Uri
import android.util.Base64
import android.widget.TextView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.decode.DataSource
import coil.decode.ImageSource
import coil.decode.SvgDecoder
import coil.fetch.Fetcher
import coil.fetch.SourceResult
import coil.request.Disposable
import coil.request.ImageRequest
import coil.request.Options
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.MarkwonSpansFactory
import io.noties.markwon.image.AsyncDrawable
import io.noties.markwon.image.AsyncDrawableLoader
import io.noties.markwon.image.AsyncDrawableScheduler
import io.noties.markwon.image.ImageSpanFactory
import io.noties.markwon.utils.DrawableUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okio.Buffer
import org.commonmark.node.Image
import java.util.WeakHashMap

/** 草稿及共享富内容使用 data URI；在 IO 调度器解码，所有原生图片共用同一缓存。 */
internal class NativeDataImageFetcher(private val uri: Uri, private val options: Options) : Fetcher {
    override suspend fun fetch(): SourceResult = withContext(Dispatchers.IO) {
        val value = uri.toString()
        val header = value.substringBefore(',')
        require(header.endsWith(";base64")) { "图片编码无效" }
        SourceResult(ImageSource(Buffer().write(Base64.decode(value.substringAfter(','), Base64.DEFAULT)), options.context),
            header.removePrefix("data:").substringBefore(';'), DataSource.MEMORY)
    }
    class Factory : Fetcher.Factory<Uri> {
        override fun create(data: Uri, options: Options, imageLoader: ImageLoader): Fetcher? =
            if (data.scheme == "data") NativeDataImageFetcher(data, options) else null
    }
}

internal object NativeImages {
    @Volatile private var shared: ImageLoader? = null
    fun loader(context: Context): ImageLoader = shared ?: synchronized(this) {
        shared ?: ImageLoader.Builder(context.applicationContext).components {
            add(NativeDataImageFetcher.Factory()); add(SvgDecoder.Factory())
        }.build().also { shared = it }
    }
}

@Composable
internal fun NativeImage(source: String, description: String?, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Fit) {
    val context = LocalContext.current
    val loader = remember(context) { NativeImages.loader(context) }
    AsyncImage(model = source, imageLoader = loader, contentDescription = description, modifier = modifier, contentScale = contentScale)
}

/** Markwon 只负责 Span 布局，异步图片交给当前 Coil 2，共享 data URI 与 SVG 支持。 */
internal class NativeMarkdownImages(context: Context) : AbstractMarkwonPlugin() {
    private val imageLoader: ImageLoader = NativeImages.loader(context)
    private val requests = WeakHashMap<AsyncDrawable, Disposable>()
    private val loader: AsyncDrawableLoader = object : AsyncDrawableLoader() {
        override fun load(drawable: AsyncDrawable) {
            cancel(drawable)
            if (drawable.hasResult()) return
            var completed = false
            val request = ImageRequest.Builder(context.applicationContext).data(drawable.destination).target(
                onSuccess = { result ->
                    completed = true; requests.remove(drawable)
                    if (drawable.isAttached) { DrawableUtils.intrinsicBounds(result); drawable.setResult(result) }
                }, onError = { completed = true; requests.remove(drawable) }
            ).build()
            val disposable = imageLoader.enqueue(request)
            if (!completed) requests[drawable] = disposable
        }
        override fun cancel(drawable: AsyncDrawable) { requests.remove(drawable)?.dispose() }
        override fun placeholder(drawable: AsyncDrawable): Drawable? = null
    }
    override fun configureConfiguration(builder: MarkwonConfiguration.Builder) { builder.asyncDrawableLoader(loader) }
    override fun configureSpansFactory(builder: MarkwonSpansFactory.Builder) { builder.setFactory(Image::class.java, ImageSpanFactory()) }
    override fun beforeSetText(textView: TextView, markdown: android.text.Spanned) { AsyncDrawableScheduler.unschedule(textView) }
    override fun afterSetText(textView: TextView) { AsyncDrawableScheduler.schedule(textView) }
}
