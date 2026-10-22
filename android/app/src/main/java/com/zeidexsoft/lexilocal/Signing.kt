// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
package com.zeidexsoft.lexilocal

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import java.io.File
import java.security.MessageDigest

/** SHA-256 fingerprints of APK signing certificates, for "same signer" checks before an update. */
object Signing {
    private fun sha256(sig: Signature) =
        MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }

    @Suppress("DEPRECATION")
    private fun certs(info: PackageInfo?): List<String> {
        if (info == null) return emptyList()
        if (Build.VERSION.SDK_INT >= 28) {
            val signing = info.signingInfo
            if (signing != null) return signing.apkContentsSigners.map(::sha256)
        }
        return info.signatures?.map(::sha256).orEmpty()
    }

    @Suppress("DEPRECATION")
    private fun flags() = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    fun installed(ctx: Context): List<String> {
        val pm = ctx.packageManager
        val info = if (Build.VERSION.SDK_INT >= 33) pm.getPackageInfo(ctx.packageName, PackageManager.PackageInfoFlags.of(flags().toLong()))
        else @Suppress("DEPRECATION") pm.getPackageInfo(ctx.packageName, flags())
        return certs(info)
    }

    /** Package name and signer certificates of an APK file that is not installed yet. */
    fun archive(ctx: Context, apk: File): Pair<String?, List<String>> {
        val pm = ctx.packageManager
        var info = if (Build.VERSION.SDK_INT >= 33) pm.getPackageArchiveInfo(apk.path, PackageManager.PackageInfoFlags.of(flags().toLong()))
        else @Suppress("DEPRECATION") pm.getPackageArchiveInfo(apk.path, flags())
        // Some Android 9/10 builds return no signingInfo for archives; GET_SIGNATURES still works there.
        if (certs(info).isEmpty()) {
            @Suppress("DEPRECATION")
            info = pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNATURES)
        }
        return info?.packageName to certs(info)
    }
}
