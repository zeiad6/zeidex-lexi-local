// A standalone, print-ready HTML rendering. The PDF export prints it, so the browser's own text shaping
// handles Arabic (jsPDF-style PDF writers cannot join Arabic letters).
import { dictionaries } from "@/i18n";
import { optionLetter } from "./markdown";
import type { Block, ExportDoc } from "./model";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const inline = (s: string) => esc(s).replace(/\[(\d+)\]/g, '<sup class="cite">$1</sup>');

function block(b: Block, lang: string): string {
  const t = dictionaries[lang === "en" ? "en" : "ar"];
  switch (b.t) {
    case "h":
      return `<h${b.level}>${inline(b.text)}</h${b.level}>`;
    case "p":
      return `<p>${inline(b.text)}</p>`;
    case "ul":
      return `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
    case "qa":
      return `<p class="qa ${b.role}"><span class="qa-label">${esc(b.label)}</span>${inline(b.text)}</p>`;
    case "table":
      return `<table><thead><tr>${b.rows[0].map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .slice(1)
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    case "mcq":
      return `<section class="mcq"><p class="mcq-q"><span class="num">${b.n}</span>${inline(b.question)}</p><ol class="options">${b.options
        .map(
          (o, i) =>
            `<li class="${i === b.answer ? "correct" : ""}"><span class="letter">${optionLetter(lang, i)}</span>${inline(o)}${i === b.answer ? '<span class="tick">✓</span>' : ""}</li>`,
        )
        .join("")}</ol>${b.explanation ? `<p class="explain"><strong>${esc(t.exExplanation)}:</strong> ${inline(b.explanation)}</p>` : ""}</section>`;
    case "card":
      return `<section class="card"><p class="card-q"><strong>${esc(t.exQuestion)}</strong>${inline(b.q)}</p><p class="card-a"><strong>${esc(t.exAnswer)}</strong>${inline(b.a)}</p></section>`;
    case "sources":
      return `<ol class="sources">${b.items.map((s) => `<li><span class="num">${s.n}</span>${esc(s.text.replace(/\s+/g, " ").slice(0, 900))}</li>`).join("")}</ol>`;
  }
}

/** `fontFaces`: @font-face rules (with inlined data URLs) so the printout uses the app's fonts offline. */
export function toHtml(doc: ExportDoc, fontFaces = ""): string {
  const t = dictionaries[doc.lang];
  const rtl = doc.lang === "ar";
  return `<!doctype html>
<html lang="${doc.lang}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} — ${esc(doc.kicker)}</title>
<style>
${fontFaces}
:root { --ink:#1e2535; --soft:#5b6476; --line:#e6e0d4; --accent:#a8711c; --accent-soft:#fbf4e6; --ok:#17733f; --ok-soft:#e9f6ee; }
* { box-sizing: border-box; }
@page { size: A4; margin: 18mm 16mm 20mm; @bottom-center { content: counter(page) " / " counter(pages); font: 9pt "IBM Plex Sans Arabic", sans-serif; color: #8a8f9c; } }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0 auto; max-width: 820px; padding: 28px 24px 48px; color: var(--ink); background: #fff;
  font: 11pt/1.75 "IBM Plex Sans Arabic", "Segoe UI", Tahoma, "Noto Sans Arabic", Arial, sans-serif; overflow-wrap: anywhere; }
header.cover { border-bottom: 3px solid var(--accent); padding-bottom: 14px; margin-bottom: 22px; }
.brand { display: flex; justify-content: space-between; align-items: center; font-size: 8.5pt; letter-spacing: .08em; text-transform: uppercase; color: var(--soft); }
.brand b { color: var(--accent); letter-spacing: .12em; }
/* Letter-spacing breaks the joining of Arabic letters. */
[dir=rtl] .brand, [dir=rtl] .brand b, [dir=rtl] .card strong { letter-spacing: 0; }
.kicker { margin: 18px 0 2px; color: var(--accent); font-weight: 600; font-size: 10pt; }
h1 { margin: 0 0 12px; font: 700 22pt/1.3 "Amiri", "Traditional Arabic", Georgia, serif; }
dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; margin: 0; font-size: 9.5pt; color: var(--soft); }
dl.meta dt { font-weight: 600; color: var(--ink); }
dl.meta dd { margin: 0; }
h2 { margin: 26px 0 10px; padding-inline-start: 10px; border-inline-start: 4px solid var(--accent); font: 700 15pt/1.4 "Amiri", Georgia, serif; break-after: avoid; }
h3 { margin: 18px 0 6px; font-size: 12pt; font-weight: 600; break-after: avoid; }
p { margin: 6px 0; }
ul { margin: 6px 0 10px; padding-inline-start: 22px; }
li { margin: 3px 0; }
li::marker { color: var(--accent); }
sup.cite { display: inline-block; min-width: 1.4em; margin: 0 2px; padding: 0 4px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); font-size: 7.5pt; font-weight: 700; text-align: center; line-height: 1.6; vertical-align: super; }
.qa.q { margin-top: 14px; font-weight: 600; }
.qa.a { color: #394155; }
.qa-label { display: inline-block; min-width: 1.6em; margin-inline-end: 6px; color: var(--accent); font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 9.5pt; break-inside: auto; }
th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: start; vertical-align: top; }
th { background: var(--accent-soft); font-weight: 600; }
tr { break-inside: avoid; }
.mcq, .card { break-inside: avoid; margin: 12px 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; }
.mcq-q { margin: 0 0 8px; font-weight: 600; }
.num { display: inline-flex; align-items: center; justify-content: center; min-width: 1.7em; height: 1.7em; margin-inline-end: 8px; border-radius: 50%; background: var(--ink); color: #fff; font-size: 8.5pt; font-weight: 700; }
ol.options { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
ol.options li { display: flex; align-items: baseline; gap: 8px; padding: 4px 8px; border-radius: 6px; }
ol.options li.correct { background: var(--ok-soft); color: var(--ok); font-weight: 600; }
.letter { font-weight: 700; color: var(--soft); min-width: 1.2em; }
.correct .letter { color: var(--ok); }
.tick { margin-inline-start: auto; }
.explain { margin: 8px 0 0; font-size: 9.5pt; color: var(--soft); }
.card { display: grid; gap: 6px; background: #fdfbf7; }
.card p { margin: 0; }
.card strong { display: block; font-size: 8.5pt; color: var(--accent); text-transform: uppercase; letter-spacing: .04em; }
ol.sources { list-style: none; margin: 6px 0 14px; padding: 0; font-size: 9pt; color: var(--soft); }
ol.sources li { display: flex; gap: 6px; margin: 6px 0; padding: 8px 10px; border-radius: 8px; background: #f7f5f0; }
ol.sources .num { background: var(--accent); flex: none; }
footer { margin-top: 36px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 8.5pt; color: var(--soft); text-align: center; }
@media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
<header class="cover">
  <div class="brand"><b>${esc(t.appName)}</b><span>ZeidexSoft</span></div>
  <p class="kicker">${esc(doc.kicker)}</p>
  <h1>${esc(doc.title)}</h1>
  <dl class="meta">${doc.meta.map((m) => `<dt>${esc(m.label)}</dt><dd>${esc(m.value)}</dd>`).join("")}</dl>
</header>
<main>
${doc.blocks.map((b) => block(b, doc.lang)).join("\n")}
</main>
<footer>${esc(t.exFooter)}</footer>
</body>
</html>`;
}
