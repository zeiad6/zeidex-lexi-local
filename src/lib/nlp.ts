// Classic IR/NLP algorithms that run before and after the LLM: they make small local models
// read less noise, cover more of the document and stop looping. Pure functions, no imports.

const AR_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g; // diacritics + tatweel

const STOPWORDS = new Set(
  (
    "the and for are but not you all any can had her was one our out has have from this that with they will would there their what which when where who whom been being into than then them these those such some more most other only also very just over under about after before between through during while each both because could should does doing were your its itself here how why may might must shall upon within without however therefore thus hence using used based figure table et al page pages chapter section mostly often usually many much well like " +
    "في من على الى عن مع هذا هذه ذلك تلك التي الذي الذين اللذان اللتان هو هي هم هن انت انا نحن كان كانت يكون تكون كل بعض غير بين عند حتى اذا اذ ثم او ام لكن بل قد لقد لا لم لن ما ماذا متى اين كيف لماذا هل ايضا كما بعد قبل حيث مثل منذ خلال ضمن دون فوق تحت عبر وهو وهي وقد وفي ومن وعلى والى وعن ان انه انها الا"
  ).split(" "),
);

/** Folds Arabic orthographic variants and case so "الإحصاء" and "الاحصاء" match. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(AR_MARKS, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

const AR_PREFIX = /^(وال|بال|كال|فال|لل|ال)/;

/** Light stemmer: strips Arabic definite-article prefixes and English plural -s; enough for retrieval. */
export function stem(w: string): string {
  if (/[؀-ۿ]/.test(w)) return w.length > 4 ? w.replace(AR_PREFIX, "") : w;
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

export function tokenize(s: string): string[] {
  const words = normalize(s).match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w)).map(stem);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Share of letters that are Arabic; Arabic costs more tokens per character in most tokenizers. */
export function arabicRatio(text: string): number {
  const sample = text.slice(0, 20000);
  const ar = sample.match(/[؀-ۿ]/g)?.length ?? 0;
  const all = sample.match(/\p{L}/gu)?.length ?? 0;
  return all ? ar / all : 0;
}

/** TF-IDF keywords across documents (chunks). Returns readable surface forms, not stems. */
export function keywords(docs: string[], k = 12): string[] {
  const df = new Map<string, number>();
  const tf = new Map<string, number>();
  const surface = new Map<string, Map<string, number>>();
  for (const doc of docs) {
    const seen = new Set<string>();
    for (const raw of doc.match(/[\p{L}\p{N}]+/gu) ?? []) {
      const [term] = tokenize(raw);
      if (!term) continue;
      tf.set(term, (tf.get(term) ?? 0) + 1);
      if (!seen.has(term)) {
        seen.add(term);
        df.set(term, (df.get(term) ?? 0) + 1);
      }
      const forms = surface.get(term) ?? new Map<string, number>();
      const form = raw.replace(AR_MARKS, "");
      forms.set(form, (forms.get(form) ?? 0) + 1);
      surface.set(term, forms);
    }
  }
  const n = docs.length;
  return [...tf.entries()]
    .filter(([term]) => term.length > 3)
    .map(([term, f]) => [term, Math.log(1 + f) * Math.log(1 + n / (df.get(term) ?? 1))] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([term]) => [...surface.get(term)!.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}

/**
 * Extractive compression: keeps the highest-information sentences (TF-IDF weight, length-normalized,
 * with a small lead bias) up to `ratio` of the characters, in original order.
 */
export function compress(text: string, ratio: number): string {
  if (ratio >= 1) return text;
  const sentences = splitSentences(text);
  const tokens = sentences.map(tokenize);
  const df = new Map<string, number>();
  for (const ts of tokens) for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = sentences.length;
  const scored = sentences.map((s, i) => {
    const ts = tokens[i];
    const weight = ts.reduce((sum, t) => sum + Math.log(1 + n / df.get(t)!), 0);
    const lead = 1 + 0.3 * (1 - i / n);
    return { i, s, score: ts.length ? (weight / Math.sqrt(ts.length)) * lead : 0 };
  });
  const budget = text.length * ratio;
  const keep = new Set<number>();
  let used = 0;
  for (const { i, s } of [...scored].sort((a, b) => b.score - a.score)) {
    if (used + s.length > budget && keep.size) continue;
    keep.add(i);
    used += s.length + 1;
  }
  return sentences.filter((_, i) => keep.has(i)).join(" ");
}

/** Okapi BM25 over passages, with the same Arabic-aware tokenizer. */
export class Bm25 {
  private docs: Map<string, number>[];
  private df = new Map<string, number>();
  private avgLen: number;
  private lens: number[];

  constructor(
    passages: string[],
    private k1 = 1.4,
    private b = 0.75,
  ) {
    this.docs = passages.map((p) => {
      const tf = new Map<string, number>();
      for (const t of tokenize(p)) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return tf;
    });
    this.lens = this.docs.map((d) => [...d.values()].reduce((a, b) => a + b, 0));
    this.avgLen = this.lens.reduce((a, b) => a + b, 0) / (this.lens.length || 1);
  }

  search(query: string, k = 4): { index: number; score: number }[] {
    const q = [...new Set(tokenize(query))];
    const n = this.docs.length;
    return this.docs
      .map((tf, index) => {
        let score = 0;
        for (const t of q) {
          const f = tf.get(t);
          if (!f) continue;
          const idf = Math.log(1 + (n - this.df.get(t)! + 0.5) / (this.df.get(t)! + 0.5));
          score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lens[index]) / this.avgLen));
        }
        return { index, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** Drops items whose token set overlaps an earlier item's by at least `threshold` (Jaccard). */
export function dedupe<T>(items: T[], key: (t: T) => string, threshold = 0.6): T[] {
  const kept: { item: T; set: Set<string> }[] = [];
  for (const item of items) {
    const set = new Set(tokenize(key(item)));
    const dup = kept.some((k) => {
      let inter = 0;
      for (const t of set) if (k.set.has(t)) inter++;
      const union = set.size + k.set.size - inter;
      return union > 0 && inter / union >= threshold;
    });
    if (!dup) kept.push({ item, set });
  }
  return kept.map((k) => k.item);
}

/**
 * Detects degenerate looping (small models repeating the same phrase). Returns the index where the
 * text should be cut so one copy remains, or -1. Only the recent tail is inspected.
 */
export function findLoop(text: string, window = 48, repeats = 3, horizon = 1500): number {
  if (text.length < window * 2) return -1;
  const tail = text.slice(-window);
  if (!tail.trim()) return -1;
  const floor = Math.max(0, text.length - horizon);
  const last = text.length - window;
  const prev = text.lastIndexOf(tail, last - 1);
  if (prev < floor) return -1;
  // The gap between the last two copies of the tail is the loop period; peel off whole periods.
  const period = last - prev;
  let end = text.length;
  let copies = 1;
  while (end - 2 * period >= floor && text.slice(end - period, end) === text.slice(end - 2 * period, end - period)) {
    end -= period;
    copies++;
  }
  return copies >= repeats ? end : -1;
}
