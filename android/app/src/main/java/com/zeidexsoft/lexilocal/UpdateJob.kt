// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package com.zeidexsoft.lexilocal

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Daily update check, even when the app is closed; persisted across reboots. */
class UpdateJob : JobService() {
    companion object {
        private const val ID = 42

        fun schedule(ctx: Context) {
            val js = ctx.getSystemService(JobScheduler::class.java)
            if (js.getPendingJob(ID) != null) return
            js.schedule(
                JobInfo.Builder(ID, ComponentName(ctx, UpdateJob::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(TimeUnit.HOURS.toMillis(24))
                    .setPersisted(true)
                    .build(),
            )
        }
    }

    override fun onStartJob(params: JobParameters): Boolean {
        thread {
            try {
                Updater.backgroundCheck(this)
            } finally {
                jobFinished(params, false)
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters) = true
}
