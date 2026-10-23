import { expect, test } from "vitest";
import { answerDoc, historyDoc, parseText, studyDoc, summaryDoc } from "./export/model";
import { toMarkdown } from "./export/markdown";
import { toHtml } from "./export/html";
import { toDocx } from "./export/docx";
import { unzip } from "./zip";
import { classifyLoadError } from "./install";
import { ENGINE_GONE, parseWebLlmProgress } from "@/workers/protocol";

const summary = `Water stress:
• Groundwater supplies **more than 80%** of water [1].
• Aquifers drop 1.5 m per year.
## Solutions
| Measure | Effect |
| --- | --- |
| Reuse | High |
Q: Is it renewable?
A: Not at current rates.`;

test("parseText finds headings, bullets, tables and Q/A", () => {
  expect(parseText(summary)).toEqual([
    { t: "h", level: 2, text: "Water stress" },
    { t: "ul", items: ["Groundwater supplies more than 80% of water [1].", "Aquifers drop 1.5 m per year."] },
    { t: "h", level: 2, text: "Solutions" },
    { t: "table", rows: [["Measure", "Effect"], ["Reuse", "High"]] },
    { t: "qa", role: "q", label: "Q", text: "Is it renewable?" },
    { t: "qa", role: "a", label: "A", text: "Not at current rates." },
  ]);
});

const study = {
  mcqs: [{ question: "How much is groundwater?", options: ["> 80%", "40%", "20%", "60%"], answer: 0, explanation: "Stated in section 1." }],
  flashcards: [{ question: "Recharge source?", answer: "Winter rain" }],
};

test("markdown export escapes markup and marks the correct option", () => {
  const md = toMarkdown(studyDoc(study, { docName: "paper.pdf", lang: "en", createdAt: 0, quality: "max" }));
  expect(md).toContain("# paper");
  expect(md).toContain("- **A) \\> 80%** ✓");
  expect(md).toContain("- B) 40%");
  expect(md).toContain("> Why: Stated in section 1.");
  expect(md).toContain("**Question:** Recharge source?");
  expect(md).toContain("- **Quality:** Max");
});

test("html export is RTL for Arabic and escapes model text", () => {
  const html = toHtml(summaryDoc('• <script>alert("x")</script> [2]', { docName: "بحث.pdf", lang: "ar", createdAt: 0 }));
  expect(html).toContain('<html lang="ar" dir="rtl">');
  expect(html).not.toContain("<script>");
  expect(html).toContain("&#60;script&#62;");
  expect(html).toContain('<sup class="cite">2</sup>');
});

test("docx export is a valid package with RTL paragraphs and well-formed XML", async () => {
  const doc = answerDoc([{ question: "ما الحل؟", text: "التحلية [1] & إعادة الاستخدام", sources: [{ n: 1, text: "مصدر <1>" }] }], { docName: "x.pdf", lang: "ar", createdAt: 0 });
  const z = unzip(toDocx(doc, new Date(0)));
  for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/footer1.xml", "docProps/core.xml"])
    expect(z.names).toContain(part);
  const xml = (await z.text("word/document.xml"))!;
  expect(xml).toContain("<w:bidi/>");
  expect(xml).toContain("&amp; إعادة");
  expect(xml).toContain("مصدر &lt;1&gt;");
  expect(xml).toContain('<w:vertAlign w:val="superscript"/><w:rtl/>');
  // Every opened tag closes: a cheap well-formedness check without an XML parser.
  const open = [...xml.matchAll(/<(w:[a-zA-Z]+)[\s>]/g)].filter((m) => !xml.slice(m.index!).match(/^<[^>]*\/>/)).length;
  const close = [...xml.matchAll(/<\/w:[a-zA-Z]+>/g)].length;
  expect(open).toBe(close);
});

test("historyDoc rebuilds each kind from saved data", () => {
  const base = { docName: "d.pdf", title: "Q?", lang: "en", quality: "balanced", models: ["m"], createdAt: 0 };
  expect(historyDoc({ ...base, kind: "study", output: "", data: study }).blocks.some((b) => b.t === "mcq")).toBe(true);
  const ask = historyDoc({ ...base, kind: "ask", output: "Answer [1]", data: [{ n: 1, text: "src" }] });
  expect(ask.blocks.at(-1)).toEqual({ t: "sources", items: [{ n: 1, text: "src" }] });
  expect(historyDoc({ ...base, kind: "summary", output: "Point:\n• one" }).kicker).toBe("Summary");
});

test("load errors are classified for the right recovery action", () => {
  expect(classifyLoadError("TypeError: Failed to fetch")).toBe("network");
  expect(classifyLoadError("Cannot fetch https://huggingface.co/x err= NetworkError")).toBe("network");
  expect(classifyLoadError("HTTP 429 Too Many Requests")).toBe("network");
  expect(classifyLoadError("QuotaExceededError: The quota has been exceeded.")).toBe("quota");
  expect(classifyLoadError("Device was lost")).toBe("gpu-memory");
  expect(classifyLoadError("requested limits maxStorageBufferBindingSize exceeds the adapter")).toBe("gpu-limits");
  expect(classifyLoadError("weird")).toBe("other");
});

test("WebLLM progress text becomes bytes and phase", () => {
  const p = parseWebLlmProgress(0.25, "Fetching param cache[10/38]: 400MB fetched. 25% completed, 30 secs elapsed.");
  expect(p).toMatchObject({ phase: "fetch", loadedBytes: 400 * 2 ** 20, totalBytes: 1600 * 2 ** 20 });
  expect(parseWebLlmProgress(0.5, "Loading model from cache[19/38]: 800MB loaded. 50% completed")).toMatchObject({ phase: "cache" });
  expect(parseWebLlmProgress(0, "Start to fetch params")).toEqual({ type: "progress", progress: 0, text: "Start to fetch params" });
});

test("a model WebLLM dropped after a lost GPU device is recognised for automatic reload", () => {
  const msg = "Model not loaded before trying to complete ChatCompletionRequest. Please ensure you have called MLCEngine.reload(model)";
  expect(ENGINE_GONE.test(msg)).toBe(true);
  expect(ENGINE_GONE.test("Device was lost. This can happen due to insufficient memory")).toBe(true);
  expect(ENGINE_GONE.test("TypeError: Failed to fetch")).toBe(false);
  expect(classifyLoadError(msg)).toBe("gpu-memory");
});
