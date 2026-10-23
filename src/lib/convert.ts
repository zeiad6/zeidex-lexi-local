// Document → Markdown converters, modelled on microsoft/markitdown (MIT): keep headings, lists and tables
// as Markdown structure, which models read well and which costs far fewer tokens than raw markup.
// Each converter returns pages of lines so cleanPages() can strip repeated headers/footers per page/slide.
import { unzip, type ZipReader } from "./zip";

export type Pages = string[][];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

const all = (xml: string, re: RegExp) => [...xml.matchAll(re)];
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

export function markdownTable(rows: string[][]): string[] {
  const width = Math.max(...rows.map((r) => r.length));
  if (!rows.length || !width) return [];
  const cell = (s = "") => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ")} |`;
  return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line), ""];
}

// ---- DOCX ----------------------------------------------------------------------------------------

function docxRunText(p: string): string {
  return all(p, /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)
    .map((m) => (m[2] === "tab" ? "\t" : m[2] ? "\n" : decodeXml(m[1])))
    .join("");
}

function docxParagraph(p: string, headingStyles: Map<string, number>): string {
  const text = docxRunText(p).trim();
  if (!text) return "";
  const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
  const outline = p.match(/<w:outlineLvl w:val="(\d)"/)?.[1];
  const level = /^title$/i.test(style) ? 1 : (headingStyles.get(style) ?? (outline !== undefined ? Number(outline) + 1 : 0));
  if (level) return `${"#".repeat(Math.min(level, 6))} ${text}`;
  if (/<w:numPr>/.test(p) || /list/i.test(style)) return `• ${text}`;
  return text;
}

export async function docxToPages(z: ZipReader): Promise<Pages> {
  const xml = (await z.text("word/document.xml")) ?? "";
  // Heading styles are named "heading 1" in styles.xml even when the id is localized (e.g. "1" or "Titre1").
  const headingStyles = new Map<string, number>();
  for (const m of all((await z.text("word/styles.xml")) ?? "", /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name w:val="([^"]+)"/g)) {
    const lvl = m[2].match(/^heading (\d)$/i)?.[1];
    if (lvl) headingStyles.set(m[1], Number(lvl));
  }
  const body = xml.slice(xml.indexOf("<w:body"), xml.lastIndexOf("</w:body>"));
  const lines: string[] = [];
  // shortcut: nested tables are flattened into their outer cell, which is rare in real documents.
  for (const m of all(body, /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^/]*?>[\s\S]*?<\/w:p>/g)) {
    if (m[0].startsWith("<w:tbl>")) {
      const rows = all(m[0], /<w:tr\b[\s\S]*?<\/w:tr>/g).map((tr) =>
        all(tr[0], /<w:tc\b[\s\S]*?<\/w:tc>/g).map((tc) => all(tc[0], /<w:p\b[\s\S]*?<\/w:p>/g).map((p) => docxRunText(p[0])).join(" ")),
      );
      lines.push(...markdownTable(rows));
    } else {
      const line = docxParagraph(m[0], headingStyles);
      if (line) lines.push(line);
    }
  }
  return [lines];
}

// ---- PPTX ----------------------------------------------------------------------------------------

const byNumber = (re: RegExp) => (a: string, b: string) => Number(a.match(re)?.[1]) - Number(b.match(re)?.[1]);

function pptxParagraphs(xml: string): string[] {
  return all(xml, /<a:p>[\s\S]*?<\/a:p>/g)
    .map((p) => all(p[0], /<a:t>([^<]*)<\/a:t>/g).map((t) => decodeXml(t[1])).join("").trim())
    .filter(Boolean);
}

export async function pptxToPages(z: ZipReader): Promise<Pages> {
  const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/;
  const slides = z.names.filter((n) => slideRe.test(n)).sort(byNumber(slideRe));
  const pages: Pages = [];
  for (const name of slides) {
    const n = name.match(slideRe)![1];
    const xml = (await z.text(name)) ?? "";
    const lines = [`## Slide ${n}`];
    for (const sp of all(xml, /<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
      const shape = sp[0];
      if (shape.includes("<a:tbl>")) {
        const rows = all(shape, /<a:tr\b[\s\S]*?<\/a:tr>/g).map((tr) => all(tr[0], /<a:tc\b[\s\S]*?<\/a:tc>/g).map((tc) => pptxParagraphs(tc[0]).join(" ")));
        lines.push(...markdownTable(rows));
        continue;
      }
      const ph = attr(shape.match(/<p:ph\b[^>]*>/)?.[0] ?? "", "type");
      if (ph === "ftr" || ph === "sldNum" || ph === "dt") continue; // footer, slide number, date
      const paras = pptxParagraphs(shape);
      if (!paras.length) continue;
      if (ph === "title" || ph === "ctrTitle") lines.push(`### ${paras.join(" ")}`);
      else lines.push(...paras.map((p) => (paras.length > 1 ? `• ${p}` : p)));
    }
    const notes = await z.text(`ppt/notesSlides/notesSlide${n}.xml`);
    const noteText = notes ? pptxParagraphs(notes).filter((p) => !/^\d+$/.test(p)) : [];
    if (noteText.length) lines.push("", `Notes: ${noteText.join(" ")}`);
    pages.push(lines);
  }
  return pages;
}

// ---- XLSX ----------------------------------------------------------------------------------------

// shortcut: very large sheets are cut at this many rows; summaries of spreadsheets rarely need more.
const MAX_SHEET_ROWS = 2000;

const colIndex = (ref: string) => [...(ref.match(/^[A-Z]+/)?.[0] ?? "A")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function xlsxToPages(z: ZipReader): Promise<Pages> {
  const shared = all((await z.text("xl/sharedStrings.xml")) ?? "", /<si>([\s\S]*?)<\/si>/g).map((si) =>
    all(si[1], /<t(?:\s[^>]*)?>([^<]*)<\/t>/g).map((t) => decodeXml(t[1])).join(""),
  );
  const rels = new Map(
    all((await z.text("xl/_rels/workbook.xml.rels")) ?? "", /<Relationship\b[^>]*>/g).map((r) => [attr(r[0], "Id"), attr(r[0], "Target")] as const),
  );
  const pages: Pages = [];
  for (const s of all((await z.text("xl/workbook.xml")) ?? "", /<sheet\b[^>]*>/g)) {
    const target = rels.get(attr(s[0], "r:id"));
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = (await z.text(path)) ?? "";
    const rows: string[][] = [];
    for (const row of all(xml, /<row\b[\s\S]*?<\/row>/g).slice(0, MAX_SHEET_ROWS)) {
      const cells: string[] = [];
      for (const c of all(row[0], /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = attr(c[1], "t");
        const inner = c[2] ?? "";
        const v = inner.match(/<v>([^<]*)<\/v>/)?.[1];
        const value =
          type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? all(inner, /<t(?:\s[^>]*)?>([^<]*)<\/t>/g).map((t) => decodeXml(t[1])).join("") : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : decodeXml(v ?? "");
        cells[colIndex(attr(c[1], "r") ?? "")] = value;
      }
      if (cells.some((x) => x?.trim())) rows.push(Array.from(cells, (x) => x ?? ""));
    }
    if (rows.length) pages.push([`## ${decodeXml(attr(s[0], "name") ?? "Sheet")}`, ...markdownTable(rows)]);
  }
  return pages;
}

// ---- HTML / EPUB ---------------------------------------------------------------------------------

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "NAV", "IFRAME", "HEAD"]);
const BLOCK = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|BLOCKQUOTE|PRE|FIGURE|FIGCAPTION|DD|DT|ADDRESS)$/;

/** Uses the browser's DOMParser (not available in workers or Node). */
export function htmlToLines(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lines: string[] = [];
  let buf = "";
  const flush = (prefix = "") => {
    const t = buf.replace(/\s+/g, " ").trim();
    if (t) lines.push(prefix + t);
    buf = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buf += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag) || el.getAttribute("hidden") !== null || el.getAttribute("aria-hidden") === "true") return;
    const h = tag.match(/^H([1-6])$/);
    if (h) {
      flush();
      el.childNodes.forEach(walk);
      return flush(`${"#".repeat(Number(h[1]))} `);
    }
    if (tag === "TABLE") {
      flush();
      const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => (c.textContent ?? "").trim()));
      lines.push(...markdownTable(rows.filter((r) => r.length)));
      return;
    }
    if (tag === "LI") {
      flush();
      el.childNodes.forEach(walk);
      return flush("• ");
    }
    if (tag === "BR") return flush();
    if (tag === "IMG") {
      const alt = el.getAttribute("alt")?.trim();
      if (alt) buf += ` [${alt}] `;
      return;
    }
    const block = BLOCK.test(tag);
    if (block) flush();
    el.childNodes.forEach(walk);
    if (block) flush();
  };
  walk(doc.body ?? doc.documentElement);
  flush();
  return lines;
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

function joinPath(base: string, rel: string): string {
  const out: string[] = [];
  for (const part of (dirOf(base) + decodeURIComponent(rel.split("#")[0])).split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

export async function epubToPages(z: ZipReader): Promise<Pages> {
  const container = (await z.text("META-INF/container.xml")) ?? "";
  const opfPath = attr(container.match(/<rootfile\b[^>]*>/)?.[0] ?? "", "full-path");
  if (!opfPath) throw new Error("unsupported");
  const opf = (await z.text(opfPath)) ?? "";
  const manifest = new Map(all(opf, /<item\b[^>]*>/g).map((m) => [attr(m[0], "id"), attr(m[0], "href")] as const));
  const pages: Pages = [];
  for (const ref of all(opf, /<itemref\b[^>]*>/g)) {
    const href = manifest.get(attr(ref[0], "idref"));
    const html = href && (await z.text(joinPath(opfPath, href)));
    if (!html) continue;
    const lines = htmlToLines(html);
    if (lines.length) pages.push(lines);
  }
  return pages;
}

// ---- CSV / JSON / notebooks ----------------------------------------------------------------------

export function parseCsv(text: string, sep = text.split("\n")[0].includes("\t") ? "\t" : ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      (row = []), (cell = "");
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function notebookToLines(json: string): string[] {
  const nb = JSON.parse(json) as { cells?: { cell_type: string; source: string | string[] }[] };
  const lines: string[] = [];
  for (const c of nb.cells ?? []) {
    const src = (Array.isArray(c.source) ? c.source.join("") : c.source).trim();
    if (!src) continue;
    if (c.cell_type === "code") lines.push("```", ...src.split("\n"), "```", "");
    else lines.push(...src.split("\n"), "");
  }
  return lines;
}

// ---- dispatch ------------------------------------------------------------------------------------

export const CONVERTIBLE = ["docx", "pptx", "xlsx", "epub", "html", "htm", "xhtml", "csv", "tsv", "json", "ipynb"] as const;

/** Converts a non-PDF document to pages of Markdown lines, or returns null for an unknown type. */
export async function convertToPages(file: File): Promise<Pages | null> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "docx":
      return docxToPages(unzip(new Uint8Array(await file.arrayBuffer())));
    case "pptx":
      return pptxToPages(unzip(new Uint8Array(await file.arrayBuffer())));
    case "xlsx":
      return xlsxToPages(unzip(new Uint8Array(await file.arrayBuffer())));
    case "epub":
      return epubToPages(unzip(new Uint8Array(await file.arrayBuffer())));
    case "html":
    case "htm":
    case "xhtml":
      return [htmlToLines(await file.text())];
    case "csv":
    case "tsv":
      return [markdownTable(parseCsv(await file.text(), ext === "tsv" ? "\t" : undefined))];
    case "ipynb":
      return [notebookToLines(await file.text())];
    case "json":
      return [JSON.stringify(JSON.parse(await file.text()), null, 2).split("\n")];
  }
  return null;
}
