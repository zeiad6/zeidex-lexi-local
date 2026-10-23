import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, webcrypto } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeArtifacts, signManifest, verifyManifest, versionCode } from "./release-manifest.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const priv = privateKey.export({ type: "pkcs8", format: "pem" });
const pub = publicKey.export({ type: "spki", format: "pem" });

test("versionCode is monotonic across semver", () => {
  assert.equal(versionCode("1.0.0"), 10000);
  assert.ok(versionCode("1.2.10") > versionCode("1.2.9"));
  assert.ok(versionCode("2.0.0") > versionCode("1.99.99"));
});

test("manifest verifies with Node (DER) and WebCrypto (P1363), and rejects tampering", async () => {
  const m = signManifest({ app: "x", version: "1.0.1", assets: {} }, priv);
  assert.equal(verifyManifest(m, pub).version, "1.0.1");

  const key = await webcrypto.subtle.importKey("spki", publicKey.export({ type: "spki", format: "der" }), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(m.sigP1363, "base64"), Buffer.from(m.payload, "base64"));
  assert.ok(ok);

  const tampered = { ...m, payload: Buffer.from(JSON.stringify({ app: "x", version: "9.9.9", assets: {} })).toString("base64") };
  assert.throws(() => verifyManifest(tampered, pub), /bad update signature/);
});

test("artifacts are classified and hashed", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lexi-rel-"));
  for (const f of ["Zeidex-Lexi-Local-1.0.0.apk", "Zeidex-Lexi-Local-1.0.0-win-x64.msi", "Zeidex-Lexi-Local-1.0.0-linux-x86_64.AppImage", "Zeidex-Lexi-Local-1.0.0-linux-arm64.AppImage", "x-amd64.deb", "notes.txt"])
    writeFileSync(path.join(dir, f), f);
  const a = describeArtifacts(dir, "https://zeidexsoft.com/downloads/lexi-local/");
  assert.deepEqual(Object.keys(a).sort(), ["android", "linux-appimage-arm64", "linux-appimage-x64", "linux-deb-x64", "windows"]);
  assert.equal(a.windows.url, "https://zeidexsoft.com/downloads/lexi-local/Zeidex-Lexi-Local-1.0.0-win-x64.msi");
  assert.equal(a.android.sha256.length, 64);
});

test("release notes come from the matching CHANGELOG section", async () => {
  const { changelogSection, releaseNotes } = await import("./release-notes.mjs");
  const log = "# Changelog\n\n## [1.2.0] - x\n### Added\n- new\n\n## [1.1.0] - y\n- old\n";
  assert.equal(changelogSection(log, "v1.2.0"), "### Added\n- new");
  assert.equal(changelogSection(log, "1.1.0"), "- old");
  assert.equal(changelogSection(log, "9.9.9"), null);
  const notes = releaseNotes(log, "v1.2.0");
  assert.match(notes, /Zeidex-Lexi-Local-1\.2\.0-android\.apk/);
  assert.match(notes, /keys\/update-public\.pem/);
  assert.throws(() => releaseNotes(log, "2.0.0"), /no section/);
});

test("every released version has a CHANGELOG entry", async () => {
  const { changelogSection } = await import("./release-notes.mjs");
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(changelogSection(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), pkg.version), `add ## [${pkg.version}] to CHANGELOG.md`);
});
