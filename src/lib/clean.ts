// Document cleanup before any model sees the text: running headers/footers, page numbers and the
// reference list are pure noise that small models happily summarize as if they were content.

export interface CleanReport {
  text: string;
  removedLines: number;
  referencesCut: boolean;
}

const PAGE_NUMBER = /^\s*(page|صفحة|ص)?\s*[\d٠-٩]+(\s*(of|من|\/)\s*[\d٠-٩]+)?\s*$/i;
const REFERENCES = /^\s*(\d+\.?\s*)?(references|bibliography|works cited|المراجع|قائمة المراجع|المصادر والمراجع|المصادر)\s*:?\s*$/i;

/** Signature that ignores digits, so "Journal of X — 12" and "Journal of X — 13" count as one header. */
const signature = (line: string) => line.trim().toLowerCase().replace(/[\d٠-٩]+/g, "#");

// Running headers/footers live in the first or last few lines of a page.
const EDGE = 3;
const isEdge = (i: number, len: number) => i < EDGE || i >= len - EDGE;

export function cleanPages(pages: string[][], opts = { removeHeaders: true, cutReferences: true }): CleanReport {
  let repeated = new Set<string>();
  if (opts.removeHeaders && pages.length >= 3) {
    const counts = new Map<string, number>();
    for (const lines of pages) {
      const sigs = new Set(lines.filter((_, i) => isEdge(i, lines.length)).map(signature));
      for (const sig of sigs) if (sig && sig.length < 120) counts.set(sig, (counts.get(sig) ?? 0) + 1);
    }
    for (const [sig, n] of counts) if (n >= Math.max(3, pages.length * 0.4)) repeated.add(sig);
  }

  const isHeader = (l: string, i: number, len: number) => isEdge(i, len) && repeated.has(signature(l));
  const totalLines = pages.reduce((n, l) => n + l.length, 0);
  const headerLines = pages.reduce((n, lines) => n + lines.filter((l, i) => isHeader(l, i, lines.length)).length, 0);
  // If "headers" would be most of the text, the pages are just uniform (slides, forms): keep everything.
  if (headerLines > totalLines * 0.5) repeated = new Set();

  let removedLines = 0;
  let kept = pages.map((lines) =>
    lines.filter((l, i) => {
      const drop = (opts.removeHeaders && PAGE_NUMBER.test(l)) || isHeader(l, i, lines.length);
      if (drop && l.trim()) removedLines++;
      return !drop;
    }),
  );

  // A references heading counts only in the last 40% of lines, never a table-of-contents entry up front.
  let referencesCut = false;
  const total = kept.reduce((n, l) => n + l.length, 0);
  let seen = 0;
  search: for (let p = 0; opts.cutReferences && p < kept.length; p++) {
    for (let i = 0; i < kept[p].length; i++, seen++) {
      if (seen >= total * 0.6 && REFERENCES.test(kept[p][i])) {
        kept = [...kept.slice(0, p), kept[p].slice(0, i)];
        referencesCut = true;
        break search;
      }
    }
  }

  const text = kept.map(joinLines).filter(Boolean).join("\n\n");
  return { text, removedLines, referencesCut };
}

/** Re-joins hard-wrapped lines into paragraphs and repairs words hyphenated across lines. */
export function joinLines(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (out && !out.endsWith("\n\n")) out += "\n\n";
      continue;
    }
    if (out.endsWith("-") && /^[a-z]/.test(l)) out = out.slice(0, -1) + l;
    else out += (out && !out.endsWith("\n") ? " " : "") + l;
  }
  return out.trim();
}
