import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

// updater.mjs imports "electron"; stub it so the pure parts can run under plain Node.
mock.module("electron", { namedExports: { app: {}, dialog: {}, Notification: {}, shell: {} } });
const { assetFor, compareVersions, verifyManifest } = await import("./updater.mjs");

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = publicKey.export({ type: "spki", format: "pem" });
const signed = (payload) => {
  const bytes = Buffer.from(JSON.stringify(payload));
  return { format: 1, payload: bytes.toString("base64"), sigDer: sign("sha256", bytes, { key: privateKey, dsaEncoding: "der" }).toString("base64") };
};

test("verifies signature and app id", () => {
  assert.equal(verifyManifest(signed({ app: "zeidex-lexi-local", version: "1.1.0" }), pem).version, "1.1.0");
  const forged = { ...signed({ app: "zeidex-lexi-local", version: "1.1.0" }), payload: Buffer.from('{"app":"zeidex-lexi-local","version":"9"}').toString("base64") };
  assert.throws(() => verifyManifest(forged, pem), /signature/);
  assert.throws(() => verifyManifest(signed({ app: "other" }), pem), /another app/);
});

test("picks the asset this install can apply", () => {
  const assets = { windows: { url: "w" }, "linux-appimage-x64": { url: "a" }, "linux-deb-x64": { url: "d" } };
  assert.equal(assetFor(assets, "win32", "x64").kind, "msi");
  assert.equal(assetFor(assets, "linux", "x64", "/opt/Lexi.AppImage").kind, "appimage");
  assert.equal(assetFor(assets, "linux", "x64", undefined).kind, "page");
  assert.equal(assetFor(assets, "linux", "arm64", "/x.AppImage"), null);
  assert.equal(compareVersions("1.0.1", "1.0.0"), 1);
});
