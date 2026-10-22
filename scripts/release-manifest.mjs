#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Builds and signs the update manifest that every app checks on zeidexsoft.com.
//
//   node scripts/release-manifest.mjs --dir release --base-url https://zeidexsoft.com/downloads/lexi-local/
//
// Output in --dir: lexi-local.json (upload to https://zeidexsoft.com/updates/lexi-local.json),
// SHA256SUMS and SHA256SUMS.sig. Upload the installers to --base-url.
//
// Manifest format: { format, keyId, payload: base64(JSON), sigDer, sigP1363 }. Signing the raw payload
// bytes avoids cross-language JSON canonicalization; two encodings because Java/Node use DER and
// WebCrypto uses IEEE-P1363 (r||s).
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const versionCode = (v) => {
  const [a, b, c] = v.split(/[.+-]/).map(Number);
  return a * 10000 + b * 100 + c;
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function keyId(publicPem) {
  const spki = createPublicKey(publicPem).export({ type: "spki", format: "der" });
  return sha256(spki).slice(0, 16);
}

/** Signs a payload object; returns the manifest JSON object. */
export function signManifest(payload, privatePem) {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  const key = createPrivateKey(privatePem);
  return {
    format: 1,
    keyId: keyId(createPublicKey(key).export({ type: "spki", format: "pem" })),
    payload: bytes.toString("base64"),
    sigDer: sign("sha256", bytes, { key, dsaEncoding: "der" }).toString("base64"),
    sigP1363: sign("sha256", bytes, { key, dsaEncoding: "ieee-p1363" }).toString("base64"),
  };
}

/** Same check the desktop app runs; returns the payload or throws. */
export function verifyManifest(manifest, publicPem) {
  const bytes = Buffer.from(manifest.payload, "base64");
  const ok = verify("sha256", bytes, { key: publicPem, dsaEncoding: "der" }, Buffer.from(manifest.sigDer, "base64"));
  if (!ok) throw new Error("bad update signature");
  return JSON.parse(bytes.toString("utf8"));
}

const KIND = [
  [/\.apk$/i, "android"],
  [/\.msi$/i, "windows"],
  [/arm64.*\.AppImage$|aarch64.*\.AppImage$/i, "linux-appimage-arm64"],
  [/\.AppImage$/i, "linux-appimage-x64"],
  [/\.deb$/i, (n) => (/arm64|aarch64/i.test(n) ? "linux-deb-arm64" : "linux-deb-x64")],
  [/\.tar\.gz$/i, (n) => (/arm64|aarch64/i.test(n) ? "linux-tar-arm64" : "linux-tar-x64")],
];

export function describeArtifacts(dir, baseUrl) {
  const assets = {};
  for (const name of readdirSync(dir).sort()) {
    const rule = KIND.find(([re]) => re.test(name));
    if (!rule) continue;
    const kind = typeof rule[1] === "function" ? rule[1](name) : rule[1];
    const buf = readFileSync(path.join(dir, name));
    assets[kind] = { file: name, url: new URL(name, baseUrl).href, size: statSync(path.join(dir, name)).size, sha256: sha256(buf) };
  }
  return assets;
}

/** Reads the signer straight from a built APK (CI has no keystore file, only the signed artifact). */
function apkCertSha256(apk) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const tools = path.join(sdk, "build-tools");
  const latest = readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  const out = execFileSync(path.join(tools, latest, "apksigner"), ["verify", "--print-certs", apk], { encoding: "utf8" });
  return /certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(out)?.[1]?.toLowerCase() ?? null;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { KEYS_DIR, androidCertSha256, windowsThumbprint } = await import("./release-keys.mjs");
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const dir = path.resolve(arg("dir", path.join(ROOT, "release")));
  const version = arg("version", pkg.version);
  const baseUrl = arg("base-url", "https://zeidexsoft.com/downloads/lexi-local/");
  const privatePem = process.env.UPDATE_SIGNING_KEY || readFileSync(path.join(KEYS_DIR, "update-private.pem"), "utf8");

  const assets = describeArtifacts(dir, baseUrl);
  // Signer identities let each app refuse an update built with a different key, even if the hash matches.
  const hasKeys = existsSync(path.join(KEYS_DIR, "signing.properties"));
  if (assets.android) {
    assets.android.certSha256 = process.env.ANDROID_CERT_SHA256 || (hasKeys ? androidCertSha256() : apkCertSha256(path.join(dir, assets.android.file)));
    if (!assets.android.certSha256) throw new Error("cannot determine the APK signing certificate");
  }
  if (assets.windows) {
    const sha1 = process.env.WIN_SIGNER_SHA1 || (existsSync(path.join(KEYS_DIR, "windows-codesign.pfx")) ? windowsThumbprint() : "");
    if (sha1) assets.windows.signerSha1 = sha1; // without it the desktop updater checks hash + manifest signature only
  }

  const payload = {
    app: "zeidex-lexi-local",
    version,
    versionCode: versionCode(version),
    published: new Date().toISOString(),
    notes: { ar: arg("notes-ar", ""), en: arg("notes-en", "") },
    page: "https://zeidexsoft.com/programs",
    assets,
  };
  const manifest = signManifest(payload, privatePem);
  verifyManifest(manifest, readFileSync(path.join(ROOT, "keys", "update-public.pem"), "utf8"));
  writeFileSync(path.join(dir, "lexi-local.json"), JSON.stringify(manifest, null, 2));

  const sums = Object.values(assets).map((a) => `${a.sha256}  ${a.file}`).join("\n") + "\n";
  writeFileSync(path.join(dir, "SHA256SUMS"), sums);
  writeFileSync(path.join(dir, "SHA256SUMS.sig"), sign("sha256", Buffer.from(sums), { key: createPrivateKey(privatePem), dsaEncoding: "der" }));
  console.log(`Signed manifest for ${version} with ${Object.keys(assets).length} assets → ${path.join(dir, "lexi-local.json")}`);
}
