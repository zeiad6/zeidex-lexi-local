#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Creates every release signing key, once, OUTSIDE the repository:
//   - update-private.pem   ECDSA P-256 key that signs the update manifest on zeidexsoft.com
//   - android-release.p12  Android app signing key (APK v2/v3 signatures)
//   - windows-codesign.pfx Authenticode certificate for the MSI (self-signed until a CA cert is bought)
//   - signing.properties / secrets.env  passwords, chmod 600
// Only keys/update-public.pem is written into the repo; apps embed it to verify updates.
//
//   node scripts/release-keys.mjs init      # refuses to overwrite existing keys
//   node scripts/release-keys.mjs info      # fingerprints to paste into the update manifest
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KEYS_DIR = process.env.LEXI_KEYS_DIR || path.join(os.homedir(), ".zeidex-keys", "lexi-local");
const PUBLIC_KEY = path.join(ROOT, "keys", "update-public.pem");
const ALIAS = "lexi";

const secret = () => randomBytes(24).toString("base64url");
const write600 = (file, data) => {
  writeFileSync(file, data, { mode: 0o600 });
  chmodSync(file, 0o600);
};

function init() {
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  chmodSync(KEYS_DIR, 0o700);
  const files = ["update-private.pem", "android-release.p12", "windows-codesign.pfx"].map((f) => path.join(KEYS_DIR, f));
  if (files.some(existsSync)) {
    console.error(`Keys already exist in ${KEYS_DIR}. Refusing to overwrite: a new Android key can never update installed apps.`);
    process.exit(1);
  }

  // 1. Update-manifest key.
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  write600(files[0], privateKey.export({ type: "pkcs8", format: "pem" }));
  mkdirSync(path.dirname(PUBLIC_KEY), { recursive: true });
  writeFileSync(PUBLIC_KEY, publicKey.export({ type: "spki", format: "pem" }));

  // 2. Android key: PKCS12 needs the same store and key password.
  const androidPass = secret();
  execFileSync("keytool", [
    "-genkeypair", "-noprompt", "-storetype", "PKCS12", "-keystore", files[1], "-alias", ALIAS,
    "-keyalg", "RSA", "-keysize", "4096", "-validity", "10950",
    "-dname", "CN=ZeidexSoft, O=ZeidexSoft, OU=Zeidex Lexi Local",
    "-storepass", androidPass, "-keypass", androidPass,
  ], { stdio: "ignore" });
  chmodSync(files[1], 0o600);
  write600(
    path.join(KEYS_DIR, "signing.properties"),
    `storeFile=${files[1]}\nstorePassword=${androidPass}\nkeyAlias=${ALIAS}\nkeyPassword=${androidPass}\n`,
  );

  // 3. Windows Authenticode certificate (codeSigning EKU).
  const winPass = secret();
  const tmpKey = path.join(KEYS_DIR, "win.key.tmp");
  const tmpCrt = path.join(KEYS_DIR, "win.crt.tmp");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-sha256", "-days", "1095",
    "-subj", "/CN=ZeidexSoft/O=ZeidexSoft",
    "-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=codeSigning",
    "-keyout", tmpKey, "-out", tmpCrt,
  ], { stdio: "ignore" });
  execFileSync("openssl", ["pkcs12", "-export", "-out", files[2], "-inkey", tmpKey, "-in", tmpCrt, "-passout", `pass:${winPass}`], { stdio: "ignore" });
  rmSync(tmpKey);
  rmSync(tmpCrt);
  chmodSync(files[2], 0o600);

  write600(
    path.join(KEYS_DIR, "secrets.env"),
    [
      "# Values for GitHub Actions secrets (Settings → Secrets → Actions). Never commit this file.",
      `ANDROID_KEYSTORE_PASSWORD=${androidPass}`,
      `ANDROID_KEY_ALIAS=${ALIAS}`,
      `WIN_CSC_KEY_PASSWORD=${winPass}`,
      "# ANDROID_KEYSTORE_B64 = base64 -w0 android-release.p12",
      "# WIN_CSC_LINK        = base64 -w0 windows-codesign.pfx",
      "# UPDATE_SIGNING_KEY  = contents of update-private.pem",
      "",
    ].join("\n"),
  );

  console.log(`Keys created in ${KEYS_DIR} (chmod 700/600).`);
  console.log(`Public update key written to ${path.relative(ROOT, PUBLIC_KEY)} (commit this one).`);
  console.log("BACK UP THIS FOLDER NOW. Losing android-release.p12 means installed Android apps can never be updated.");
  info();
}

export function androidCertSha256(storeFile = path.join(KEYS_DIR, "android-release.p12"), props = path.join(KEYS_DIR, "signing.properties")) {
  const pass = /storePassword=(.*)/.exec(readFileSync(props, "utf8"))[1].trim();
  const out = execFileSync("keytool", ["-list", "-v", "-storetype", "PKCS12", "-keystore", storeFile, "-storepass", pass, "-alias", ALIAS], { encoding: "utf8" });
  return /SHA256:\s*([0-9A-F:]+)/.exec(out)[1].replace(/:/g, "").toLowerCase();
}

export function windowsThumbprint(pfx = path.join(KEYS_DIR, "windows-codesign.pfx")) {
  const pass = /WIN_CSC_KEY_PASSWORD=(.*)/.exec(readFileSync(path.join(KEYS_DIR, "secrets.env"), "utf8"))[1].trim();
  const pem = execFileSync("openssl", ["pkcs12", "-in", pfx, "-nokeys", "-clcerts", "-passin", `pass:${pass}`], { encoding: "utf8" });
  const fp = execFileSync("openssl", ["x509", "-noout", "-fingerprint", "-sha1"], { input: pem, encoding: "utf8" });
  return /=([0-9A-F:]+)/.exec(fp)[1].replace(/:/g, "");
}

function info() {
  const pub = readFileSync(PUBLIC_KEY, "utf8");
  const spki = Buffer.from(pub.replace(/-----[^-]+-----|\s/g, ""), "base64");
  console.log(`update key id:         ${createHash("sha256").update(spki).digest("hex").slice(0, 16)}`);
  if (existsSync(path.join(KEYS_DIR, "signing.properties"))) console.log(`android cert sha256:   ${androidCertSha256()}`);
  if (existsSync(path.join(KEYS_DIR, "windows-codesign.pfx"))) console.log(`windows signer sha1:   ${windowsThumbprint()}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "init") init();
  else if (cmd === "info") info();
  else console.log("usage: node scripts/release-keys.mjs init|info");
}
