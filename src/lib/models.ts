import type { GpuPrecision } from "./settings";

export interface ModelOption {
  id: string;
  label: string;
  vramMB: number;
  /** Characters of source text per chunk; sized for the model's 4K-token context. */
  chunkChars: number;
  note: { ar: string; en: string };
}

// WebLLM 0.2.86 prebuilt IDs, all with a 4096-token context. q4f16 needs `shader-f16`; see `forGpu`.
export const WEBGPU_MODELS: ModelOption[] = [
  {
    id: "Qwen3.5-2B-q4f16_1-MLC",
    label: "Qwen3.5 2B",
    vramMB: 2245,
    chunkChars: 4000,
    note: { ar: "متوازن — عربية جيدة، يناسب معظم الأجهزة", en: "Balanced — good Arabic, fits most GPUs" },
  },
  {
    id: "Qwen3.5-4B-q4f16_1-MLC",
    label: "Qwen3.5 4B",
    vramMB: 3868,
    chunkChars: 4000,
    note: { ar: "جودة أعلى — يحتاج بطاقة رسوميات أقوى", en: "Higher quality — needs a stronger GPU" },
  },
  {
    id: "Qwen3.5-9B-q4f16_1-MLC",
    label: "Qwen3.5 9B",
    vramMB: 6433,
    chunkChars: 4000,
    note: { ar: "أفضل جودة — لبطاقات 8GB فأكثر", en: "Best quality — for 8 GB+ GPUs" },
  },
  {
    id: "Qwen3.5-0.8B-q4f16_1-MLC",
    label: "Qwen3.5 0.8B",
    vramMB: 1629,
    chunkChars: 3500,
    note: { ar: "خفيف وسريع — للهواتف والأجهزة الضعيفة", en: "Light and fast — phones and low-end devices" },
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B",
    vramMB: 2264,
    chunkChars: 5000,
    note: { ar: "ممتاز للإنجليزية، أضعف في العربية", en: "Strong in English, weaker in Arabic" },
  },
];

export const CPU_MODEL: ModelOption = {
  id: "onnx-community/Qwen2.5-0.5B-Instruct",
  label: "Qwen2.5 0.5B (CPU)",
  vramMB: 0,
  chunkChars: 2500,
  note: { ar: "بديل يعمل على المعالج دون WebGPU", en: "CPU fallback when WebGPU is missing" },
};

/** Swaps to the 32-bit-float shader build when the GPU lacks `shader-f16`. */
export const forGpu = (id: string, f16: boolean) => (f16 ? id : id.replace("q4f16_1", "q4f32_1"));

const MOBILE = /Android|iPhone|iPad|Mobile/i;

/**
 * Whether to run the 16-bit shader build. Phone GPUs (Adreno, Mali) lose precision in 16-bit math and
 * Qwen3.5's DeltaNet layers then emit token soup ("une-m-m-m…"), so "auto" uses 32-bit there; it costs
 * about 15% more GPU memory and computes correctly.
 */
export function wantsF16(gpuF16: boolean, pref: GpuPrecision, ua = navigator.userAgent): boolean {
  if (!gpuF16 || pref === "f32") return false;
  return pref === "f16" || !MOBILE.test(ua);
}

const GiB = 1024 ** 3;

/** Phones and GPUs with small buffer limits get the 0.8B model; everything else the balanced 2B. */
export function recommendModel(gpu: { webgpu: boolean; maxBufferSize?: number }): ModelOption {
  if (!gpu.webgpu) return CPU_MODEL;
  const mobile = MOBILE.test(navigator.userAgent);
  const small = (gpu.maxBufferSize ?? 0) < GiB;
  return mobile || small ? WEBGPU_MODELS.find((m) => m.id.startsWith("Qwen3.5-0.8B"))! : WEBGPU_MODELS[0];
}
