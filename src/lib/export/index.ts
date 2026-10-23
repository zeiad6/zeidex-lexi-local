// Saves an ExportDoc as Markdown, Word or PDF on every platform (web, desktop, Android).
import plexArabic400 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2?url";
import plexArabic600 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2?url";
import plexLatin400 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-400-normal.woff2?url";
import plexLatin600 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-600-normal.woff2?url";
import amiriArabic700 from "@fontsource/amiri/files/amiri-arabic-700-normal.woff2?url";
import amiriLatin700 from "@fontsource/amiri/files/amiri-latin-700-normal.woff2?url";
import { android, desktop, saveFile, toBase64 } from "../native";
import { toDocx } from "./docx";
import { toHtml } from "./html";
import { toMarkdown } from "./markdown";
import type { ExportDoc } from "./model";

export * from "./model";

export type ExportFormat = "md" | "docx" | "pdf";

const ARABIC = "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC";
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const FONTS = [
  { family: "IBM Plex Sans Arabic", weight: 400, url: plexArabic400, range: ARABIC },
  { family: "IBM Plex Sans Arabic", weight: 400, url: plexLatin400, range: LATIN },
  { family: "IBM Plex Sans Arabic", weight: 600, url: plexArabic600, range: ARABIC },
  { family: "IBM Plex Sans Arabic", weight: 600, url: plexLatin600, range: LATIN },
  { family: "Amiri", weight: 700, url: amiriArabic700, range: ARABIC },
  { family: "Amiri", weight: 700, url: amiriLatin700, range: LATIN },
];

let fontCss: Promise<string> | null = null;
/** The print view is a separate document (iframe / off-screen WebView / hidden window), so the app's
 * fonts are inlined as data URLs; it then renders identically offline on every platform. */
function inlineFonts(): Promise<string> {
  fontCss ??= Promise.all(
    FONTS.map(async (f) => {
      try {
        const bytes = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
        return `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${toBase64(bytes)}) format("woff2");unicode-range:${f.range}}`;
      } catch {
        return ""; // system fallback fonts still render the document
      }
    }),
  ).then((rules) => rules.join("\n"));
  return fontCss;
}

function printInIframe(html: string) {
  const frame = Object.assign(document.createElement("iframe"), { srcdoc: html, title: "print" });
  frame.style.cssText = "position:fixed;inset-inline-start:-10000px;top:0;width:794px;height:1123px;border:0;";
  frame.onload = () => {
    const w = frame.contentWindow;
    // Fonts must finish decoding or the first printed page falls back to system fonts.
    void (w?.document.fonts?.ready ?? Promise.resolve()).then(() => {
      w?.focus();
      w?.print();
      setTimeout(() => frame.remove(), 60_000);
    });
  };
  document.body.append(frame);
}

/**
 * Returns where the file went (Android path / desktop path), or null when the browser handled it
 * (download or print dialog) or the user cancelled.
 */
export async function exportDoc(doc: ExportDoc, format: ExportFormat, stem: string): Promise<string | null> {
  if (format === "md") return saveFile(`${stem}.md`, toMarkdown(doc), "text/markdown;charset=utf-8");
  if (format === "docx") return saveFile(`${stem}.docx`, toDocx(doc), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const html = toHtml(doc, await inlineFonts());
  if (desktop?.printToPdf) return desktop.printToPdf(html, stem);
  if (android) {
    if (android.printHtml) android.printHtml(html, stem);
    // An older installed app without the print bridge still gets a printable HTML file.
    else return saveFile(`${stem}.html`, html, "text/html;charset=utf-8");
    return null;
  }
  printInIframe(html);
  return null;
}
