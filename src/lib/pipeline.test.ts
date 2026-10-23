import { beforeEach, expect, test, vi } from "vitest";

// The worker can't run under Node; a scripted engine records each task and answers by type.
const calls: string[] = [];
let verifyReply = "A";
vi.mock("./engine", () => ({
  generate: vi.fn(async (task: string) => {
    calls.push(task);
    const text = {
      map: "• note about the section with several facts",
      merge: "• merged note",
      final: "Theme:\n• point one\n• point two",
      refine: "Theme:\n• refined point one\n• refined point two",
      study: JSON.stringify({
        mcqs: [
          { question: "What does the cell produce?", options: ["energy", "rocks", "light", "sound"], answer: 0, explanation: "x" },
          { question: "Which organelle builds proteins?", options: ["ribosome", "wall", "lake", "cloud"], answer: 0, explanation: "y" },
        ],
        flashcards: [{ question: "Cell?", answer: "Unit of life" }],
      }),
      verify: verifyReply,
      ask: "Cells make energy [1].",
    }[task];
    return { text, aborted: false, via: "local", model: "mock" };
  }),
}));

const { ask, estimateCalls, generateStudySet, summarize } = await import("./pipeline");
const { Bm25 } = await import("./nlp");

const signal = new AbortController().signal;
const base = { chunkChars: 4000, format: "bullets" as const, lang: "en" as const, keyTerms: [], signal, onProgress: () => {}, onToken: () => {} };
const chunksOf = (n: number, tag = "") =>
  Array.from({ length: n }, (_, i) => `Chunk ${tag}${i}. ` + `Mitochondria produce energy for cell number ${i}. `.repeat(30));

beforeEach(() => {
  calls.length = 0;
  verifyReply = "A";
});

test("balanced: one map call per chunk, then the final", async () => {
  const out = await summarize({ ...base, chunks: chunksOf(3, "b"), quality: "balanced", model: "m1" });
  expect(out).toContain("point one");
  expect(calls).toEqual(["map", "map", "map", "final"]);
});

test("notes are cached: a second run with another format skips every map call", async () => {
  const chunks = chunksOf(3, "c");
  await summarize({ ...base, chunks, quality: "balanced", model: "m2" });
  calls.length = 0;
  await summarize({ ...base, chunks, format: "executive", quality: "balanced", model: "m2" });
  expect(calls).toEqual(["final"]);
});

test("fast: a long document is compressed to at most 6 map calls", async () => {
  await summarize({ ...base, chunks: chunksOf(20, "f"), quality: "fast", model: "m3" });
  expect(calls.filter((c) => c === "map").length).toBeLessThanOrEqual(6);
});

test("max: refines a draft that misses key terms and returns the refined text", async () => {
  let stats: { refineSkipped: boolean } | undefined;
  const out = await summarize({ ...base, keyTerms: ["Mitochondria"], chunks: chunksOf(1, "x"), quality: "max", model: "m4", onStats: (s) => (stats = s) });
  expect(calls).toEqual(["final", "refine"]);
  expect(out).toContain("refined");
  expect(stats?.refineSkipped).toBe(false);
});

test("max: skips the refine call when the draft already checks out", async () => {
  let stats: { refineSkipped: boolean; savedTokens: number } | undefined;
  const out = await summarize({ ...base, chunks: chunksOf(1, "y"), quality: "max", model: "m4", onStats: (s) => (stats = s) });
  expect(calls).toEqual(["final"]);
  expect(out).toContain("point one");
  expect(stats?.refineSkipped).toBe(true);
  expect(stats?.savedTokens).toBeGreaterThan(0);
});

test("repeated sections are summarized once", async () => {
  let dup = 0;
  const chunk = chunksOf(1, "dup")[0];
  await summarize({ ...base, chunks: [chunk, chunksOf(1, "other")[0], chunk], quality: "balanced", model: "m5", onStats: (s) => (dup = s.duplicateSections) });
  expect(calls.filter((c) => c === "map")).toHaveLength(2);
  expect(dup).toBe(1);
});

test("estimateCalls matches the modes", () => {
  expect(estimateCalls(1, 4000, "balanced")).toBe(1);
  expect(estimateCalls(1, 4000, "max")).toBe(2);
  expect(estimateCalls(20, 4000, "fast")).toBeLessThan(estimateCalls(20, 4000, "balanced"));
});

test("study self-check drops questions the model answers differently from the key", async () => {
  verifyReply = "B"; // key is always option 0 = A before shuffling
  const r = await generateStudySet({ chunks: chunksOf(1), sections: 1, lang: "en", quality: "max", constrained: true, signal, onProgress: () => {} });
  expect(r.mcqs).toHaveLength(0);
  expect(r.rejected).toBe(2);
  expect(r.flashcards).toHaveLength(1);
});

test("study keeps verified questions and shuffles answer positions consistently", async () => {
  const r = await generateStudySet({ chunks: chunksOf(1), sections: 1, lang: "en", quality: "max", constrained: true, signal, onProgress: () => {} });
  expect(r.mcqs).toHaveLength(2);
  for (const m of r.mcqs) expect(["energy", "ribosome"]).toContain(m.options[m.answer]);
});

test("ask translates a cross-language question into search terms before giving up", async () => {
  const passages = ["Mitochondria produce energy for the cell.", "Rivers flow to the sea."];
  const index = new Bm25(passages);
  // The mocked model answers every "ask" call with "Cells make energy [1].", which is also what the
  // translation step returns, so the English passage about energy is retrieved for an Arabic question.
  const a = await ask({ question: "ما الذي ينتج الطاقة في الخلية؟", passages, index, budgetChars: 4000, lang: "ar", onToken: () => {} });
  expect(a?.sources[0].text).toBe(passages[0]);
  expect(calls.filter((c) => c === "ask")).toHaveLength(2);
});

test("ask retrieves passages and returns null when nothing matches", async () => {
  const passages = ["Mitochondria produce energy.", "Rivers flow to the sea."];
  const index = new Bm25(passages);
  const a = await ask({ question: "what produces energy", passages, index, budgetChars: 4000, lang: "en", onToken: () => {} });
  expect(a?.sources[0].text).toBe(passages[0]);
  expect(await ask({ question: "quantum gravity", passages, index, budgetChars: 4000, lang: "en", onToken: () => {} })).toBeNull();
});
