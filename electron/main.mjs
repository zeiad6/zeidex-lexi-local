// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 ZeidexSoft — https://zeidexsoft.com
//
// Desktop shell for Windows (MSI) and Linux (AppImage/deb). It runs the bundled server in-process
// and opens the app in a hardened window. Electron ships Chromium, so WebGPU works the same on
// every distro instead of depending on the system WebView (WebKitGTK has no WebGPU).
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UPDATE_CHECK_EVERY_MS = 12 * 3600 * 1000;

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
// Chromium on Linux reaches WebGPU through Vulkan.
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "Vulkan");

if (!app.requestSingleInstanceLock()) app.quit();

let server;
let win;
let appOrigin = "";

async function createWindow() {
  // The server's data dir holds the LAN certificate; keep it with the app's own data.
  process.env.LEXI_DATA ??= app.getPath("userData");
  const { startServer } = await import("../server/server.mjs");
  server ??= await startServer({ host: "127.0.0.1", port: 0, dist: path.join(app.getAppPath(), "dist") });
  const origin = new URL(server.url).origin;
  appOrigin = origin;

  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    backgroundColor: "#141b2b",
    title: "Zeidex Lexi Local",
    icon: path.join(HERE, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(HERE, "preload.cjs") },
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

async function updates(manual) {
  const { checkForUpdates } = await import("./updater.mjs");
  return checkForUpdates({ manual, win });
}

ipcMain.handle("lexi:check-updates", (_e, manual) => updates(manual));
ipcMain.handle("lexi:app-info", () => ({ version: app.getVersion(), platform: process.platform }));

// Exports a result as PDF: Chromium lays out the app's print HTML (so Arabic shapes correctly) and
// writes the file where the user chooses. Only our own page may ask.
ipcMain.handle("lexi:print-pdf", async (e, html, name) => {
  if (!appOrigin || !e.senderFrame?.url.startsWith(appOrigin)) throw new Error("forbidden");
  const safe = `${String(name).replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120) || "lexi"}.pdf`;
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender) ?? win, {
    defaultPath: path.join(app.getPath("documents"), safe),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return null;
  const off = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
  try {
    await off.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(String(html)).toString("base64")}`);
    await writeFile(filePath, await off.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
    return filePath;
  } finally {
    off.destroy();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // Packaged builds check zeidexsoft.com shortly after start and twice a day; dev runs never self-update.
  if (app.isPackaged) {
    setTimeout(() => updates(false), 15000);
    setInterval(() => updates(false), UPDATE_CHECK_EVERY_MS);
  }
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
