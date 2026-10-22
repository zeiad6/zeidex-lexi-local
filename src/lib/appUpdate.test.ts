import { expect, test } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { compareVersions, verifyManifest } from "./appUpdate";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = publicKey.export({ type: "spki", format: "pem" }) as string;

function manifest(payload: object) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    format: 1,
    keyId: "test",
    payload: bytes.toString("base64"),
    sigDer: sign("sha256", bytes, { key: privateKey, dsaEncoding: "der" }).toString("base64"),
    sigP1363: sign("sha256", bytes, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64"),
  };
}

test("semver comparison", () => {
  expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
});

test("browser-side verification accepts a signed manifest and rejects forgeries", async () => {
  const good = manifest({ app: "zeidex-lexi-local", version: "1.2.0", assets: {} });
  expect((await verifyManifest(good, pem)).version).toBe("1.2.0");

  const forged = { ...good, payload: Buffer.from(JSON.stringify({ app: "zeidex-lexi-local", version: "9.0.0" })).toString("base64") };
  await expect(verifyManifest(forged, pem)).rejects.toThrow(/signature/);

  const other = manifest({ app: "someone-else", version: "1.2.0" });
  await expect(verifyManifest(other, pem)).rejects.toThrow(/another app/);
});
