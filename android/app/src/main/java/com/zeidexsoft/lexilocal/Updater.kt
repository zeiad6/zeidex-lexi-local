// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package com.zeidexsoft.lexilocal

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings
import android.util.Base64
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import kotlin.concurrent.thread

/**
 * Self-update from zeidexsoft.com. An APK is installed only after all of these pass:
 *  1. the manifest's ECDSA P-256 signature verifies against the ZeidexSoft key built into the app;
 *  2. the download matches the manifest's size and SHA-256;
 *  3. the APK's package name is ours and its signing certificate equals the installed app's
 *     (and the one the manifest names). Android re-checks the signer at install time as well.
 */
object Updater {
    data class Update(
        val versionName: String,
        val versionCode: Int,
        val url: String,
        val size: Long,
        val sha256: String,
        val certSha256: String?,
        val notes: String,
    )

    private const val PREFS = "lexi"

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun configure(ctx: Context, enabled: Boolean, url: String) {
        prefs(ctx).edit().putBoolean("autoUpdate", enabled).putString("updateUrl", url.ifBlank { BuildConfig.UPDATE_URL }).apply()
    }

    private fun manifestUrl(ctx: Context) = prefs(ctx).getString("updateUrl", null) ?: BuildConfig.UPDATE_URL

    /** Verifies and parses the signed manifest; null when there is no Android asset. */
    fun parseVerified(manifest: JSONObject, publicKeyB64: String = BuildConfig.UPDATE_PUBLIC_KEY, lang: String = "en"): Update? {
        require(manifest.getInt("format") == 1) { "unknown manifest format" }
        val payload = Base64.decode(manifest.getString("payload"), Base64.DEFAULT)
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.decode(publicKeyB64, Base64.DEFAULT)))
        val ok = Signature.getInstance("SHA256withECDSA").run {
            initVerify(key)
            update(payload)
            verify(Base64.decode(manifest.getString("sigDer"), Base64.DEFAULT))
        }
        if (!ok) throw SecurityException("update manifest signature is invalid")
        val p = JSONObject(String(payload, Charsets.UTF_8))
        require(p.getString("app") == "zeidex-lexi-local") { "manifest is for another app" }
        val a = p.getJSONObject("assets").optJSONObject("android") ?: return null
        return Update(
            versionName = p.getString("version"),
            versionCode = p.getInt("versionCode"),
            url = a.getString("url"),
            size = a.getLong("size"),
            sha256 = a.getString("sha256").lowercase(),
            certSha256 = a.optString("certSha256").lowercase().ifBlank { null },
            notes = p.optJSONObject("notes")?.optString(lang).orEmpty(),
        )
    }

    fun fetch(ctx: Context): Update? {
        val conn = URL(manifestUrl(ctx)).openConnection() as HttpURLConnection
        conn.connectTimeout = 20_000
        conn.readTimeout = 30_000
        conn.setRequestProperty("Cache-Control", "no-cache")
        val text = try {
            if (conn.responseCode != 200) throw IllegalStateException("HTTP ${conn.responseCode}")
            conn.inputStream.bufferedReader().readText()
        } finally {
            conn.disconnect()
        }
        val lang = if (ctx.resources.configuration.locales[0].language == "ar") "ar" else "en"
        val update = parseVerified(JSONObject(text), lang = lang) ?: return null
        return update.takeIf { it.versionCode > BuildConfig.VERSION_CODE }
    }

    /** Daily background check (UpdateJob): only notifies; installing always needs the user. */
    fun backgroundCheck(ctx: Context) {
        if (!prefs(ctx).getBoolean("autoUpdate", true)) return
        val update = runCatching { fetch(ctx) }.getOrNull() ?: return
        prefs(ctx).edit().putInt("pendingVersionCode", update.versionCode).apply()
        Notifier.update(ctx, update.versionName)
    }

    fun checkAsync(activity: Activity, manual: Boolean) = thread {
        val result = runCatching { fetch(activity) }
        activity.runOnUiThread {
            result.onSuccess { update ->
                if (update == null) {
                    if (manual) Toast.makeText(activity, R.string.up_to_date, Toast.LENGTH_SHORT).show()
                } else {
                    AlertDialog.Builder(activity)
                        .setTitle(activity.getString(R.string.update_available, update.versionName))
                        .setMessage(update.notes.ifBlank { activity.getString(R.string.update_verified_note) })
                        .setPositiveButton(R.string.update_now) { _, _ -> install(activity, update) }
                        .setNegativeButton(R.string.later, null)
                        .show()
                }
            }.onFailure { e ->
                if (manual) Toast.makeText(activity, activity.getString(R.string.update_failed, e.message ?: ""), Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun install(activity: Activity, update: Update) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(activity)
                .setTitle(R.string.allow_install_title)
                .setMessage(R.string.allow_install_body)
                .setPositiveButton(R.string.open_settings) { _, _ ->
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                }
                .setNegativeButton(R.string.later, null)
                .show()
            return
        }
        thread {
            try {
                val apk = download(activity, update)
                verifyApk(activity, apk, update)
                commit(activity, apk)
            } catch (e: Exception) {
                Notifier.clearUpdate(activity)
                activity.runOnUiThread {
                    Toast.makeText(activity, activity.getString(R.string.update_failed, e.message ?: ""), Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun download(ctx: Context, update: Update): File {
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "lexi-${update.versionCode}.apk")
        val digest = MessageDigest.getInstance("SHA-256")
        val conn = URL(update.url).openConnection() as HttpURLConnection
        conn.connectTimeout = 30_000
        conn.readTimeout = 60_000
        try {
            if (conn.responseCode != 200) throw IllegalStateException("HTTP ${conn.responseCode}")
            var done = 0L
            var lastPct = -1L
            conn.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        done += n
                        if (done > update.size) throw SecurityException("download is larger than the signed size")
                        val pct = done * 100 / update.size
                        if (pct != lastPct) Notifier.updateProgress(ctx, done, update.size).also { lastPct = pct }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }
        if (file.length() != update.size || hash != update.sha256) {
            file.delete()
            throw SecurityException("download does not match the signed manifest")
        }
        return file
    }

    private fun verifyApk(ctx: Context, apk: File, update: Update) {
        val (pkg, signers) = Signing.archive(ctx, apk)
        val installed = Signing.installed(ctx)
        if (pkg != ctx.packageName) throw SecurityException("update is for another package: $pkg")
        if (signers.isEmpty() || signers.toSet() != installed.toSet()) throw SecurityException("update is signed by a different certificate")
        if (update.certSha256 != null && update.certSha256 !in signers) throw SecurityException("update signer does not match the manifest")
    }

    private fun commit(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("base.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            // MUTABLE: the installer fills in the status extras on this intent.
            val pending = PendingIntent.getBroadcast(
                ctx, id, Intent(ctx, InstallReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(pending.intentSender)
        }
        Notifier.clearUpdate(ctx)
    }
}
