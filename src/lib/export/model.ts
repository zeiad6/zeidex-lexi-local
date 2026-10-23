// One document model for every result (summary, study set, Q&A, history entry). The screen
// (FormattedText) and the Markdown/Word/PDF exports all render these blocks, so they never disagree.
import { dictionaries, type Lang } from "@/i18n";
import type { Flashcard, Mcq } from "../text";

export type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "qa"; role: "q" | "a"; label: string; text: string }
  | { t: "table"; rows: string[][] }
  | { t: "mcq"; n: number; question: string; options: string[]; answer: number; explanation?: string }
  | { t: "card"; q: string; a: string }
  | { t: "sources"; items: { n: number; text: string }[] };

export interface ExportDoc {
  title: string;
  /** Kind label shown above the title, e.g. "Summary". */
  kicker: string;
  lang: Lang;
  meta: { label: string; value: string }[];
  blocks: Block[];
}

const BULLET = /^\s*([•\-*–▪]|\d+[.)])\s+/;
const QA = /^(س|ج|Q|A)\s*[:：]\s*/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());

/**
 * Parses the plain-text conventions the prompts ask for ("• " bullets, "Heading:" lines, Q/A pairs,
 * [n] citations) and tolerates the Markdown small models still emit (#, **, | tables |).
 */
export function parseText(text: string): Block[] {
  const blocks: Block[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  const flush = () => {
    if (list.length) blocks.push({ t: "ul", items: list });
    if (table.length) blocks.push({ t: "table", rows: table });
    list = [];
    table = [];
  };
  for (const raw of text.replace(/\*\*/g, "").split("\n")) {
    const hashes = raw.match(/^\s*(#{1,6})\s+/);
    const line = raw.replace(/^\s*#{1,6}\s*/, "").trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (TABLE_ROW.test(line)) {
      if (list.length) flush();
      if (!TABLE_RULE.test(line)) table.push(cells(line));
      continue;
    }
    if (BULLET.test(line) && !hashes) {
      if (table.length) flush();
      list.push(line.replace(BULLET, ""));
      continue;
    }
    flush();
    const qa = line.match(QA);
    if (qa) blocks.push({ t: "qa", role: qa[1] === "س" || qa[1] === "Q" ? "q" : "a", label: qa[1], text: line.slice(qa[0].length) });
    else if (hashes) blocks.push({ t: "h", level: Math.min(3, Math.max(2, hashes[1].length)) as 2 | 3, text: line.replace(/[:：]$/, "") });
    else if (/[:：]$/.test(line) && line.length <= 80) blocks.push({ t: "h", level: 2, text: line.replace(/[:：]$/, "") });
    else blocks.push({ t: "p", text: line });
  }
  flush();
  return blocks;
}

const dateOf = (lang: Lang, at: number) =>
  new Date(at).toLocaleString(lang === "ar" ? "ar" : "en", { dateStyle: "long", timeStyle: "short" });

interface Common {
  docName: string;
  lang: Lang;
  createdAt?: number;
  quality?: string;
  models?: string[];
}

function meta(c: Common) {
  const t = dictionaries[c.lang];
  const m = [
    { label: t.exDocument, value: c.docName },
    { label: t.exDate, value: dateOf(c.lang, c.createdAt ?? Date.now()) },
  ];
  if (c.quality && c.quality !== "-") m.push({ label: t.exQuality, value: t[`q${c.quality[0].toUpperCase()}${c.quality.slice(1)}` as "qFast"] ?? c.quality });
  if (c.models?.length) m.push({ label: t.exModels, value: c.models.join(c.lang === "ar" ? "، " : ", ") });
  return m;
}

const firstLine = (s: string) => (s.split("\n").find((l) => l.trim().length > 3) ?? s).replace(/^[#\s]+|[:：]$/g, "").trim().slice(0, 120);

export function summaryDoc(text: string, c: Common): ExportDoc {
  const t = dictionaries[c.lang];
  return { title: c.docName.replace(/\.[^.]+$/, ""), kicker: t.exSummary, lang: c.lang, meta: meta(c), blocks: parseText(text) };
}

export function studyDoc(set: { mcqs: Mcq[]; flashcards: Flashcard[] }, c: Common): ExportDoc {
  const t = dictionaries[c.lang];
  const blocks: Block[] = [];
  if (set.mcqs.length) {
    blocks.push({ t: "h", level: 2, text: t.mcq });
    set.mcqs.forEach((m, i) => blocks.push({ t: "mcq", n: i + 1, ...m }));
  }
  if (set.flashcards.length) {
    blocks.push({ t: "h", level: 2, text: t.flashcards });
    set.flashcards.forEach((f) => blocks.push({ t: "card", q: f.question, a: f.answer }));
  }
  return { title: c.docName.replace(/\.[^.]+$/, ""), kicker: t.exStudy, lang: c.lang, meta: meta(c), blocks };
}

export function answerDoc(turns: { question: string; text: string; sources: { n: number; text: string }[] }[], c: Common): ExportDoc {
  const t = dictionaries[c.lang];
  const blocks: Block[] = [];
  for (const turn of turns) {
    blocks.push({ t: "h", level: 2, text: turn.question });
    blocks.push(...parseText(turn.text));
    if (turn.sources.length) blocks.push({ t: "h", level: 3, text: t.sources }, { t: "sources", items: turn.sources });
  }
  return {
    title: turns.length === 1 ? firstLine(turns[0].question) : c.docName.replace(/\.[^.]+$/, ""),
    kicker: t.exAsk,
    lang: c.lang,
    meta: meta(c),
    blocks,
  };
}

/** Re-builds the export for a saved history entry from its structured data. */
export function historyDoc(e: {
  kind: "summary" | "study" | "ask";
  docName: string;
  title: string;
  lang: string;
  quality: string;
  models: string[];
  output: string;
  createdAt: number;
  data?: unknown;
}): ExportDoc {
  const c: Common = { docName: e.docName, lang: e.lang === "en" ? "en" : "ar", createdAt: e.createdAt, quality: e.quality, models: e.models };
  if (e.kind === "study" && e.data && typeof e.data === "object" && "mcqs" in e.data) return studyDoc(e.data as { mcqs: Mcq[]; flashcards: Flashcard[] }, c);
  if (e.kind === "ask") return answerDoc([{ question: e.title, text: e.output, sources: Array.isArray(e.data) ? (e.data as { n: number; text: string }[]) : [] }], c);
  return summaryDoc(e.output, c);
}

/** Safe file name stem from a document name. */
export const fileStem = (docName: string, suffix: string) =>
  `${docName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "lexi"}-${suffix}`;
