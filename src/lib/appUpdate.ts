// App updates from zeidexsoft.com. The manifest is signed with the ZeidexSoft release key
// (scripts/release-manifest.mjs); a manifest that fails verification is ignored, so a compromised
// host or a man-in-the-middle cannot push a fake update.
import publicPem from "../../keys/update-public.pem?raw";
import { fromBase64 } from "./native";

declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

export interface UpdateAsset {
  file: string;
  url: string;
  size: number;
  sha256: string;
  certSha256?: string;
  signerSha1?: string;
}

export interface UpdatePayload {
  app: string;
  version: string;
  versionCode: number;
  published: string;
  notes: { ar: string; en: string };
  page: string;
  assets: Record<string, UpdateAsset>;
}

export interface SignedManifest {
  format: number;
  keyId: string;
  payload: string;
  sigDer: string;
  sigP1363: string;
}

/** Numeric semver comparison; pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map(Number);
  const pb = b.split(/[.+-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

const pemToDer = (pem: string) => fromBase64(pem.replace(/-----[^-]+-----|\s/g, ""));

export async function verifyManifest(m: SignedManifest, pem = publicPem): Promise<UpdatePayload> {
  if (m.format !== 1) throw new Error("unknown manifest format");
  const key = await crypto.subtle.importKey("spki", pemToDer(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const bytes = fromBase64(m.payload);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromBase64(m.sigP1363), bytes);
  if (!ok) throw new Error("bad update signature");
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as UpdatePayload;
  if (payload.app !== "zeidex-lexi-local") throw new Error("manifest is for another app");
  return payload;
}

/** Returns the newer release, or null when up to date. Throws on network or signature errors. */
export async function checkAppUpdate(url: string, current = APP_VERSION): Promise<UpdatePayload | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await verifyManifest((await res.json()) as SignedManifest);
  return compareVersions(payload.version, current) > 0 ? payload : null;
}
