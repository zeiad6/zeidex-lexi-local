// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 ZeidexSoft — https://zeidexsoft.com
//
// Desktop shell for Windows (MSI) and Linux (AppImage/deb). It runs the bundled server in-process
// and opens the app in a hardened window. Electron ships Chromium, so WebGPU works the same on
// every distro instead of depending on the system WebView (WebKitGTK has no WebGPU).
import { app, BrowserWindow, Menu, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
// Chromium on Linux reaches WebGPU through Vulkan.
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "Vulkan");

if (!app.requestSingleInstanceLock()) app.quit();

let server;
let win;

async function createWindow() {
  // The server's data dir holds the LAN certificate; keep it with the app's own data.
  process.env.LEXI_DATA ??= app.getPath("userData");
  const { startServer } = await import("../server/server.mjs");
  server ??= await startServer({ host: "127.0.0.1", port: 0, dist: path.join(app.getAppPath(), "dist") });
  const origin = new URL(server.url).origin;

  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    backgroundColor: "#141b2b",
    title: "Zeidex Lexi Local",
    icon: path.join(HERE, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  // Links to the developer site, donation pages and API-key consoles open in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  await win.loadURL(server.url);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const allowed = new Set(["notifications", "clipboard-sanitized-write", "clipboard-read"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  createWindow();
});

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("window-all-closed", async () => {
  await server?.close().catch(() => {});
  app.quit();
});
