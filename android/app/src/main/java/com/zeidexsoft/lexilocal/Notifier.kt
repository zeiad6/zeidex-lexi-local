// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package com.zeidexsoft.lexilocal

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

object Notifier {
    const val JOB_ID = 1001
    private const val UPDATE_ID = 1002
    private const val CH_JOBS = "jobs"
    private const val CH_RESULTS = "results"
    private const val CH_UPDATES = "updates"
    private var resultId = 2000

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CH_JOBS, ctx.getString(R.string.ch_jobs), NotificationManager.IMPORTANCE_LOW),
                NotificationChannel(CH_RESULTS, ctx.getString(R.string.ch_results), NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CH_UPDATES, ctx.getString(R.string.ch_updates), NotificationManager.IMPORTANCE_DEFAULT),
            ),
        )
    }

    private fun allowed(ctx: Context) =
        Build.VERSION.SDK_INT < 33 ||
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openApp(ctx: Context, extra: String? = null): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (extra != null) intent.putExtra(extra, true)
        return PendingIntent.getActivity(ctx, extra.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun jobNotification(ctx: Context, label: String, done: Int, total: Int): Notification =
        Notification.Builder(ctx, CH_JOBS)
            .setSmallIcon(R.drawable.ic_stat_lexi)
            .setContentTitle(label)
            .setContentText(if (total > 0) "$done / $total" else ctx.getString(R.string.job_running))
            .setProgress(total, done, total <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp(ctx))
            .build()

    fun progress(ctx: Context, label: String, done: Int, total: Int) {
        if (!allowed(ctx)) return
        ctx.getSystemService(NotificationManager::class.java).notify(JOB_ID, jobNotification(ctx, label, done, total))
    }

    fun result(ctx: Context, title: String, body: String) {
        if (!allowed(ctx)) return
        val n = Notification.Builder(ctx, CH_RESULTS)
            .setSmallIcon(R.drawable.ic_stat_lexi)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx))
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(resultId++, n)
    }

    fun update(ctx: Context, version: String) {
        if (!allowed(ctx)) return
        val n = Notification.Builder(ctx, CH_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_lexi)
            .setContentTitle(ctx.getString(R.string.update_available, version))
            .setContentText(ctx.getString(R.string.update_tap))
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx, MainActivity.EXTRA_INSTALL_UPDATE))
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(UPDATE_ID, n)
    }

    fun updateProgress(ctx: Context, done: Long, total: Long) {
        if (!allowed(ctx)) return
        val pct = if (total > 0) (done * 100 / total).toInt() else 0
        val n = Notification.Builder(ctx, CH_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_lexi)
            .setContentTitle(ctx.getString(R.string.update_downloading))
            .setProgress(100, pct, total <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(UPDATE_ID, n)
    }

    fun clearUpdate(ctx: Context) = ctx.getSystemService(NotificationManager::class.java).cancel(UPDATE_ID)
}
