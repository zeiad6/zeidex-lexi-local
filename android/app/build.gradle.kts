// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val repoRoot = rootProject.projectDir.parentFile
// One version for every package: Android reads it from the web app's package.json.
@Suppress("UNCHECKED_CAST")
val pkg = JsonSlurper().parse(repoRoot.resolve("package.json")) as Map<String, Any>
val appVersion = pkg["version"] as String
val (vMajor, vMinor, vPatch) = appVersion.split(".").map { it.takeWhile(Char::isDigit).toInt() }
// Public half of the update-manifest key (scripts/release-keys.mjs); the private half never enters the repo.
val updatePublicKey = repoRoot.resolve("keys/update-public.pem").readText()
    .replace(Regex("-----[^-]+-----|\\s"), "")

// Release signing: a properties file outside the repo (local) or environment variables (CI).
val signingProps = Properties().apply {
    val file = System.getenv("LEXI_SIGNING_PROPS")?.let(::File)
        ?: File(System.getProperty("user.home"), ".zeidex-keys/lexi-local/signing.properties")
    if (file.isFile) file.inputStream().use(::load)
}

android {
    namespace = "com.zeidexsoft.lexilocal"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zeidexsoft.lexilocal"
        minSdk = 26
        targetSdk = 36
        versionCode = vMajor * 10000 + vMinor * 100 + vPatch
        versionName = appVersion
        buildConfigField("String", "UPDATE_URL", "\"https://zeidexsoft.com/updates/lexi-local.json\"")
        buildConfigField("String", "UPDATE_PUBLIC_KEY", "\"$updatePublicKey\"")
    }

    signingConfigs {
        create("release") {
            val store = signingProps.getProperty("storeFile") ?: System.getenv("LEXI_KEYSTORE_FILE")
            if (store != null) {
                storeFile = file(store)
                storePassword = signingProps.getProperty("storePassword") ?: System.getenv("LEXI_KEYSTORE_PASSWORD")
                keyAlias = signingProps.getProperty("keyAlias") ?: System.getenv("LEXI_KEY_ALIAS")
                keyPassword = signingProps.getProperty("keyPassword") ?: System.getenv("LEXI_KEY_PASSWORD")
                storeType = "PKCS12"
                // v3 adds a signing lineage, so the key can be rotated later without breaking updates.
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release").takeIf { it.storeFile != null }
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // The web bundle (npm run build) is copied in at build time, never committed twice.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("web"))

    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    // Stored uncompressed so the WebView streams the 26 MB ONNX runtime straight from the APK.
    androidResources { noCompress += listOf("wasm") }
}

val copyWeb by tasks.registering(Sync::class) {
    val dist = repoRoot.resolve("dist")
    doFirst {
        check(dist.resolve("index.html").isFile) { "Web bundle missing: run `npm run build` in ${repoRoot.path} first." }
    }
    from(dist)
    into(layout.buildDirectory.dir("web/www"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }
