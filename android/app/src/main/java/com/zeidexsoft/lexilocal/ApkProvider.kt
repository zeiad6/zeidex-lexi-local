// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package com.zeidexsoft.lexilocal

import android.app.Activity
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

/**
 * Exposes this app's own signed APK, read-only, so it can be sent to a nearby phone through
 * Quick Share, Bluetooth or any messenger — without a storage permission or androidx FileProvider.
 */
class ApkProvider : ContentProvider() {
    companion object {
        private const val MIME = "application/vnd.android.package-archive"

        fun shareInstalledApk(activity: Activity) {
            val name = "Zeidex-Lexi-Local-${BuildConfig.VERSION_NAME}.apk"
            val uri = Uri.parse("content://${activity.packageName}.apk/$name")
            val send = Intent(Intent.ACTION_SEND)
                .setType(MIME)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(Intent.createChooser(send, activity.getString(R.string.share_app)))
        }
    }

    private fun apk() = File(context!!.applicationInfo.sourceDir)

    override fun onCreate() = true

    override fun getType(uri: Uri) = MIME

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        require(mode == "r") { "read-only" }
        return ParcelFileDescriptor.open(apk(), ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        return MatrixCursor(cols).apply {
            addRow(cols.map { if (it == OpenableColumns.SIZE) apk().length() else uri.lastPathSegment })
        }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
