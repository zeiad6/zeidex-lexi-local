export interface GpuReport {
  webgpu: boolean;
  f16: boolean;
  adapter?: string;
  maxBufferSize?: number;
  storageUsed?: number;
  storageQuota?: number;
  persisted?: boolean;
  reason?: string;
}

export async function checkGpu(): Promise<GpuReport> {
  const report: GpuReport = { webgpu: false, f16: false };
  try {
    const est = await navigator.storage?.estimate?.();
    report.storageUsed = est?.usage;
    report.storageQuota = est?.quota;
    // Ask the browser not to evict multi-GB model weights under storage pressure.
    report.persisted = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.());
  } catch {
    // Storage APIs are optional; the report just omits them.
  }
  if (!("gpu" in navigator) || !navigator.gpu) return { ...report, reason: "navigator.gpu missing" };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { ...report, reason: "no adapter" };
    const info = adapter.info;
    return {
      ...report,
      webgpu: true,
      f16: adapter.features.has("shader-f16"),
      adapter: [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" · ") || undefined,
      maxBufferSize: adapter.limits.maxBufferSize,
    };
  } catch (e) {
    return { ...report, reason: String(e) };
  }
}
