import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { cleanPages } from "./clean";
import { convertToPages } from "./convert";
import { getSettings } from "./settings";

// PDF.js parses the file in its own Web Worker; only the extracted strings come back to the UI thread.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ExtractedDoc {
  name: string;
  text: string;
  pages: number;
  removedLines: number;
  referencesCut: boolean;
}

async function pdfLines(file: File, onProgress: (done: number, total: number) => void): Promise<string[][]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[][] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
      pages.push(lines);
      page.cleanup();
      onProgress(i, doc.numPages);
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

export async function extractFile(file: File, onProgress: (done: number, total: number) => void): Promise<ExtractedDoc> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  let pages: string[][];
  const converted = file.type === "application/pdf" || ext === "pdf" ? null : await convertToPages(file);
  if (converted) {
    pages = converted;
    onProgress(1, 1);
  } else if (file.type === "application/pdf" || ext === "pdf") pages = await pdfLines(file, onProgress);
  else if (file.type.startsWith("text/") || ext === "txt" || ext === "md" || ext === "markdown") {
    pages = [(await file.text()).split(/\r?\n/)];
    onProgress(1, 1);
  } else throw new Error("unsupported");
  const { removeHeaders, cutReferences } = getSettings();
  return { name: file.name, pages: pages.length, ...cleanPages(pages, { removeHeaders, cutReferences, structured: !!converted }) };
}
