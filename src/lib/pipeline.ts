import type { Lang } from "@/i18n";
import { generate, type Recorder, type Task } from "./engine";
import { getSettings } from "./settings";
import { arabicRatio, Bm25, compress, dedupe } from "./nlp";
import {
  answerPrompt,
  chunkNotesPrompt,
  finalPrompt,
  mergeNotesPrompt,
  OPTION_LETTERS,
  refinePrompt,
  STUDY_SCHEMA,
  studyPrompt,
  verifyMcqPrompt,
  type ChatMessage,
  type SummaryFormat,
} from "./prompts";
import { batchByLength, chunkText, extractJson, spread, validateStudySet, type Flashcard, type Mcq } from "./text";

/**
 * fast: extractive pre-compression so a whole book costs at most `fastMaxChunks` (a setting) map calls.
 * balanced: full map-reduce over every chunk.
 * max: balanced + a self-refinement pass, and quiz items the model fails to answer itself are dropped.
 */
export type Quality = "fast" | "balanced" | "max";

const PROMPT_OVERHEAD = 520; // system prompt + task instructions, measured on the longest prompt

export type Phase = "compress" | "map" | "reduce" | "final" | "refine";

export interface SummaryProgress {
  phase: Phase;
  step: number;
  total: number;
  /** Estimated milliseconds left, from the average duration of finished calls. */
  eta?: number;
}

export class Aborted extends Error {}

// Qwen3.x may still emit an (empty) reasoning block even with enable_thinking=false.
const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();

/** Characters per token: Arabic text costs roughly 1.5x more tokens than English in these tokenizers. */
const charsPerToken = (sample: string) => (arabicRatio(sample) > 0.5 ? 2.4 : 3.6);
export const estimateTokens = (s: string) => Math.ceil(s.length / charsPerToken(s));

/** Shrinks `text` extractively until it fits `tokens`, instead of truncating away its ending. */
function fitTokens(text: string, tokens: number): string {
  const max = Math.floor(tokens * charsPerToken(text));
  return text.length <= max ? text : compress(text, max / text.length);
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}

// Notes depend only on (model, language, chunk text), so changing the output format or re-running
// reuses every map step already paid for.
const notesCache = new Map<string, string>();

export async function summarize(opts: {
  chunks: string[];
  chunkChars: number;
  format: SummaryFormat;
  lang: Lang;
  quality: Quality;
  model: string;
  keyTerms: string[];
  signal: AbortSignal;
  onProgress: (p: SummaryProgress) => void;
  onToken: (full: string) => void;
  record?: Recorder;
}): Promise<string> {
  const { chunkChars, format, lang, quality, signal, onProgress, onToken } = opts;
  const s = getSettings();
  let chunks = opts.chunks;

  if (quality === "fast" && chunks.length > s.fastMaxChunks) {
    onProgress({ phase: "compress", step: 1, total: 1 });
    const whole = chunks.join("\n\n");
    chunks = chunkText(compress(whole, s.fastMaxChunks / chunks.length), chunkChars, 150);
  }

  const planned = estimateCalls(chunks.length, chunkChars, quality === "fast" ? "balanced" : quality);
  const started = performance.now();
  let calls = 0;
  const report = (phase: Phase, step: number, total: number) => {
    const avg = calls ? (performance.now() - started) / calls : undefined;
    onProgress({ phase, step, total, eta: avg && avg * Math.max(0, planned - calls) });
  };

  const run = async (task: Task, messages: ChatMessage[], maxTokens: number, stream = false) => {
    if (signal.aborted) throw new Aborted();
    const r = await generate(task, messages, {
      maxTokens,
      record: opts.record,
      onToken: stream ? (_, full) => onToken(stripThinking(full)) : undefined,
    });
    calls++;
    if (r.aborted || signal.aborted) throw new Aborted();
    return stripThinking(r.text);
  };

  const notesFor = async (chunk: string, i: number) => {
    const key = `${opts.model}|${lang}|${hash(chunk)}`;
    const hit = notesCache.get(key);
    if (hit) return hit;
    const notes = await run("map", chunkNotesPrompt(chunk, i, chunks.length, lang), s.notesTokens);
    notesCache.set(key, notes);
    return notes;
  };

  let draft: string;
  let source: string;
  if (chunks.length === 1) {
    source = chunks[0];
    report("final", 1, 1);
    draft = await run("final", finalPrompt(source, format, lang, true, opts.keyTerms), s.finalTokens, true);
  } else {
    let notes: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      report("map", i + 1, chunks.length);
      notes.push(await notesFor(chunks[i], i));
    }
    while (notes.join("\n").length > chunkChars) {
      const batches = batchByLength(notes, chunkChars);
      if (batches.length === notes.length) break; // every note already fills a context; merging cannot shrink further
      const merged: string[] = [];
      for (let i = 0; i < batches.length; i++) {
        report("reduce", i + 1, batches.length);
        merged.push(batches[i].length === 1 ? batches[i][0] : await run("merge", mergeNotesPrompt(batches[i], lang), s.notesTokens));
      }
      notes = merged;
    }
    source = notes.join("\n\n");
    report("final", 1, 1);
    draft = await run("final", finalPrompt(source, format, lang, false, opts.keyTerms), s.finalTokens, true);
  }

  if (quality !== "max") return draft;
  const room = s.contextTokens - PROMPT_OVERHEAD - estimateTokens(draft) - s.refineTokens;
  if (room < 300) return draft; // draft already fills the window; a refine pass would truncate it
  report("refine", 1, 1);
  const refined = await run("refine", refinePrompt(draft, fitTokens(source, room), format, lang), s.refineTokens, true);
  // A refine that collapses to a fraction of the draft is a failure mode of small models, not an improvement.
  return refined.length > draft.length * 0.5 ? refined : draft;
}

/** Rough count of model calls, shown before the user starts a long job. */
export function estimateCalls(chunkCount: number, chunkChars: number, quality: Quality = "balanced"): number {
  const n = quality === "fast" ? Math.min(chunkCount, getSettings().fastMaxChunks) : chunkCount;
  if (n <= 1) return quality === "max" ? 2 : 1;
  const notesPerContext = Math.max(2, Math.floor(chunkChars / 1500)); // a notes block averages ~1.5K chars
  let calls = n + 1;
  for (let m = n; m > notesPerContext; m = Math.ceil(m / notesPerContext)) calls += Math.ceil(m / notesPerContext);
  return calls + (quality === "max" ? 1 : 0);
}

/** Small models put the right answer first far too often; reshuffle so position carries no signal. */
function shuffleOptions(m: Mcq): Mcq {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...m, options: order.map((i) => m.options[i]), answer: order.indexOf(m.answer) };
}

export interface StudyResult {
  mcqs: Mcq[];
  flashcards: Flashcard[];
  /** Questions removed by the self-check or as near-duplicates. */
  rejected: number;
}

export async function generateStudySet(opts: {
  chunks: string[];
  sections: number;
  lang: Lang;
  quality: Quality;
  constrained: boolean;
  signal: AbortSignal;
  onProgress: (step: number, total: number) => void;
  record?: Recorder;
}): Promise<StudyResult> {
  const s = getSettings();
  // A random offset so "generate a new set" samples different parts of the document.
  const picked = spread(opts.chunks, opts.sections, Math.random());
  const verify = opts.quality === "max";
  const mcqs: Mcq[] = [];
  const flashcards: Flashcard[] = [];
  let rejected = 0;
  const steps = picked.length * (verify ? 2 : 1);
  let step = 0;

  for (const chunk of picked) {
    if (opts.signal.aborted) break;
    opts.onProgress(++step, steps);
    const r = await generate("study", studyPrompt(chunk, opts.lang), {
      maxTokens: s.studyTokens,
      temperature: 0.4,
      record: opts.record,
      jsonSchema: opts.constrained ? STUDY_SCHEMA : undefined,
    });
    if (r.aborted) break;
    const set = validateStudySet(extractJson(stripThinking(r.text)));
    flashcards.push(...set.flashcards);
    if (!verify) {
      mcqs.push(...set.mcqs);
      continue;
    }
    opts.onProgress(++step, steps);
    for (const m of set.mcqs) {
      if (opts.signal.aborted) break;
      // Cross-model check: when local and cloud are both available, the other engine judges the item.
      const check = await generate("verify", verifyMcqPrompt(m.question, m.options, chunk), { maxTokens: 4, temperature: 0, avoid: r.via });
      const letter = stripThinking(check.text).toUpperCase().match(/[ABCD]/)?.[0];
      // Unparseable replies keep the item: only a clear disagreement with the key is evidence it is wrong.
      if (letter && OPTION_LETTERS.indexOf(letter as (typeof OPTION_LETTERS)[number]) !== m.answer) rejected++;
      else mcqs.push(m);
    }
  }

  const uniqueMcqs = dedupe(mcqs, (m) => m.question);
  const uniqueCards = dedupe(flashcards, (f) => f.question);
  rejected += mcqs.length - uniqueMcqs.length;
  return { mcqs: uniqueMcqs.map(shuffleOptions), flashcards: uniqueCards, rejected };
}

export interface Answer {
  text: string;
  sources: { n: number; text: string }[];
}

/** Retrieval-augmented Q&A: BM25 picks the passages, the model answers only from them, with citations. */
export async function ask(opts: {
  question: string;
  passages: string[];
  index: Bm25;
  budgetChars: number;
  lang: Lang;
  onToken: (full: string) => void;
  record?: Recorder;
}): Promise<Answer | null> {
  const hits = opts.index.search(opts.question, 8);
  if (!hits.length) return null;
  const sources: Answer["sources"] = [];
  let used = 0;
  for (const h of hits) {
    const text = opts.passages[h.index];
    if (sources.length && used + text.length > opts.budgetChars) break;
    sources.push({ n: sources.length + 1, text });
    used += text.length;
  }
  const r = await generate("ask", answerPrompt(opts.question, sources, opts.lang), {
    maxTokens: getSettings().answerTokens,
    temperature: 0.2,
    record: opts.record,
    onToken: (_, full) => opts.onToken(stripThinking(full)),
  });
  if (r.aborted) throw new Aborted();
  return { text: stripThinking(r.text), sources };
}
