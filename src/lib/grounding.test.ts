import { expect, test } from "vitest";
import { cleanCitations, groundingReport, numbersIn, refineIssues } from "./grounding";

test("numbersIn normalizes Arabic-Indic digits, separators and percentages", () => {
  expect(numbersIn("تراجع ١٫٥ متر و٨٠٪ و 1,500 حالة في 3 مناطق")).toEqual(["1.5", "80", "1500"]);
  expect(numbersIn("Rose 18% in 2050; 3 themes")).toEqual(["18", "2050"]);
});

test("unsupported numbers are flagged, supported ones pass", () => {
  const source = "Groundwater supplies 80% of water. Aquifers fell 1.5 m per year since 2004.";
  const r = groundingReport("• 80% from groundwater\n• falls 1.5 m yearly\n• 45% by 2030", source, []);
  expect(r.unsupported).toEqual(["45", "2030"]);
  expect(r.checked).toBe(4);
  expect(refineIssues(r)[0]).toContain("45, 2030");
});

test("coverage uses stems and is skipped across languages", () => {
  const source = "Desalination and wastewater reuse reduce aquifer depletion.";
  const en = groundingReport("Desalination helps.", source, ["Desalination", "wastewater", "aquifers"]);
  expect(en.missingTerms).toEqual(["wastewater", "aquifers"]);
  expect(en.coverage).toBeCloseTo(1 / 3);
  const ar = groundingReport("التحلية تساعد في الحد من استنزاف المياه.", source, ["Desalination", "wastewater"]);
  expect(ar.missingTerms).toEqual([]);
  expect(ar.coverage).toBe(1);
});

test("cleanCitations drops markers that point at no passage", () => {
  expect(cleanCitations("A [1] B [5] C [2]", 2)).toBe("A [1] B C [2]");
});
