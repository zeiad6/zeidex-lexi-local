#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 ZeidexSoft — https://zeidexsoft.com
//
// Zero-dependency server used by `npm run serve`, `npm run share`, Docker and the desktop app:
//  - serves dist/ with the headers WebGPU/WASM need (COOP/COEP => multithreaded WASM fallback)
//  - LAN sharing on demand, over self-signed HTTPS when openssl exists (WebGPU needs a secure context)
//  - firewall detection with the exact command to open the port
//  - an allowlisted proxy to cloud LLM APIs, so browser CORS never blocks a provider

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, createReadStream } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PROVIDERS = JSON.parse(readFileSync(path.join(ROOT, "src", "providers.json"), "utf8")).providers;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const FORWARD_REQUEST_HEADERS = ["authorization", "x-api-key", "anthropic-version", "anthropic-beta", "content-type", "accept", "x-title"];
const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|lxc|lxd|cni|flannel|podman|vethernet|hyper-v|wsl)/i;
const VPN_IFACE = /^(tun|tap|wg|utun|tailscale|zt|ppp|ipsec|nordlynx|proton)/i;

// ---------- pure helpers (unit-tested in server.test.mjs) ----------

export function isPrivateIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Ranks network interfaces so the address a phone on the same Wi-Fi can reach comes first. */
export function classifyInterfaces(ifaces) {
  const out = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.internal || a.family !== "IPv4" || a.address.startsWith("169.254.")) continue;
      const kind = VIRTUAL_IFACE.test(name) ? "virtual" : VPN_IFACE.test(name) ? "vpn" : isPrivateIPv4(a.address) ? "lan" : "vpn";
      out.push({ iface: name, address: a.address, kind });
    }
  }
  const rank = { lan: 0, vpn: 1, virtual: 2 };
  return out.sort((x, y) => rank[x.kind] - rank[y.kind] || Number(/^(en|eth|wl|wi)/i.test(y.iface)) - Number(/^(en|eth|wl|wi)/i.test(x.iface)));
}

/** Resolves a URL path inside root, refusing traversal. Returns null when outside. */
export function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const full = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

const isLoopback = (addr = "") => addr === "::1" || addr.startsWith("127.") || addr === "::ffff:127.0.0.1";

/**
 * Decides the upstream for /api/proxy/<provider>/...: catalog hosts are always allowed; a custom
 * base URL only when its host is allowlisted (LEXI_PROXY_ALLOW) or it is localhost and the caller
 * is local too. This keeps the proxy from becoming an open relay on the LAN.
 */
export function proxyTarget(providerId, rest, customBase, clientAddr, allow = []) {
  const def = PROVIDERS.find((p) => p.id === providerId);
  if (!def) return null;
  const base = customBase || def.baseUrl;
  if (!base) return null;
  let u;
  try {
    u = new URL(base.replace(/\/+$/, "") + rest);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const catalogHosts = PROVIDERS.map((p) => p.baseUrl && new URL(p.baseUrl).host).filter(Boolean);
  const localTarget = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (localTarget) return isLoopback(clientAddr) ? u : null;
  return catalogHosts.includes(u.host) || allow.includes(u.host) ? u : null;
}

// ---------- firewall + certificates ----------

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000 });
  } catch {
    return null;
  }
}

export function firewallAdvice(port, platform = process.platform) {
  if (platform === "win32") {
    const state = run("netsh", ["advfirewall", "show", "currentprofile", "state"]);
    return {
      tool: "Windows Defender Firewall",
      active: state ? /ON/i.test(state) : null,
      command: `netsh advfirewall firewall add rule name="Zeidex Lexi Local" dir=in action=allow protocol=TCP localport=${port} profile=private`,
      note: "Run in an Administrator terminal. The rule is limited to Private networks, so public Wi-Fi stays closed.",
    };
  }
  if (platform === "darwin") {
    return { tool: "macOS Application Firewall", active: null, command: null, note: "macOS asks once to allow incoming connections; choose Allow." };
  }
  const ufw = run("ufw", ["status"]);
  if (ufw && /Status: active/i.test(ufw)) {
    return { tool: "ufw", active: true, command: `sudo ufw allow ${port}/tcp comment 'Zeidex Lexi Local'`, note: "ufw is active: allow the port once." };
  }
  const firewalld = run("firewall-cmd", ["--state"]);
  if (firewalld && /running/i.test(firewalld)) {
    return { tool: "firewalld", active: true, command: `sudo firewall-cmd --add-port=${port}/tcp`, note: "Opens the port until reboot (no --permanent)." };
  }
  return { tool: platform === "linux" ? "none detected" : platform, active: false, command: null, note: "No active firewall found." };
}

function dataDir() {
  const base = process.env.LEXI_DATA || path.join(os.homedir(), ".config", "zeidex-lexi-local");
  mkdirSync(base, { recursive: true });
  return base;
}

/** Self-signed cert covering localhost and every LAN address; regenerated when the IP set changes. */
function ensureCert(addresses) {
  if (process.env.LEXI_HTTPS === "0" || !run("openssl", ["version"])) return null;
  const dir = dataDir();
  const key = path.join(dir, "lan-key.pem");
  const cert = path.join(dir, "lan-cert.pem");
  const sanFile = path.join(dir, "lan-san.txt");
  // LEXI_CERT_HOSTS adds names/IPs the container can't see itself (the Docker host's LAN IP).
  const extra = (process.env.LEXI_CERT_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const san = ["DNS:localhost", "IP:127.0.0.1", ...addresses.map((a) => `IP:${a}`), ...extra.map((h) => (/^[\d.]+$/.test(h) ? `IP:${h}` : `DNS:${h}`))].join(",");
  const fresh = existsSync(cert) && existsSync(sanFile) && readFileSync(sanFile, "utf8") === san;
  if (!fresh) {
    try {
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "825",
        "-subj", "/CN=Zeidex Lexi Local", "-addext", `subjectAltName=${san}`,
        "-keyout", key, "-out", cert,
      ], { stdio: "ignore", timeout: 20000 });
      execFileSync(process.execPath, ["-e", `require('fs').writeFileSync(${JSON.stringify(sanFile)}, ${JSON.stringify(san)})`]);
    } catch {
      return null;
    }
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

// ---------- request handling ----------

function securityHeaders(res, coep) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (coep) {
    // Cross-origin isolation unlocks SharedArrayBuffer => multithreaded ONNX/WASM. `credentialless`
    // still allows Google Fonts and Hugging Face downloads without CORP headers.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function handleProxy(req, res, providerId, rest) {
  const allow = (process.env.LEXI_PROXY_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const target = proxyTarget(providerId, rest, req.headers["x-lexi-base-url"], req.socket.remoteAddress, allow);
  if (!target) return sendJson(res, 403, { error: "target not allowed by proxy policy" });
  const headers = {};
  for (const h of FORWARD_REQUEST_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const upstream = await fetch(target, { method: req.method, headers, body, signal: controller.signal });
    const out = { "Cache-Control": "no-store" };
    for (const h of ["content-type", "retry-after", "request-id"]) {
      const v = upstream.headers.get(h);
      if (v) out[h] = v;
    }
    res.writeHead(upstream.status, out);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch (e) {
    if (!res.headersSent) sendJson(res, 502, { error: String(e?.message ?? e) });
    else res.end();
  }
}

function serveStatic(req, res, dist) {
  let file = safeJoin(dist, new URL(req.url, "http://x").pathname);
  if (!file) return sendJson(res, 400, { error: "bad path" });
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const index = path.join(file ?? dist, "index.html");
    file = existsSync(index) ? index : path.join(dist, "index.html"); // SPA fallback
  }
  if (!existsSync(file)) return sendJson(res, 404, { error: "dist/ not built — run npm run build" });
  const ext = path.extname(file).toLowerCase();
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

// ---------- server lifecycle ----------

async function listen(server, host, port, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port + i, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return server.address().port;
    } catch (e) {
      if (e.code !== "EADDRINUSE" || i === tries - 1) throw e;
    }
  }
}

export async function startServer(opts = {}) {
  const dist = path.resolve(opts.dist ?? process.env.LEXI_DIST ?? path.join(ROOT, "dist"));
  const coep = (process.env.LEXI_COEP ?? "1") !== "0";
  const docker = existsSync("/.dockerenv");
  const state = { lan: null, lanPort: 0, https: false };

  const lanInfo = () => {
    const addrs = classifyInterfaces(os.networkInterfaces());
    const scheme = state.https ? "https" : "http";
    const urls = state.lan
      ? process.env.LEXI_PUBLIC_URL
        ? [{ url: process.env.LEXI_PUBLIC_URL, iface: "configured", kind: "lan" }]
        : addrs.map((a) => ({ url: `${scheme}://${a.address}:${state.lanPort}/`, iface: a.iface, kind: a.kind }))
      : [];
    return { enabled: !!state.lan, https: state.https, urls, firewall: firewallAdvice(state.lanPort || mainPort), docker };
  };

  const handler = async (req, res) => {
    securityHeaders(res, coep);
    const { pathname } = new URL(req.url, "http://x");
    try {
      if (pathname.startsWith("/api/proxy/")) {
        const [, , , providerId, ...rest] = pathname.split("/");
        const search = new URL(req.url, "http://x").search;
        return await handleProxy(req, res, providerId, "/" + rest.join("/") + search);
      }
      if (pathname === "/api/lan" && req.method === "GET") return sendJson(res, 200, lanInfo());
      if (pathname === "/api/share" && req.method === "POST") {
        // Only the machine running the app may open or close the LAN port.
        if (!isLoopback(req.socket.remoteAddress)) return sendJson(res, 403, { error: "only the host can change sharing" });
        const { enable } = JSON.parse((await readBody(req, 1024)).toString() || "{}");
        if (enable) await enableLan();
        else await disableLan();
        return sendJson(res, 200, lanInfo());
      }
      if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" });
      return serveStatic(req, res, dist);
    } catch (e) {
      if (!res.headersSent) sendJson(res, 500, { error: String(e?.message ?? e) });
    }
  };

  async function enableLan() {
    if (state.lan) return;
    const addrs = classifyInterfaces(os.networkInterfaces()).map((a) => a.address);
    const tls = ensureCert(addrs);
    const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
    state.lanPort = await listen(server, "0.0.0.0", opts.lanPort ?? mainPort + 1);
    state.lan = server;
    state.https = !!tls;
    if (process.env.LEXI_OPEN_FIREWALL === "1") {
      const advice = firewallAdvice(state.lanPort);
      if (advice.command) execFile(process.platform === "win32" ? "cmd" : "sh", process.platform === "win32" ? ["/c", advice.command] : ["-c", advice.command], () => {});
    }
  }

  async function disableLan() {
    if (!state.lan || state.lan === main) return; // bound to all interfaces from the start: nothing to close
    await new Promise((r) => state.lan.close(r));
    state.lan = null;
  }

  const main = http.createServer(handler);
  const host = opts.host ?? process.env.LEXI_HOST ?? "127.0.0.1";
  const mainPort = await listen(main, host, Number(opts.port ?? process.env.PORT ?? 8787));
  if (host === "0.0.0.0") {
    // Docker / `--host 0.0.0.0`: plain HTTP is already reachable; add HTTPS on the next port when a
    // certificate can be made, because LAN browsers only enable WebGPU in a secure context.
    if (ensureCert(classifyInterfaces(os.networkInterfaces()).map((a) => a.address))) await enableLan();
    else {
      state.lan = main;
      state.lanPort = mainPort;
    }
  } else if (opts.lan) await enableLan();

  return {
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${mainPort}/`,
    lanInfo,
    enableLan,
    disableLan,
    close: async () => {
      await disableLan();
      state.lan = null;
      await new Promise((r) => main.close(r));
    },
  };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lan") o.lan = true;
    else if (a === "--open") o.open = true;
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--host") o.host = argv[++i];
    else if (a === "--dist") o.dist = argv[++i];
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const s = await startServer(args);
  console.log(`\n  Zeidex Lexi Local  →  ${s.url}`);
  const info = s.lanInfo();
  if (info.enabled) {
    for (const u of info.urls) console.log(`  LAN (${u.iface}${u.kind === "lan" ? "" : `, ${u.kind}`})  →  ${u.url}`);
    if (info.docker) console.log("  Docker: open the host machine's IP with the published port.");
    if (info.firewall.command) console.log(`  Firewall (${info.firewall.tool}): ${info.firewall.command}`);
    console.log(info.https ? "  HTTPS self-signed: accept the warning once on each device." : "  HTTP only (openssl missing): WebGPU works on this machine, other devices can use Cloud mode.");
  }
  console.log("");
  if (args.open) {
    const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", s.url]] : process.platform === "darwin" ? ["open", [s.url]] : ["xdg-open", [s.url]];
    execFile(cmd[0], cmd[1], () => {});
  }
  const stop = () => s.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
