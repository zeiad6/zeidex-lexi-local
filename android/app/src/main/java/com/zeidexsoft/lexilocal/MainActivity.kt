// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 ZeidexSoft — https://zeidexsoft.com
package com.zeidexsoft.lexilocal

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.window.OnBackInvokedDispatcher
import org.json.JSONObject
import kotlin.concurrent.thread

class MainActivity : Activity() {
    companion object {
        const val EXTRA_INSTALL_UPDATE = "lexi.installUpdate"
        private const val REQ_FILE = 10
        private const val REQ_NOTIFICATIONS = 11
        // Shared files are passed to the page as base64; keep them well inside WebView string limits.
        private const val MAX_SHARED_BYTES = 60L * 1024 * 1024

        @Volatile var visible = false
    }

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pageReady = false
    private val pendingJs = mutableListOf<String>()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val server = AssetServer(this)

        web = WebView(this)
        root = FrameLayout(this).apply { addView(web, FrameLayout.LayoutParams(-1, -1)) }
        setContentView(root)
        setupInsets()
        setSystemBars(isNight())

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            textZoom = 100
            setSupportZoom(false)
            mediaPlaybackRequiresUserGesture = true
        }
        web.addJavascriptInterface(Bridge(this, web), "LexiAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = server.handle(request)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == AssetServer.HOST) return false
                openExternal(request.url) // never navigate the app's WebView to a foreign page
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                pendingJs.forEach { web.evaluateJavascript(it, null) }
                pendingJs.clear()
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val pick = Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*")
                    .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "text/plain", "text/markdown", "application/json"))
                return try {
                    @Suppress("DEPRECATION") startActivityForResult(pick, REQ_FILE)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            // Camera, microphone and location are never needed.
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()

            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) Log.d("Lexi", "${m.message()} @${m.sourceId()}:${m.lineNumber()}")
                return BuildConfig.DEBUG
            }
        }
        web.loadUrl("${AssetServer.ORIGIN}/index.html")

        Notifier.createChannels(this)
        UpdateJob.schedule(this)
        registerBack()
        requestStartupPermissions()
        handleIntent(intent)
    }

    // ---------- layout: every screen size, notches, gesture bars, keyboard ----------

    private fun isNight() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    private fun setupInsets() {
        if (Build.VERSION.SDK_INT < 30) return // older versions fit system windows and resize for the IME
        window.setDecorFitsSystemWindows(false)
        root.setOnApplyWindowInsetsListener { v, insets ->
            val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsets.CONSUMED
        }
    }

    /** Matches the system bars to the page theme (the app has its own dark/light toggle). */
    // Held until the print job has its adapter; otherwise the off-screen WebView can be collected mid-layout.
    private var printView: WebView? = null

    /** Prints export HTML through the system dialog, which offers "Save as PDF" on every device. */
    fun printHtml(html: String, jobName: String) {
        val view = WebView(this)
        view.settings.javaScriptEnabled = false
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView, url: String?) {
                val name = jobName.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(100).ifBlank { "Lexi Local" }
                getSystemService(PrintManager::class.java).print(
                    name,
                    v.createPrintDocumentAdapter(name),
                    PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build(),
                )
                printView = null
            }
        }
        printView = view
        view.loadDataWithBaseURL(AssetServer.ORIGIN, html, "text/html", "utf-8", null)
    }

    fun setSystemBars(dark: Boolean) {
        val bg = if (dark) Color.parseColor("#0b121d") else Color.parseColor("#faf6ee")
        root.setBackgroundColor(bg)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(bg))
        if (Build.VERSION.SDK_INT >= 30) {
            val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (dark) 0 else light, light)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (dark) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            @Suppress("DEPRECATION")
            window.statusBarColor = bg
            @Suppress("DEPRECATION")
            window.navigationBarColor = bg
        }
    }

    // ---------- permissions asked at first launch ----------

    private fun requestStartupPermissions() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
        } else {
            askBatteryExemptionOnce()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIFICATIONS) askBatteryExemptionOnce()
    }

    /** Book-length jobs can take a long time; ask once, with an explanation, to skip battery optimization. */
    @SuppressLint("BatteryLife")
    private fun askBatteryExemptionOnce() {
        val prefs = Updater.prefs(this)
        val pm = getSystemService(PowerManager::class.java)
        if (prefs.getBoolean("askedBattery", false) || pm.isIgnoringBatteryOptimizations(packageName)) return
        prefs.edit().putBoolean("askedBattery", true).apply()
        AlertDialog.Builder(this)
            .setTitle(R.string.battery_title)
            .setMessage(R.string.battery_body)
            .setPositiveButton(R.string.allow) { _, _ ->
                runCatching { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
            }
            .setNegativeButton(R.string.not_now, null)
            .show()
    }

    // ---------- back, lifecycle, files ----------

    private fun registerBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }
    }

    @Deprecated("Pre-Android 13 back handling")
    @Suppress("DEPRECATION")
    override fun onBackPressed() = handleBack()

    /** Back closes the top dialog in the page; otherwise the app goes to the background (jobs keep running). */
    private fun handleBack() {
        web.evaluateJavascript("window.__lexiBack ? window.__lexiBack() : false") { r -> if (r != "true") moveTaskToBack(true) }
    }

    override fun onResume() {
        super.onResume()
        visible = true
        web.onResume()
    }

    override fun onPause() {
        visible = false
        // While a job runs, keep the page fully active so the summary continues in the background.
        if (!WorkService.running) web.onPause()
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    @Deprecated("Activity result API without androidx")
    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            val cb = fileCallback
            fileCallback = null
            cb?.onReceiveValue(data?.data?.takeIf { resultCode == RESULT_OK }?.let { arrayOf(it) })
        } else super.onActivityResult(requestCode, resultCode, data)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.getBooleanExtra(EXTRA_INSTALL_UPDATE, false)) {
            intent.removeExtra(EXTRA_INSTALL_UPDATE)
            Updater.checkAsync(this, manual = true)
            return
        }
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND ->
                if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
            else -> null
        }
        val text = if (intent.action == Intent.ACTION_SEND && uri == null) intent.getStringExtra(Intent.EXTRA_TEXT) else null
        if (uri == null && text == null) return
        intent.action = null // do not re-import on configuration changes
        thread {
            val (name, mime, bytes) = if (uri != null) readShared(uri) ?: return@thread else Triple("shared.txt", "text/plain", text!!.toByteArray())
            val js = "window.__lexiOpenFile(${JSONObject.quote(name)}, ${JSONObject.quote(mime)}, '${Base64.encodeToString(bytes, Base64.NO_WRAP)}')"
            runOnUiThread { if (pageReady) web.evaluateJavascript(js, null) else pendingJs += js }
        }
    }

    private fun readShared(uri: Uri): Triple<String, String, ByteArray>? = runCatching {
        var name = "document"
        var size = -1L
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                name = c.getString(0) ?: name
                size = if (c.isNull(1)) -1 else c.getLong(1)
            }
        }
        if (size > MAX_SHARED_BYTES) error("file too large")
        val mime = contentResolver.getType(uri) ?: if (name.endsWith(".pdf", true)) "application/pdf" else "text/plain"
        val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("unreadable")
        Triple(name, mime, bytes)
    }.getOrNull()

    fun openExternal(uri: Uri) {
        // Only web and mail links: an intent:// or content:// URI must not launch other apps' components.
        if (uri.scheme?.lowercase() !in setOf("https", "http", "mailto")) return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
