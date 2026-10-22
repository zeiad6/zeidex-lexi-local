// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package com.zeidexsoft.lexilocal

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.FileNotFoundException
import java.io.InputStream

/**
 * Serves the bundled web app (assets/www) at https://appassets.androidplatform.net/.
 * An https origin makes the page a secure context, which WebGPU, Cache Storage and WebCrypto need;
 * file:// URLs would not qualify.
 */
class AssetServer(private val context: Context) {
    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        private val MIME = mapOf(
            "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript",
            "css" to "text/css", "json" to "application/json", "wasm" to "application/wasm",
            "svg" to "image/svg+xml", "png" to "image/png", "ico" to "image/x-icon",
            "woff2" to "font/woff2", "woff" to "font/woff", "txt" to "text/plain",
            "webmanifest" to "application/manifest+json",
        )
    }

    fun handle(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.host != HOST) return null
        var path = url.path.orEmpty().trimStart('/')
        if (path.isEmpty() || path.endsWith("/")) path += "index.html"
        if (path.split('/').any { it == ".." }) return status(400, "Bad Request")

        var stream = open(path)
        // SPA fallback only for extension-less routes; a missing .js must stay a 404.
        if (stream == null && !path.substringAfterLast('/').contains('.')) {
            path = "index.html"
            stream = open(path)
        }
        if (stream == null) return status(404, "Not Found")

        val mime = MIME[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"
        val textual = mime.startsWith("text/") || mime == "application/json"
        val headers = mapOf(
            // Cross-origin isolation enables SharedArrayBuffer => multithreaded WASM for the CPU model.
            "Cross-Origin-Opener-Policy" to "same-origin",
            "Cross-Origin-Embedder-Policy" to "credentialless",
            "X-Content-Type-Options" to "nosniff",
            "Cache-Control" to if (path.startsWith("assets/")) "max-age=31536000, immutable" else "no-cache",
        )
        return WebResourceResponse(mime, if (textual) "utf-8" else null, 200, "OK", headers, stream)
    }

    private fun open(path: String): InputStream? =
        try {
            context.assets.open("www/$path")
        } catch (_: FileNotFoundException) {
            null
        }

    private fun status(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, emptyMap(), reason.byteInputStream())
}
