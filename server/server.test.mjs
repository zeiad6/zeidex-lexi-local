import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { classifyInterfaces, firewallAdvice, isPrivateIPv4, proxyTarget, safeJoin, startServer } from "./server.mjs";

test("private ranges", () => {
  for (const ip of ["10.0.0.1", "172.16.5.4", "192.168.1.9", "100.64.0.1"]) assert.ok(isPrivateIPv4(ip), ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "11.0.0.1"]) assert.ok(!isPrivateIPv4(ip), ip);
});

test("interfaces: Wi-Fi first, VPN and Docker bridges after, loopback/link-local dropped", () => {
  const r = classifyInterfaces({
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
    tun0: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
    wlan0: [{ address: "192.168.1.20", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }],
    eth9: [{ address: "169.254.3.3", family: "IPv4", internal: false }],
  });
  assert.deepEqual(r.map((x) => [x.iface, x.kind]), [["wlan0", "lan"], ["tun0", "vpn"], ["docker0", "virtual"]]);
});

test("safeJoin blocks traversal", () => {
  const root = path.resolve("/srv/dist");
  assert.equal(safeJoin(root, "/assets/a.js"), path.join(root, "assets/a.js"));
  assert.equal(safeJoin(root, "/../../etc/passwd"), path.join(root, "etc/passwd"));
  assert.equal(safeJoin(root, "/%2e%2e/%2e%2e/etc/passwd"), path.join(root, "etc/passwd"));
  assert.equal(safeJoin(root, "/%E0%A4%A"), null);
});

test("proxy allows catalog hosts, blocks arbitrary hosts and remote use of localhost", () => {
  assert.equal(proxyTarget("openai", "/chat/completions", undefined, "192.168.1.5")?.href, "https://api.openai.com/v1/chat/completions");
  assert.equal(proxyTarget("anthropic", "/v1/messages", undefined, "127.0.0.1")?.host, "api.anthropic.com");
  assert.equal(proxyTarget("custom", "/x", "http://169.254.169.254", "127.0.0.1"), null);
  assert.equal(proxyTarget("custom", "/x", "https://evil.example", "127.0.0.1"), null);
  assert.equal(proxyTarget("custom", "/x", "https://my.llm.lan", "127.0.0.1", ["my.llm.lan"])?.host, "my.llm.lan");
  assert.equal(proxyTarget("ollama", "/chat/completions", undefined, "127.0.0.1")?.host, "localhost:11434");
  assert.equal(proxyTarget("ollama", "/chat/completions", undefined, "192.168.1.7"), null);
  assert.equal(proxyTarget("nope", "/x", undefined, "127.0.0.1"), null);
});

test("firewall advice names a concrete command on Windows", () => {
  const a = firewallAdvice(8788, "win32");
  assert.match(a.command, /localport=8788 profile=private/);
});

test("server: static, SPA fallback, LAN toggle only from loopback", async () => {
  process.env.LEXI_HTTPS = "0";
  const s = await startServer({ port: 18787, dist: path.resolve("dist") });
  try {
    const home = await fetch(s.url);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("cross-origin-embedder-policy"), "credentialless");
    assert.equal((await fetch(s.url + "some/deep/route")).headers.get("content-type"), "text/html; charset=utf-8");
    let info = await (await fetch(s.url + "api/lan")).json();
    assert.equal(info.enabled, false);
    info = await (await fetch(s.url + "api/share", { method: "POST", body: JSON.stringify({ enable: true }) })).json();
    assert.equal(info.enabled, true);
    assert.equal((await fetch(s.url + "api/proxy/custom/x", { headers: { "x-lexi-base-url": "https://evil.example" } })).status, 403);
  } finally {
    await s.close();
  }
});
