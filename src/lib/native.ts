// Bridges to the native shells. The same web bundle runs in a browser, in the Electron desktop app
// (window.lexiDesktop, via preload) and in the Android app (window.LexiAndroid, via addJavascriptInterface).

/** Methods exposed by android/app/src/main/java/com/zeidexsoft/lexilocal/Bridge.kt. */
export interface AndroidBridge {
  notify(title: string, body: string): void;
  jobStart(label: string): void;
  jobProgress(label: string, done: number, total: number): void;
  jobEnd(title: string, body: string, ok: boolean): void;
  saveFile(name: string, mime: string, base64: string): string;
  share(text: string, title: string): void;
  shareApp(): void;
  copyText(text: string): void;
  httpStart(id: string, method: string, url: string, headersJson: string, bodyBase64: string): void;
  httpAbort(id: string): void;
  checkUpdates(manual: boolean): void;
  configureUpdates(enabled: boolean, url: string): void;
  setSystemBars(dark: boolean): void;
  appInfo(): string;
  openExternal(url: string): void;
  /** Added in 1.1; older installed shells lack it. */
  printHtml?(html: string, jobName: string): void;
}

/** Exposed by electron/preload.cjs. */
export interface DesktopBridge {
  checkUpdates(manual: boolean): Promise<unknown>;
  appInfo(): Promise<{ version: string; platform: string }>;
  /** Resolves to the saved path, or null when the user cancels the save dialog. */
  printToPdf?(html: string, name: string): Promise<string | null>;
}

export type HttpEvent =
  | { type: "head"; status: number; headers: Record<string, string> }
  | { type: "chunk"; data: string }
  | { type: "end" }
  | { type: "error"; message: string };

declare global {
  interface Window {
    LexiAndroid?: AndroidBridge;
    lexiDesktop?: DesktopBridge;
    __lexiHttp?: (id: string, ev: HttpEvent) => void;
    __lexiBack?: () => boolean;
    __lexiOpenFile?: (name: string, mime: string, base64: string) => void;
  }
}

const w = typeof window === "undefined" ? undefined : window;
export const android = w?.LexiAndroid;
export const desktop = w?.lexiDesktop;
export const platform: "android" | "desktop" | "web" = android ? "android" : desktop ? "desktop" : "web";

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array | null> {
  if (body == null) return null;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * A `fetch` implemented over the Android bridge: the request runs in native code, so browser CORS
 * rules never block a cloud provider, and the response still streams chunk by chunk.
 */
export function createBridgeFetch(bridge: Pick<AndroidBridge, "httpStart" | "httpAbort">, register: (cb: (id: string, ev: HttpEvent) => void) => void): typeof fetch {
  const pending = new Map<string, (ev: HttpEvent) => void>();
  register((id, ev) => pending.get(id)?.(ev));

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = req ? req.url : input instanceof URL ? input.href : String(input);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers ?? req?.headers).entries());
    const body = await bodyBytes(init?.body ?? (req && method !== "GET" ? await req.arrayBuffer() : null));
    const id = crypto.randomUUID();
    const signal = init?.signal ?? req?.signal;
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");

    return new Promise<Response>((resolve, reject) => {
      let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
      let headed = false;
      const stream = new ReadableStream<Uint8Array>({
        start: (c) => void (ctrl = c),
        cancel: () => bridge.httpAbort(id),
      });
      const fail = (err: Error) => {
        pending.delete(id);
        if (headed) ctrl?.error(err);
        else reject(err);
      };
      signal?.addEventListener("abort", () => {
        bridge.httpAbort(id);
        fail(new DOMException("aborted", "AbortError"));
      });
      pending.set(id, (ev) => {
        if (ev.type === "head") {
          headed = true;
          resolve(new Response(NO_BODY.has(ev.status) ? null : stream, { status: ev.status, headers: ev.headers }));
        } else if (ev.type === "chunk") ctrl?.enqueue(fromBase64(ev.data));
        else if (ev.type === "end") {
          pending.delete(id);
          ctrl?.close();
        } else fail(new TypeError(ev.message));
      });
      bridge.httpStart(id, method, url, JSON.stringify(headers), body ? toBase64(body) : "");
    });
  }) as typeof fetch;
}

export const nativeFetch: typeof fetch | undefined = android
  ? createBridgeFetch(android, (cb) => {
      window.__lexiHttp = cb;
    })
  : undefined;

/** Long jobs keep running with the screen off on Android: a foreground service holds the process. */
export const job = {
  start: (label: string) => android?.jobStart(label),
  progress: (label: string, done: number, total: number) => android?.jobProgress(label, done, total),
  end: (title: string, body: string, ok: boolean) => android?.jobEnd(title, body, ok),
};

export async function copyText(text: string) {
  if (android) return android.copyText(text);
  await navigator.clipboard.writeText(text);
}

/** Saves a generated file: MediaStore Downloads on Android, a normal download elsewhere. */
export function saveFile(name: string, content: string | Uint8Array, type: string): string | null {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  if (android) return android.saveFile(name, type, toBase64(bytes));
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  // Revoking synchronously can cancel the download in Safari and older Chromium.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}

// Files shared to the Android app ("Open with Lexi") can arrive before React mounts; queue them.
const openQueue: File[] = [];
let openHandler: ((f: File) => void) | null = null;
if (w) {
  w.__lexiOpenFile = (name, mime, b64) => {
    const file = new File([fromBase64(b64)], name, { type: mime });
    if (openHandler) openHandler(file);
    else openQueue.push(file);
  };
}
export function onOpenFile(handler: (f: File) => void) {
  openHandler = handler;
  openQueue.splice(0).forEach(handler);
  return () => {
    if (openHandler === handler) openHandler = null;
  };
}
