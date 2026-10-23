// A real .docx (WordprocessingML) written by hand: styles, bullets, tables, RTL paragraphs and a page-number
// footer. Element order inside pPr/rPr/tblPr follows the ECMA-376 schema, which Word enforces.
import { dictionaries } from "@/i18n";
import { zip } from "../zip";
import { optionLetter } from "./markdown";
import type { Block, ExportDoc } from "./model";

const ACCENT = "A8711C";
const INK = "1E2535";
const SOFT = "5B6476";
const LINE = "E6E0D4";
const OK = "17733F";
const TEXT_WIDTH = 9638; // A4 width minus 2 cm margins, in twips

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// eslint-disable-next-line no-control-regex
const x = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface RunOpts {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number; // half-points
  sup?: boolean;
}

function run(text: string, o: RunOpts, rtl: boolean): string {
  const props =
    (o.bold ? "<w:b/><w:bCs/>" : "") +
    (o.italic ? "<w:i/><w:iCs/>" : "") +
    (o.color ? `<w:color w:val="${o.color}"/>` : "") +
    (o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : "") +
    (o.sup ? '<w:vertAlign w:val="superscript"/>' : "") +
    (rtl ? "<w:rtl/>" : "");
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : "";
  return text
    .split("\n")
    .map((line, i) => `${i ? "<w:r><w:br/></w:r>" : ""}<w:r>${rPr}<w:t xml:space="preserve">${x(line)}</w:t></w:r>`)
    .join("");
}

/** Text runs with [n] citations as small accent superscripts. */
function runs(text: string, o: RunOpts, rtl: boolean): string {
  return text
    .split(/(\[\d+\])/g)
    .filter(Boolean)
    .map((part) => (/^\[\d+\]$/.test(part) ? run(part, { ...o, sup: true, bold: true, color: ACCENT }, rtl) : run(part, o, rtl)))
    .join("");
}

interface ParaOpts {
  style?: string;
  bullet?: boolean;
  shade?: string;
  jc?: "center";
}

function para(content: string, o: ParaOpts, rtl: boolean): string {
  const pPr =
    (o.style ? `<w:pStyle w:val="${o.style}"/>` : "") +
    (o.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : "") +
    (o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : "") +
    (rtl ? "<w:bidi/>" : "") +
    (o.jc ? `<w:jc w:val="${o.jc}"/>` : "");
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
}

function table(rows: string[][], rtl: boolean): string {
  const width = Math.max(...rows.map((r) => r.length));
  const col = Math.floor(TEXT_WIDTH / width);
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/>`;
  const tblPr =
    (rtl ? "<w:bidiVisual/>" : "") +
    '<w:tblW w:w="5000" w:type="pct"/>' +
    `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
    '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>';
  const tr = (r: string[], head: boolean) =>
    `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${Array.from({ length: width }, (_, i) => {
      const shd = head ? `<w:shd w:val="clear" w:color="auto" w:fill="FBF4E6"/>` : "";
      return `<w:tc><w:tcPr><w:tcW w:w="${col}" w:type="dxa"/>${shd}</w:tcPr>${para(runs(r[i] ?? "", { bold: head, size: 19 }, rtl), { style: "TableText" }, rtl)}</w:tc>`;
    }).join("")}</w:tr>`;
  return `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid>${`<w:gridCol w:w="${col}"/>`.repeat(width)}</w:tblGrid>${rows.map((r, i) => tr(r, i === 0)).join("")}</w:tbl>${para("", {}, rtl)}`;
}

function block(b: Block, lang: string, rtl: boolean): string {
  const t = dictionaries[lang === "en" ? "en" : "ar"];
  switch (b.t) {
    case "h":
      return para(runs(b.text, {}, rtl), { style: b.level === 3 ? "Heading2" : "Heading1" }, rtl);
    case "p":
      return para(runs(b.text, {}, rtl), {}, rtl);
    case "ul":
      return b.items.map((i) => para(runs(i, {}, rtl), { style: "ListParagraph", bullet: true }, rtl)).join("");
    case "qa":
      return para(run(`${b.label}: `, { bold: true, color: ACCENT }, rtl) + runs(b.text, { bold: b.role === "q" }, rtl), { style: b.role === "q" ? "QaQuestion" : undefined }, rtl);
    case "table":
      return table(b.rows, rtl);
    case "mcq":
      return (
        para(run(`${b.n}. `, { bold: true, color: ACCENT }, rtl) + runs(b.question, { bold: true }, rtl), { style: "McqQuestion" }, rtl) +
        b.options
          .map((o, i) =>
            i === b.answer
              ? para(run(`${optionLetter(lang, i)})  `, { bold: true, color: OK }, rtl) + runs(o, { bold: true, color: OK }, rtl) + run("  ✓", { bold: true, color: OK }, rtl), { style: "Option", shade: "E9F6EE" }, rtl)
              : para(run(`${optionLetter(lang, i)})  `, { bold: true, color: SOFT }, rtl) + runs(o, {}, rtl), { style: "Option" }, rtl),
          )
          .join("") +
        (b.explanation ? para(run(`${t.exExplanation}: `, { bold: true }, rtl) + runs(b.explanation, {}, rtl), { style: "Note" }, rtl) : "")
      );
    case "card":
      return (
        para(run(`${t.exQuestion}: `, { bold: true, color: ACCENT }, rtl) + runs(b.q, { bold: true }, rtl), { style: "CardQ" }, rtl) +
        para(run(`${t.exAnswer}: `, { bold: true, color: ACCENT }, rtl) + runs(b.a, {}, rtl), { style: "CardA" }, rtl)
      );
    case "sources":
      return b.items.map((s) => para(run(`[${s.n}]  `, { bold: true, color: ACCENT }, rtl) + run(s.text.replace(/\s+/g, " ").slice(0, 900), {}, rtl), { style: "Source" }, rtl)).join("");
  }
}

const pStyle = (id: string, name: string, pPr: string, rPr: string, extra = "") =>
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
const builtin = (id: string, name: string, pPr: string, rPr: string) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
const box = (fill: string, color: string) =>
  `<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="${color}"/><w:left w:val="single" w:sz="4" w:space="4" w:color="${color}"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="${color}"/><w:right w:val="single" w:sz="4" w:space="4" w:color="${color}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;

function styles(lang: string): string {
  const serif = '<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Times New Roman"/>';
  return `${XML_HEAD}<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:color w:val="${INK}"/><w:sz w:val="22"/><w:szCs w:val="24"/><w:lang w:val="${lang === "ar" ? "ar-SA" : "en-US"}" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${builtin("Title", "Title", '<w:spacing w:before="120" w:after="160"/>', `${serif}<w:b/><w:bCs/><w:sz w:val="48"/><w:szCs w:val="52"/>`)}
${builtin("Heading1", "heading 1", `<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="${LINE}"/></w:pBdr><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>`, `${serif}<w:b/><w:bCs/><w:color w:val="${ACCENT}"/><w:sz w:val="32"/><w:szCs w:val="34"/>`)}
${builtin("Heading2", "heading 2", '<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/>', `<w:b/><w:bCs/><w:sz w:val="25"/><w:szCs w:val="27"/>`)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>
${pStyle("Brand", "Lexi Brand", '<w:spacing w:after="0"/>', `<w:b/><w:bCs/><w:caps/><w:color w:val="${ACCENT}"/><w:spacing w:val="20"/><w:sz w:val="16"/><w:szCs w:val="18"/>`)}
${pStyle("Kicker", "Lexi Kicker", '<w:spacing w:before="240" w:after="0"/>', `<w:b/><w:bCs/><w:color w:val="${ACCENT}"/><w:sz w:val="20"/><w:szCs w:val="22"/>`)}
${pStyle("Meta", "Lexi Meta", '<w:spacing w:after="20"/>', `<w:color w:val="${SOFT}"/><w:sz w:val="19"/><w:szCs w:val="21"/>`)}
${pStyle("Rule", "Lexi Rule", `<w:pBdr><w:bottom w:val="single" w:sz="18" w:space="1" w:color="${ACCENT}"/></w:pBdr><w:spacing w:after="240"/>`, '<w:sz w:val="8"/>')}
${pStyle("QaQuestion", "Lexi Question", '<w:keepNext/><w:spacing w:before="200" w:after="40"/>', "")}
${pStyle("McqQuestion", "Lexi MCQ Question", '<w:keepNext/><w:spacing w:before="240" w:after="80"/>', "")}
${pStyle("Option", "Lexi Option", '<w:keepNext/><w:spacing w:after="40"/><w:ind w:left="360"/>', "")}
${pStyle("Note", "Lexi Note", '<w:spacing w:before="60" w:after="160"/><w:ind w:left="360"/>', `<w:i/><w:iCs/><w:color w:val="${SOFT}"/><w:sz w:val="20"/><w:szCs w:val="22"/>`)}
${pStyle("CardQ", "Lexi Card Question", `<w:keepNext/>${box("FDFBF7", LINE)}<w:spacing w:before="200" w:after="0"/>`, "")}
${pStyle("CardA", "Lexi Card Answer", `${box("FDFBF7", LINE)}<w:spacing w:after="120"/>`, "")}
${pStyle("Source", "Lexi Source", `<w:shd w:val="clear" w:color="auto" w:fill="F7F5F0"/><w:spacing w:after="80"/>`, `<w:color w:val="${SOFT}"/><w:sz w:val="18"/><w:szCs w:val="20"/>`)}
${pStyle("TableText", "Lexi Table Text", '<w:spacing w:after="0"/>', "")}
${pStyle("Footer", "footer", '<w:spacing w:after="0"/><w:jc w:val="center"/>', `<w:color w:val="8A8F9C"/><w:sz w:val="16"/><w:szCs w:val="18"/>`)}
</w:styles>`;
}

const NUMBERING = `${XML_HEAD}<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:color w:val="${ACCENT}"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const SETTINGS = `${XML_HEAD}<w:settings ${NS}><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const footer = (label: string, rtl: boolean) =>
  `${XML_HEAD}<w:ftr ${NS}>${para(
    run(`${label}  ·  `, {}, rtl) +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>',
    { style: "Footer", jc: "center" },
    rtl,
  )}</w:ftr>`;

const CONTENT_TYPES = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOC_RELS = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;

export function toDocx(doc: ExportDoc, now = new Date()): Uint8Array {
  const t = dictionaries[doc.lang];
  const rtl = doc.lang === "ar";
  const body = [
    para(run(t.appName, {}, rtl), { style: "Brand" }, rtl),
    para(run(doc.kicker, {}, rtl), { style: "Kicker" }, rtl),
    para(run(doc.title, {}, rtl), { style: "Title" }, rtl),
    ...doc.meta.map((m) => para(run(`${m.label}: `, { bold: true, color: INK }, rtl) + run(m.value, {}, rtl), { style: "Meta" }, rtl)),
    para("", { style: "Rule" }, rtl),
    ...doc.blocks.map((b) => block(b, doc.lang, rtl)),
  ].join("");
  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>${rtl ? "<w:bidi/>" : ""}</w:sectPr>`;
  const document = `${XML_HEAD}<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const core = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(doc.title)}</dc:title><dc:subject>${x(doc.kicker)}</dc:subject><dc:creator>${x(t.appName)}</dc:creator><dc:language>${doc.lang}</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`;
  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "docProps/core.xml", data: core },
    { name: "word/document.xml", data: document },
    { name: "word/_rels/document.xml.rels", data: DOC_RELS },
    { name: "word/styles.xml", data: styles(doc.lang) },
    { name: "word/numbering.xml", data: NUMBERING },
    { name: "word/settings.xml", data: SETTINGS },
    { name: "word/footer1.xml", data: footer(`${t.appName} · zeidexsoft.com`, rtl) },
  ]);
}
