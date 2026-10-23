import { dictionaries } from "@/i18n";
import type { Block, ExportDoc } from "./model";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const AR_LETTERS = ["أ", "ب", "ج", "د", "هـ", "و"];

export const optionLetter = (lang: string, i: number) => (lang === "ar" ? AR_LETTERS : LETTERS)[i] ?? String(i + 1);

const esc = (s: string) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");
// Citations stay readable as [1] in Markdown viewers instead of turning into link syntax.
const inline = (s: string) => esc(s).replace(/\\\[(\d+)\\\]/g, "[$1]");

function table(rows: string[][]): string[] {
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => inline(r[i] ?? "")).join(" | ")} |`;
  return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)];
}

function block(b: Block, lang: string): string[] {
  const t = dictionaries[lang === "en" ? "en" : "ar"];
  switch (b.t) {
    case "h":
      return [`${"#".repeat(b.level)} ${inline(b.text)}`];
    case "p":
      return [inline(b.text)];
    case "ul":
      return b.items.map((i) => `- ${inline(i)}`);
    case "qa":
      return [b.role === "q" ? `**${b.label}: ${inline(b.text)}**` : `${b.label}: ${inline(b.text)}`];
    case "table":
      return table(b.rows);
    case "mcq":
      return [
        `**${b.n}. ${inline(b.question)}**`,
        "",
        ...b.options.map((o, i) => (i === b.answer ? `- **${optionLetter(lang, i)}) ${inline(o)}** ✓` : `- ${optionLetter(lang, i)}) ${inline(o)}`)),
        ...(b.explanation ? ["", `> ${t.exExplanation}: ${inline(b.explanation)}`] : []),
      ];
    case "card":
      return [`**${t.exQuestion}:** ${inline(b.q)}  `, `**${t.exAnswer}:** ${inline(b.a)}`];
    case "sources":
      return b.items.map((s) => `> **[${s.n}]** ${inline(s.text.replace(/\s+/g, " ").slice(0, 600))}`).flatMap((l) => [l, ">"]).slice(0, -1);
  }
}

export function toMarkdown(doc: ExportDoc): string {
  const t = dictionaries[doc.lang];
  const out = [`# ${inline(doc.title)}`, "", `*${doc.kicker}*`, "", ...doc.meta.map((m) => `- **${m.label}:** ${inline(m.value)}`), "", "---", ""];
  for (const b of doc.blocks) out.push(...block(b, doc.lang), "");
  out.push("---", "", `*${t.exFooter}*`, "");
  return out.join("\n");
}
