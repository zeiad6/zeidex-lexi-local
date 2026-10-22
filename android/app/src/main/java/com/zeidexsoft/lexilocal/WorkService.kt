// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package com.zeidexsoft.lexilocal

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import java.util.concurrent.atomic.AtomicInteger

/**
 * Foreground service held while the page runs a long job (model download, book summary, quiz).
 * It keeps the process and the WebView's JavaScript alive with the screen off, and shows progress.
 */
class WorkService : Service() {
    companion object {
        private const val WAKE_TIMEOUT_MS = 3 * 60 * 60 * 1000L
        private val active = AtomicInteger(0)
        val running get() = active.get() > 0

        fun start(ctx: Context, label: String) {
            active.incrementAndGet()
            val intent = Intent(ctx, WorkService::class.java).putExtra("label", label)
            ctx.startForegroundService(intent)
        }

        fun progress(ctx: Context, label: String, done: Int, total: Int) {
            if (running) Notifier.progress(ctx, label, done, total)
        }

        /** Jobs can overlap (a model loads while a summary queues); stop only when the last one ends. */
        fun stop(ctx: Context, title: String, body: String, ok: Boolean) {
            if (active.get() > 0 && active.decrementAndGet() == 0) ctx.stopService(Intent(ctx, WorkService::class.java))
            // In the foreground the page already shows the result; notify only when the user is elsewhere.
            if (!MainActivity.visible && (ok || body.isNotBlank())) Notifier.result(ctx, title, body)
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val label = intent?.getStringExtra("label") ?: getString(R.string.app_name)
        val n = Notifier.jobNotification(this, label, 0, 0)
        if (Build.VERSION.SDK_INT >= 29) startForeground(Notifier.JOB_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(Notifier.JOB_ID, n)
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Lexi:work")
                .apply { acquire(WAKE_TIMEOUT_MS) }
        }
        return START_NOT_STICKY
    }

    // Android 15 caps dataSync services; when the system says time is up, stop cleanly.
    override fun onTimeout(startId: Int, fgsType: Int) {
        active.set(0)
        stopSelf()
    }

    override fun onDestroy() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
