// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Desktop self-update from zeidexsoft.com. An update is applied only when:
//   1. the manifest's ECDSA P-256 signature verifies against keys/update-public.pem,
//   2. the downloaded file matches the manifest's SHA-256 and size,
//   3. on Windows, the MSI's Authenticode signer thumbprint matches the manifest (signerSha1).
import { app, dialog, Notification, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash, verify } from "node:crypto";
import { chmodSync, createWriteStream, readFileSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_KEY = readFileSync(path.join(HERE, "..", "keys", "update-public.pem"), "utf8");
export const DEFAULT_URL = "https://zeidexsoft.com/updates/lexi-local.json";

export function compareVersions(a, b) {
  const pa = a.split(/[.+-]/).map(Number);
  const pb = b.split(/[.+-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return Math.sign((pa[i] || 0) - (pb[i] || 0));
  return 0;
}

export function verifyManifest(m, pem = PUBLIC_KEY) {
  const bytes = Buffer.from(m.payload, "base64");
  if (m.format !== 1 || !verify("sha256", bytes, { key: pem, dsaEncoding: "der" }, Buffer.from(m.sigDer, "base64"))) {
    throw new Error("update manifest signature is invalid");
  }
  const payload = JSON.parse(bytes.toString("utf8"));
  if (payload.app !== "zeidex-lexi-local") throw new Error("manifest is for another app");
  return payload;
}

/** Which manifest asset this install can apply itself. */
export function assetFor(assets, platform = process.platform, arch = process.arch, appImage = process.env.APPIMAGE) {
  if (platform === "win32") return assets.windows ? { kind: "msi", ...assets.windows } : null;
  if (platform === "linux") {
    const a = arch === "arm64" ? "arm64" : "x64";
    if (appImage && assets[`linux-appimage-${a}`]) return { kind: "appimage", ...assets[`linux-appimage-${a}`] };
    const deb = assets[`linux-deb-${a}`];
    return deb ? { kind: "page", ...deb } : null;
  }
  return null;
}

async function download(asset) {
  const dest = path.join(os.tmpdir(), `lexi-update-${Date.now()}-${path.basename(asset.file)}`);
  const res = await fetch(asset.url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const hash = createHash("sha256");
  let size = 0;
  const tap = new TransformStream({
    transform(chunk, c) {
      hash.update(chunk);
      size += chunk.byteLength;
      c.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(tap)), createWriteStream(dest));
  if (size !== asset.size || hash.digest("hex") !== asset.sha256) throw new Error("downloaded file does not match the signed manifest");
  return dest;
}

function windowsSigner(file) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", `(Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}').SignerCertificate.Thumbprint`],
      (err, out) => resolve(err ? null : out.trim().toUpperCase()),
    );
  });
}

async function apply(asset) {
  const file = await download(asset);
  if (asset.kind === "msi") {
    if (asset.signerSha1) {
      const signer = await windowsSigner(file);
      if (signer !== asset.signerSha1.toUpperCase()) throw new Error(`MSI signer ${signer ?? "none"} does not match ${asset.signerSha1}`);
    }
    spawn("msiexec.exe", ["/i", file, "/passive", "/norestart"], { detached: true, stdio: "ignore" }).unref();
    app.quit();
  } else if (asset.kind === "appimage") {
    const target = process.env.APPIMAGE;
    chmodSync(file, 0o755);
    renameSync(file, target); // atomic on the same filesystem; the running process keeps its open inode
    app.relaunch({ execPath: target });
    app.exit(0);
  }
}

/** Checks, asks, verifies, installs. `manual` shows "up to date" and errors to the user. */
export async function checkForUpdates({ manual = false, url = DEFAULT_URL, win } = {}) {
  const lang = app.getLocale().startsWith("ar") ? "ar" : "en";
  const tr = (ar, en) => (lang === "ar" ? ar : en);
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = verifyManifest(await res.json());
    if (compareVersions(payload.version, app.getVersion()) <= 0) {
      if (manual) dialog.showMessageBox(win, { message: tr("لديك أحدث إصدار", "You have the latest version") });
      return { available: false };
    }
    const asset = assetFor(payload.assets);
    if (!manual && Notification.isSupported()) {
      new Notification({ title: tr(`الإصدار ${payload.version} متاح`, `Version ${payload.version} is available`), body: payload.notes?.[lang] ?? "" }).show();
    }
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: [tr("حدِّث الآن", "Update now"), tr("لاحقًا", "Later")],
      defaultId: 0,
      message: tr(`الإصدار ${payload.version} من Zeidex Lexi Local متاح`, `Zeidex Lexi Local ${payload.version} is available`),
      detail: payload.notes?.[lang] || "",
    });
    if (response !== 0) return { available: true, version: payload.version };
    if (!asset || asset.kind === "page") shell.openExternal(asset?.url ?? payload.page);
    else await apply(asset);
    return { available: true, version: payload.version };
  } catch (e) {
    if (manual) dialog.showErrorBox(tr("تعذّر التحديث", "Update failed"), String(e?.message ?? e));
    return { available: false, error: String(e?.message ?? e) };
  }
}
