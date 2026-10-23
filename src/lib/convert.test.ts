import { expect, test } from "vitest";
import { docxToPages, markdownTable, notebookToLines, parseCsv, pptxToPages, xlsxToPages } from "./convert";
import { crc32, unzip, zip } from "./zip";
import { cleanPages } from "./clean";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

test("crc32 matches the reference value", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
});

test("zip round-trips stored entries with UTF-8 names", async () => {
  const z = unzip(zip([{ name: "a.txt", data: "hello" }, { name: "مجلد/ب.xml", data: "<x>مرحبا</x>" }]));
  expect(z.names).toEqual(["a.txt", "مجلد/ب.xml"]);
  expect(await z.text("مجلد/ب.xml")).toBe("<x>مرحبا</x>");
  expect(await z.read("missing")).toBeNull();
});

test("unzip inflates deflated entries", async () => {
  // A deflated entry built with the platform's own CompressionStream, as Office writes them.
  const raw = new TextEncoder().encode("deflated ".repeat(200));
  const deflated = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const stored = zip([{ name: "d.txt", data: deflated }]);
  // Patch method (offset 8 local, 10 central) to 8 = deflate and the uncompressed size fields.
  const v = new DataView(stored.buffer);
  v.setUint16(8, 8, true);
  const cen = 30 + 5 + deflated.length;
  v.setUint16(cen + 10, 8, true);
  expect(await unzip(stored).text("d.txt")).toBe("deflated ".repeat(200));
});

test("docx: headings by style name, bullets, tables and escaped text", async () => {
  const styles = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/></w:style></w:styles>`;
  const doc = `<w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Water &amp; Climate</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>Results</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Aquifers fall </w:t></w:r><w:r><w:t>1.5 m</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Desalination</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Year</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Level</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>2020</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>-30</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:sectPr/></w:body></w:document>`;
  const pages = await docxToPages(unzip(zip([{ name: "word/document.xml", data: doc }, { name: "word/styles.xml", data: styles }])));
  expect(pages[0]).toEqual(["# Water & Climate", "# Results", "Aquifers fall 1.5 m", "• Desalination", "| Year | Level |", "| --- | --- |", "| 2020 | -30 |", ""]);
});

test("pptx: slides in numeric order, titles, bullets, notes; footers dropped", async () => {
  const slide = (title: string, body: string[]) =>
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody>${body
      .map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`)
      .join("")}</p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>7</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const z = unzip(
    zip([
      { name: "ppt/slides/slide10.xml", data: slide("Ten", ["only line"]) },
      { name: "ppt/slides/slide2.xml", data: slide("Two", ["a", "b"]) },
      { name: "ppt/notesSlides/notesSlide2.xml", data: "<p:notes><a:p><a:r><a:t>Speaker note</a:t></a:r></a:p><a:p><a:r><a:t>2</a:t></a:r></a:p></p:notes>" },
    ]),
  );
  const pages = await pptxToPages(z);
  expect(pages).toEqual([
    ["## Slide 2", "### Two", "• a", "• b", "", "Notes: Speaker note"],
    ["## Slide 10", "### Ten", "only line"],
  ]);
});

test("xlsx: shared strings, inline strings, booleans and sparse columns", async () => {
  const z = unzip(
    zip([
      { name: "xl/workbook.xml", data: '<workbook><sheets><sheet name="Data &amp; more" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: "xl/sharedStrings.xml", data: "<sst><si><t>Name</t></si><si><r><t>Sco</t></r><r><t>re</t></r></si></sst>" },
      {
        name: "xl/worksheets/sheet1.xml",
        data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ali</t></is></c><c r="B2" t="b"><v>1</v></c><c r="C2"><v>9.5</v></c></row><row r="3"/></sheetData></worksheet>',
      },
    ]),
  );
  expect(await xlsxToPages(z)).toEqual([["## Data & more", "| Name |  | Score |", "| --- | --- | --- |", "| Ali | TRUE | 9.5 |", ""]]);
});

test("csv: quotes, escaped quotes, embedded commas/newlines, CRLF", () => {
  expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"line\nbreak",3\r\n')).toEqual([
    ["a", "b, c", 'say "hi"'],
    ["1", "line\nbreak", "3"],
  ]);
  expect(markdownTable([["x", "a|b"]])).toEqual(["| x | a\\|b |", "| --- | --- |", ""]);
});

test("notebooks keep markdown and fence code cells", () => {
  const nb = JSON.stringify({ cells: [{ cell_type: "markdown", source: ["# Title\n", "text"] }, { cell_type: "code", source: "print(1)" }] });
  expect(notebookToLines(nb)).toEqual(["# Title", "text", "", "```", "print(1)", "```", ""]);
});

test("structured pages keep their lines instead of re-flowing them into paragraphs", () => {
  const slides = Array.from({ length: 4 }, (_, i) => [`## Slide ${i + 1}`, `• point ${i}`]);
  const r = cleanPages(slides, { removeHeaders: true, cutReferences: true, structured: true });
  expect(r.text.split("\n\n")[0]).toBe("## Slide 1\n• point 0");
  expect(r.removedLines).toBe(0);
});
