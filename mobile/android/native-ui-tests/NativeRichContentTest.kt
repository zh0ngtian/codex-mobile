package com.app.pakeplus.nativeui

import android.graphics.Bitmap
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import coil.request.ImageRequest
import coil.request.SuccessResult
import io.noties.markwon.Markwon
import org.commonmark.node.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import kotlinx.coroutines.runBlocking
import java.io.ByteArrayOutputStream

@RunWith(AndroidJUnit4::class)
class NativeRichContentTest {
    @Test fun dataUriImageLoadsThroughTheSameLoaderUsedByAttachmentsAndPreviews() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val output = ByteArrayOutputStream()
        Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, output)
        val uri = "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
        val result = NativeImages.loader(context).execute(ImageRequest.Builder(context).data(uri).build())
        assertTrue(result.toString(), result is SuccessResult)
        assertEquals(4, (result as SuccessResult).drawable.intrinsicWidth)
    }
    @Test fun fileCitationsUseClickableEncodedPathsAndLeaveCodeAndLinksUntouched() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val markwon = Markwon.create(context)
        val root = markwon.parse("引用 :codex-file-citation{path=\"/Users/test/中文 文件.kt\"}。\n\n`:codex-file-citation{path=\"/Users/test/code.kt\"}`\n\n[原链接 :codex-file-citation{path=\"/Users/test/link.kt\"}](https://example.com)")
        nativeFileReferences(root)
        val links = mutableListOf<Link>()
        root.accept(object : AbstractVisitor() { override fun visit(link: Link) { links.add(link); visitChildren(link) } })
        assertEquals(2, links.size)
        assertEquals("/Users/test/%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.kt", links.first().destination)
        assertEquals("中文 文件.kt", (links.first().firstChild as Text).literal)
        assertEquals("https://example.com", links.last().destination)
        val unsafe = markwon.parse(":codex-file-citation{path=\"/Users/test/../secret\"}")
        nativeFileReferences(unsafe)
        assertTrue(markwon.render(unsafe).toString().contains("codex-file-citation"))
    }
    @Test fun tableAndCodeSourcesKeepTheOriginalRevisionAndCommentaryIdentity() {
        val source = params("region" to "body", "revision" to "10:abcdef", "itemId" to "message")
        assertEquals("table", nativeQuoteRegion(source, "table")!!.string("region"))
        assertEquals("code", nativeQuoteRegion(source, "code")!!.string("region"))
        assertEquals("10:abcdef", nativeQuoteRegion(source, "table")!!.string("revision"))
        assertEquals("body", source.string("region"))
        assertEquals("commentary", nativeQuoteRegion(params("region" to "commentary"), "code")!!.string("region"))
    }
}
