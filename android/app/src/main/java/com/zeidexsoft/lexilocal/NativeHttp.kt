// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package com.zeidexsoft.lexilocal

import android.util.Base64
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * HTTP for cloud LLM providers, run natively so browser CORS never blocks one. Responses stream
 * back to the page chunk by chunk (Server-Sent Events keep working) through [emit].
 */
class NativeHttp(private val emit: (id: String, eventJson: String) -> Unit) {
    private val pool = Executors.newCachedThreadPool()
    private val open = ConcurrentHashMap<String, HttpURLConnection>()

    fun start(id: String, method: String, url: String, headersJson: String, bodyBase64: String) {
        pool.execute {
            var conn: HttpURLConnection? = null
            try {
                val target = URL(url)
                require(target.protocol == "https" || target.protocol == "http") { "unsupported scheme" }
                conn = (target.openConnection() as HttpURLConnection).apply {
                    requestMethod = method
                    connectTimeout = 30_000
                    readTimeout = 10 * 60_000 // long generations stream slowly
                    instanceFollowRedirects = true
                    setRequestProperty("User-Agent", "ZeidexLexiLocal/${BuildConfig.VERSION_NAME} Android")
                    val headers = JSONObject(headersJson)
                    headers.keys().forEach { setRequestProperty(it, headers.getString(it)) }
                }
                open[id] = conn
                if (bodyBase64.isNotEmpty()) {
                    val body = Base64.decode(bodyBase64, Base64.DEFAULT)
                    conn.doOutput = true
                    conn.setFixedLengthStreamingMode(body.size)
                    conn.outputStream.use { it.write(body) }
                }
                val status = conn.responseCode
                val headers = JSONObject()
                conn.headerFields.forEach { (k, v) -> if (k != null) headers.put(k.lowercase(), v.joinToString(", ")) }
                emit(id, JSONObject().put("type", "head").put("status", status).put("headers", headers).toString())

                val input = if (status >= 400) conn.errorStream else conn.inputStream
                input?.use { stream ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = stream.read(buf)
                        if (n < 0) break
                        val chunk = Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
                        emit(id, "{\"type\":\"chunk\",\"data\":\"$chunk\"}")
                    }
                }
                emit(id, "{\"type\":\"end\"}")
            } catch (e: Exception) {
                // A disconnect() from abort() also lands here; the page has already given up on it.
                val msg = if (e is IOException && !open.containsKey(id)) "aborted" else (e.message ?: e.javaClass.simpleName)
                emit(id, JSONObject().put("type", "error").put("message", msg).toString())
            } finally {
                open.remove(id)
                conn?.disconnect()
            }
        }
    }

    fun abort(id: String) {
        open.remove(id)?.disconnect()
    }
}
