package com.app.pakeplus

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.appbar.MaterialToolbar
import kotlin.math.min

class InAppBrowserActivity : AppCompatActivity() {
    companion object {
        private const val EXTRA_URL = "codex-mobile-browser-url"
        private const val MENU_MORE = 7_001

        fun createIntent(context: Context, url: String): Intent =
            Intent(context, InAppBrowserActivity::class.java)
                .putExtra(EXTRA_URL, url)
    }

    private lateinit var toolbar: MaterialToolbar
    private lateinit var browserRoot: LinearLayout
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var initialUrl: String
    private lateinit var mobileUserAgent: String
    private var desktopMode = false
    private var fullscreen = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        initialUrl = intent.getStringExtra(EXTRA_URL).orEmpty()
        if (!isHttpUrl(initialUrl)) {
            finish()
            return
        }

        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = CHROME_BACKGROUND
        window.navigationBarColor = Color.BLACK
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = false
        }

        setContentView(createContentView())
        ViewCompat.setOnApplyWindowInsetsListener(browserRoot) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(
                systemBars.left,
                systemBars.top,
                systemBars.right,
                systemBars.bottom,
            )
            insets
        }
        configureWebView()

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(initialUrl)
        }
    }

    private fun createContentView(): View {
        browserRoot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }

        toolbar = MaterialToolbar(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48),
            )
            setBackgroundColor(CHROME_BACKGROUND)
            setTitleTextColor(CONTENT_COLOR)
            setTitleTextAppearance(
                this@InAppBrowserActivity,
                com.google.android.material.R.style.TextAppearance_MaterialComponents_Subtitle2,
            )
            title = "网页"
            elevation = 0f
            setNavigationIcon(R.drawable.ic_in_app_browser_close)
            navigationContentDescription = "关闭"
            setNavigationIconTint(CONTENT_COLOR)
            setNavigationOnClickListener { finish() }
            menu.add(Menu.NONE, MENU_MORE, Menu.NONE, "更多选项").apply {
                icon = getDrawable(
                    R.drawable.ic_in_app_browser_more,
                )
                setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
            }
            setOnMenuItemClickListener { item ->
                if (item.itemId != MENU_MORE) return@setOnMenuItemClickListener false
                findViewById<View>(MENU_MORE)?.let(::showActions)
                    ?: showActions(this)
                true
            }
        }

        progressBar = ProgressBar(
            this,
            null,
            android.R.attr.progressBarStyleHorizontal,
        ).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(2),
            )
            max = 100
            progressTintList = ColorStateList.valueOf(ACCENT_COLOR)
            progressBackgroundTintList = ColorStateList.valueOf(CHROME_BACKGROUND)
            visibility = View.INVISIBLE
        }

        webView = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
            setBackgroundColor(Color.WHITE)
        }

        browserRoot.addView(toolbar)
        browserRoot.addView(progressBar)
        browserRoot.addView(webView)
        return browserRoot
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = false
            builtInZoomControls = true
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = false
        }
        mobileUserAgent = webView.settings.userAgentString
        webView.webViewClient = BrowserClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView?, title: String?) {
                super.onReceivedTitle(view, title)
                updateTitle(title, view?.url)
            }

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                progressBar.progress = newProgress
                progressBar.visibility =
                    if (newProgress in 1..99) View.VISIBLE else View.INVISIBLE
            }
        }
        webView.setDownloadListener { url, _, _, _, _ ->
            if (!url.isNullOrBlank()) openInExternalBrowser(url)
        }
    }

    private inner class BrowserClient : WebViewClient() {
        private fun handleUrl(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            if (isHttpUrl(rawUrl)) return false
            if (
                rawUrl.startsWith("about:", ignoreCase = true) ||
                rawUrl.startsWith("javascript:", ignoreCase = true) ||
                rawUrl.startsWith("data:", ignoreCase = true) ||
                rawUrl.startsWith("blob:", ignoreCase = true)
            ) return false

            if (!openExternalIntent(rawUrl)) {
                Toast.makeText(
                    this@InAppBrowserActivity,
                    "未找到可打开此链接的应用",
                    Toast.LENGTH_SHORT,
                ).show()
            }
            return true
        }

        @Deprecated("Deprecated in Java")
        override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
            handleUrl(url)

        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?,
        ): Boolean = handleUrl(request?.url?.toString())

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            updateTitle(view?.title, url)
        }
    }

    private fun showActions(anchor: View) {
        val popup = PopupWindow(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(4), dp(4), dp(4), dp(4))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                setColor(Color.WHITE)
                cornerRadius = dp(16).toFloat()
            }
        }

        val actions = listOf(
            BrowserAction(
                R.drawable.ic_in_app_browser_open_in_new,
                "在外部浏览器中打开",
            ) { openInExternalBrowser(webView.url ?: initialUrl) },
            BrowserAction(
                R.drawable.ic_in_app_browser_refresh,
                "重新加载",
            ) { webView.reload() },
            BrowserAction(
                R.drawable.ic_in_app_browser_desktop,
                if (desktopMode) "手机版网页" else "桌面版网页",
            ) { toggleDesktopMode() },
            BrowserAction(
                R.drawable.ic_in_app_browser_fullscreen,
                "全屏打开",
            ) { enterFullscreen() },
        )

        actions.forEach { action ->
            content.addView(createActionRow(action) {
                popup.dismiss()
                action.invoke()
            })
        }

        popup.apply {
            contentView = content
            width = min(dp(160), resources.displayMetrics.widthPixels - dp(24))
            height = ViewGroup.LayoutParams.WRAP_CONTENT
            isFocusable = true
            isOutsideTouchable = true
            elevation = dp(10).toFloat()
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            showAsDropDown(anchor, width * -1 + anchor.width + dp(4), -dp(5))
        }
    }

    private fun createActionRow(action: BrowserAction, onClick: () -> Unit): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true
            isFocusable = true
            background = selectableItemBackground()
            setPadding(dp(6), 0, dp(6), 0)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48),
            )
            contentDescription = action.label
            setOnClickListener { onClick() }

            addView(ImageView(this@InAppBrowserActivity).apply {
                setImageResource(action.icon)
                imageTintList = ColorStateList.valueOf(MENU_ICON_COLOR)
                layoutParams = LinearLayout.LayoutParams(dp(18), dp(18)).apply {
                    marginEnd = dp(8)
                }
            })
            addView(TextView(this@InAppBrowserActivity).apply {
                text = action.label
                setTextColor(CONTENT_COLOR)
                textSize = 12f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                gravity = Gravity.CENTER_VERTICAL
                layoutParams = LinearLayout.LayoutParams(
                    0,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    1f,
                )
            })
        }
    }

    private fun selectableItemBackground() =
        obtainStyledAttributes(intArrayOf(android.R.attr.selectableItemBackground)).let {
            try {
                it.getDrawable(0)
            } finally {
                it.recycle()
            }
        }

    private fun updateTitle(pageTitle: String?, url: String?) {
        val cleanTitle = pageTitle?.trim().orEmpty()
        toolbar.title = cleanTitle.ifEmpty {
            runCatching { Uri.parse(url ?: initialUrl).host }
                .getOrNull()
                .orEmpty()
                .ifEmpty { "网页" }
        }
    }

    private fun openInExternalBrowser(url: String) {
        if (!openExternalIntent(url)) {
            Toast.makeText(this, "未找到可打开此链接的浏览器", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openExternalIntent(url: String): Boolean {
        return try {
            val externalIntent = if (url.startsWith("intent://", ignoreCase = true)) {
                Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
            } else {
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                }
            }
            startActivity(externalIntent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun toggleDesktopMode() {
        desktopMode = !desktopMode
        webView.settings.userAgentString =
            if (desktopMode) desktopUserAgent(mobileUserAgent) else mobileUserAgent
        webView.settings.loadWithOverviewMode = desktopMode
        webView.reload()
    }

    private fun desktopUserAgent(mobile: String): String = mobile
        .replace(Regex("\\([^)]*Android[^)]*\\)"), "(X11; Linux x86_64)")
        .replace("; wv", "")
        .replace(" Version/4.0", "")
        .replace(" Mobile", "")

    private fun enterFullscreen() {
        fullscreen = true
        toolbar.visibility = View.GONE
        progressBar.visibility = View.GONE
        ViewCompat.requestApplyInsets(browserRoot)
    }

    private fun exitFullscreen() {
        fullscreen = false
        toolbar.visibility = View.VISIBLE
        ViewCompat.requestApplyInsets(browserRoot)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.stopLoading()
        webView.removeAllViews()
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            fullscreen -> exitFullscreen()
            webView.canGoBack() -> webView.goBack()
            else -> super.onBackPressed()
        }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun isHttpUrl(url: String): Boolean {
        val scheme = runCatching { Uri.parse(url).scheme }.getOrNull()
        return scheme.equals("http", ignoreCase = true) ||
            scheme.equals("https", ignoreCase = true)
    }

    private data class BrowserAction(
        val icon: Int,
        val label: String,
        val invoke: () -> Unit,
    )

    private val CHROME_BACKGROUND = Color.rgb(248, 248, 252)
    private val CONTENT_COLOR = Color.rgb(28, 31, 30)
    private val MENU_ICON_COLOR = Color.rgb(69, 81, 76)
    private val ACCENT_COLOR = Color.rgb(104, 91, 255)
}
