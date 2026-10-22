// Pure text helpers: no DOM, no imports, so `node --test` can run them directly.

const SEPARATORS = ["\n\n", "\n", ". ", "。", "؟ ", "? ", "! ", "، ", ", ", " ", ""];

/** Recursive character splitter: tries coarse separators first, falls back to finer ones. */
export function chunkText(text: string, chunkSize = 4000, overlap = 200): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const pieces = split(clean, chunkSize, 0);
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length > chunkSize) {
      chunks.push(current.trim());
      // Carry the tail of the previous chunk so context is not cut mid-thought.
      current = (overlap > 0 ? current.slice(-overlap) : "") + piece; // slice(-0) would keep everything
    } else {
      current += piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function split(text: string, size: number, level: number): string[] {
  if (text.length <= size) return [text];
  const sep = SEPARATORS[level];
  if (sep === "") {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }
  const parts = text.split(sep);
  if (parts.length === 1) return split(text, size, level + 1);
  return parts.flatMap((p, i) => {
    const withSep = i < parts.length - 1 ? p + sep : p;
    return withSep.length > size ? split(withSep, size, level + 1) : [withSep];
  });
}

/** Groups texts into batches whose joined length stays under `budget` characters. */
export function batchByLength(texts: string[], budget: number): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let len = 0;
  for (const t of texts) {
    if (batch.length && len + t.length > budget) {
      batches.push(batch);
      batch = [];
      len = 0;
    }
    batch.push(t);
    len += t.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Picks up to `n` items spread evenly across the array; `offset` in [0,1) shifts the sampling grid. */
export function spread<T>(items: T[], n: number, offset = 0): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor(((i + offset) * items.length) / n)]);
}

/** Extracts the first JSON object/array from model output (small models wrap JSON in prose or fences). */
export function extractJson<T = unknown>(raw: string): T | null {
  const start = raw.search(/[[{]/);
  if (start < 0) return null;
  const open = raw[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try {
        return JSON.parse(raw.slice(start, i + 1)) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface Mcq {
  question: string;
  options: string[];
  answer: number;
  explanation?: string;
}

export interface Flashcard {
  question: string;
  answer: string;
}

/** Keeps only well-formed items; local models occasionally emit broken ones. */
export function validateStudySet(data: unknown): { mcqs: Mcq[]; flashcards: Flashcard[] } {
  const obj = (data ?? {}) as { mcqs?: unknown; flashcards?: unknown };
  const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  const mcqs = (Array.isArray(obj.mcqs) ? obj.mcqs : []).filter(
    (m): m is Mcq =>
      isStr(m?.question) &&
      Array.isArray(m?.options) &&
      m.options.length === 4 &&
      m.options.every(isStr) &&
      Number.isInteger(m?.answer) &&
      m.answer >= 0 &&
      m.answer < 4,
  );
  const flashcards = (Array.isArray(obj.flashcards) ? obj.flashcards : []).filter(
    (f): f is Flashcard => isStr(f?.question) && isStr(f?.answer),
  );
  return { mcqs, flashcards };
}
