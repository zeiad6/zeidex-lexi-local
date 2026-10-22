// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package com.zeidexsoft.lexilocal

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject
import java.io.File

/**
 * window.LexiAndroid — the page's only door to native code (see src/lib/native.ts). Only our own
 * bundled origin is ever loaded in the WebView, so no third-party page can reach these methods.
 */
class Bridge(private val activity: MainActivity, private val web: WebView) {
    private val http = NativeHttp { id, json ->
        web.post { web.evaluateJavascript("window.__lexiHttp && window.__lexiHttp(${JSONObject.quote(id)}, $json)", null) }
    }

    @JavascriptInterface fun notify(title: String, body: String) = Notifier.result(activity, title, body)

    @JavascriptInterface fun jobStart(label: String) = WorkService.start(activity, label)

    @JavascriptInterface fun jobProgress(label: String, done: Int, total: Int) = WorkService.progress(activity, label, done, total)

    @JavascriptInterface fun jobEnd(title: String, body: String, ok: Boolean) = WorkService.stop(activity, title, body, ok)

    @JavascriptInterface fun httpStart(id: String, method: String, url: String, headersJson: String, bodyBase64: String) =
        http.start(id, method, url, headersJson, bodyBase64)

    @JavascriptInterface fun httpAbort(id: String) = http.abort(id)

    @JavascriptInterface fun checkUpdates(manual: Boolean) {
        Updater.checkAsync(activity, manual)
    }

    @JavascriptInterface fun configureUpdates(enabled: Boolean, url: String) = Updater.configure(activity, enabled, url)

    @JavascriptInterface fun copyText(text: String) = activity.runOnUiThread {
        activity.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Lexi Local", text))
    }

    @JavascriptInterface fun share(text: String, title: String) = activity.runOnUiThread {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        activity.startActivity(Intent.createChooser(send, title))
    }

    @JavascriptInterface fun shareApp() = activity.runOnUiThread { ApkProvider.shareInstalledApk(activity) }

    @JavascriptInterface fun openExternal(url: String) = activity.runOnUiThread { activity.openExternal(Uri.parse(url)) }

    @JavascriptInterface fun setSystemBars(dark: Boolean) = activity.runOnUiThread { activity.setSystemBars(dark) }

    @JavascriptInterface fun appInfo(): String = JSONObject()
        .put("version", BuildConfig.VERSION_NAME)
        .put("versionCode", BuildConfig.VERSION_CODE)
        .put("sdk", Build.VERSION.SDK_INT)
        .put("signer", Signing.installed(activity).firstOrNull())
        .toString()

    /** Saves to Downloads/Lexi Local (MediaStore, no storage permission) and returns where it went. */
    @JavascriptInterface fun saveFile(name: String, mime: String, base64: String): String {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val where = if (Build.VERSION.SDK_INT >= 29) {
            val resolver = activity.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safe)
                put(MediaStore.Downloads.MIME_TYPE, mime.substringBefore(';'))
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Lexi Local")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("cannot create file")
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            "${Environment.DIRECTORY_DOWNLOADS}/Lexi Local/$safe"
        } else {
            // Android 8–9: app-specific Downloads needs no permission either.
            val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: activity.filesDir
            File(dir, safe).apply { writeBytes(bytes) }.path
        }
        activity.runOnUiThread { Toast.makeText(activity, activity.getString(R.string.saved_to, where), Toast.LENGTH_LONG).show() }
        return where
    }
}
