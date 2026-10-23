// Cheap, deterministic accuracy checks that need no extra model call: every number a summary states
// must appear in the source, and the document's key terms should be covered.
import { arabicRatio, tokenize } from "./nlp";

export interface GroundingReport {
  /** Numbers in the output that the source never mentions — the most common small-model hallucination. */
  unsupported: string[];
  /** How many numbers were checked. */
  checked: number;
  /** Key terms of the document the output does not mention. */
  missingTerms: string[];
  /** Share of key terms covered, 0..1 (1 when there are no key terms). */
  coverage: number;
}

const toAsciiDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** Numbers worth checking: 2+ digits, decimals or percentages. "3 themes" style counts are noise. */
export function numbersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of toAsciiDigits(text).matchAll(/\d[\d,،٬]*(?:[.٫]\d+)?\s*%?/g)) {
    const raw = m[0].trim();
    const n = raw.replace(/[,،٬]/g, "").replace("٫", ".").replace(/\s*%$/, "");
    if (n.length >= 2 || raw.endsWith("%") || n.includes(".")) out.add(n.replace(/\.0+$/, ""));
  }
  return [...out];
}

export function groundingReport(output: string, source: string, keyTerms: string[]): GroundingReport {
  const sourceNumbers = new Set(numbersIn(source));
  const nums = numbersIn(output);
  const unsupported = nums.filter((n) => !sourceNumbers.has(n));
  // Key terms are in the document's language; a summary written in the other language cannot echo them.
  const sameLanguage = arabicRatio(output) > 0.5 === arabicRatio(source.slice(0, 20_000)) > 0.5;
  const outTokens = new Set(tokenize(output));
  const missingTerms = sameLanguage
    ? keyTerms.filter((term) => {
        const [t] = tokenize(term);
        return t && !outTokens.has(t);
      })
    : [];
  return {
    unsupported,
    checked: nums.length,
    missingTerms,
    coverage: sameLanguage && keyTerms.length ? 1 - missingTerms.length / keyTerms.length : 1,
  };
}

/** Problems a refine pass should fix, phrased as instructions; empty when the draft is clean. */
export function refineIssues(r: GroundingReport): string[] {
  const issues: string[] = [];
  if (r.unsupported.length) issues.push(`These numbers do not appear in the source; remove them or replace them with the source's figures: ${r.unsupported.join(", ")}.`);
  if (r.missingTerms.length) issues.push(`These key topics of the document are missing; cover them if the source discusses them: ${r.missingTerms.join(", ")}.`);
  return issues;
}

/** Drops citation markers that point at no passage ([7] when only 4 were given). */
export const cleanCitations = (text: string, count: number) =>
  text.replace(/\[(\d+)\]/g, (m, n: string) => (Number(n) >= 1 && Number(n) <= count ? m : "")).replace(/ {2,}/g, " ");
