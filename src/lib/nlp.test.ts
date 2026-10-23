import { expect, test } from "vitest";
import { arabicRatio, Bm25, compress, dedupe, findLoop, isGibberish, keywords, normalize, tokenize } from "./nlp";
import { cleanPages, joinLines } from "./clean";

test("normalize folds Arabic variants and diacritics", () => {
  expect(normalize("الإحْصَاءُ")).toBe(normalize("الاحصاء"));
  expect(normalize("مدرسة")).toBe("مدرسه");
});

test("tokenize drops stopwords and strips the Arabic article", () => {
  expect(tokenize("The models are trained on the data")).toEqual(["model", "trained", "data"]);
  expect(tokenize("في المكتبة الكبيرة")).toEqual(["مكتبه", "كبيره"]);
});

test("BM25 ranks the passage that matches the query first, across scripts", () => {
  const bm = new Bm25([
    "Photosynthesis converts light into chemical energy in chloroplasts.",
    "The French revolution began in 1789.",
    "يتكوّن الماء من الهيدروجين والأكسجين.",
  ]);
  expect(bm.search("how does photosynthesis work")[0].index).toBe(0);
  expect(bm.search("الأكسجين")[0].index).toBe(2);
  expect(bm.search("quantum")).toEqual([]);
});

test("keywords surfaces document-specific terms in readable form", () => {
  const docs = [
    "Mitochondria produce energy. Mitochondria have their own DNA.",
    "Ribosomes build proteins. Proteins fold into shapes.",
  ];
  const k = keywords(docs, 4).map((w) => w.toLowerCase());
  expect(k).toContain("mitochondria");
  expect(k).toContain("proteins");
});

test("keywords ignores glued PDF tokens", () => {
  const glued = "الذكاءالاصطناعيوالتعلمالعميقفيمعالجةاللغات";
  const k = keywords([`${glued} ${glued} التعلم الشبكات`, `${glued} الشبكات العصبية`], 10);
  expect(k.some((w) => w.length > 24)).toBe(false);
});

test("compress keeps the requested share and original order", () => {
  const text = Array.from({ length: 20 }, (_, i) => `Sentence ${i} talks about topic${i % 5} details.`).join(" ");
  const out = compress(text, 0.4);
  expect(out.length).toBeLessThanOrEqual(text.length * 0.45);
  const nums = [...out.matchAll(/Sentence (\d+)/g)].map((m) => Number(m[1]));
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  expect(compress(text, 1)).toBe(text);
});

test("dedupe removes near-duplicate questions", () => {
  const qs = ["What is the main function of mitochondria?", "What is the main function of the mitochondria", "Who discovered DNA?"];
  expect(dedupe(qs, (q) => q)).toEqual([qs[0], qs[2]]);
});

test("findLoop cuts a repeating tail and ignores normal text", () => {
  const unit = "The results show a significant improvement. ";
  const looped = "Intro text. " + unit.repeat(5);
  const cut = findLoop(looped);
  expect(cut).toBeGreaterThan(0);
  expect(looped.slice(0, cut).split(unit.trim()).length - 1).toBeLessThanOrEqual(2);
  expect(findLoop("A perfectly normal paragraph without repetition. ".concat("Another sentence here. ", "And a third."))).toBe(-1);
});

test("arabicRatio", () => {
  expect(arabicRatio("hello")).toBe(0);
  expect(arabicRatio("مرحبا")).toBe(1);
});

test("cleanPages removes running headers, page numbers and the reference list", () => {
  const page = (n: number, body: string[]) => ["Journal of Testing, Vol. 3", ...body, `${n}`];
  const pages = [
    page(1, ["Introduction", "Cells are small."]),
    page(2, ["Methods", "We looked at cells."]),
    page(3, ["Results", "Cells grew."]),
    page(4, ["Conclusion", "Cells matter.", "References", "[1] Smith 2020."]),
  ];
  const r = cleanPages(pages);
  expect(r.text).not.toContain("Journal of Testing");
  expect(r.text).not.toContain("Smith");
  expect(r.text).toContain("Cells matter.");
  expect(r.referencesCut).toBe(true);
  expect(r.removedLines).toBe(8);
});

test("cleanPages keeps uniform pages instead of deleting them as headers", () => {
  const pages = [1, 2, 3].map((n) => ["Same line A", "Same line B", `Same line C ${n}`]);
  const r = cleanPages(pages);
  expect(r.text).toContain("Same line A");
  expect(r.removedLines).toBe(0);
});

test("cleanPages only treats page edges as headers", () => {
  const body = Array.from({ length: 8 }, (_, i) => `Body line ${i}`);
  const pages = [1, 2, 3, 4].map((n) => ["Running title", ...body.map((b) => `${b} p${n}x`), "Repeated mid sentence", ...body, `${n}`]);
  const r = cleanPages(pages);
  expect(r.text).not.toContain("Running title");
  expect(r.text).toContain("Repeated mid sentence"); // appears on every page, but not at an edge
});

test("joinLines repairs hyphenation and keeps paragraphs", () => {
  expect(joinLines(["An exam-", "ple line", "", "Next para"])).toBe("An example line\n\nNext para");
});

test("cleanPages options can disable header removal and reference cutting", () => {
  const pages = [1, 2, 3, 4].map((n) => ["Running title", `Body ${n} unique text`, `${n}`]);
  pages[3].push("References", "[1] Smith");
  const r = cleanPages(pages, { removeHeaders: false, cutReferences: false });
  expect(r.text).toContain("Running title");
  expect(r.text).toContain("Smith");
  expect(r.removedLines).toBe(0);
});

test("isGibberish flags GPU token soup, not prose, tables or short answers", () => {
  const soup = "une-m-m-m-m-m-m-m-m-m-m-m-m-m-m-m-m-m-m-m-m-m-une ".repeat(12);
  expect(isGibberish(soup)).toBe(true);
  const en =
    "The study followed 240 patients for two years. Those who received the new treatment reported fewer symptoms, " +
    "shorter hospital stays and a lower rate of relapse than the control group, although the effect faded after month eighteen. ";
  expect(isGibberish(en.repeat(3))).toBe(false);
  const ar =
    "تابعت الدراسة 240 مريضًا مدة عامين. أبلغ من تلقّوا العلاج الجديد عن أعراض أقل وإقامة أقصر في المستشفى " +
    "ومعدل انتكاس أدنى من المجموعة الضابطة، مع أن الأثر تراجع بعد الشهر الثامن عشر. ";
  expect(isGibberish(ar.repeat(3))).toBe(false);
  expect(isGibberish(`| Term | Meaning |\n|---|---|\n| ATP | cell energy currency |\n${en}`)).toBe(false);
  expect(isGibberish("B")).toBe(false);
  expect(isGibberish("-m-m-m-m")).toBe(false);
});
