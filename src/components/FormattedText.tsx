import type { ReactNode } from "react";
import { parseText } from "@/lib/export/model";

// Renders the blocks parseText() finds ("• " bullets, "Heading:" lines, Q/A pairs, tables, [n] citations)
// without a markdown dependency. The Markdown/Word/PDF exports use the same parser.

function inline(text: string, onCite?: (n: number) => void): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return part;
    const n = Number(m[1]);
    return (
      <button
        key={i}
        type="button"
        onClick={() => onCite?.(n)}
        className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-accent/20 px-1 align-text-top text-[0.7rem] font-semibold hover:bg-accent/40"
      >
        {n}
      </button>
    );
  });
}

export function FormattedText({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  const blocks = parseText(text).map((b, i) => {
    switch (b.t) {
      case "ul":
        return (
          <ul key={i} className="my-2 list-disc space-y-1 ps-5 marker:text-accent">
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, onCite)}</li>
            ))}
          </ul>
        );
      case "qa":
        return (
          <p key={i} className={b.role === "q" ? "mt-3 font-semibold" : "text-muted-foreground"}>
            <span className="me-1 text-accent">{b.label}:</span>
            {inline(b.text, onCite)}
          </p>
        );
      case "h":
        return (
          <h3 key={i} className="mt-4 font-display text-base font-semibold first:mt-0">
            {b.text}
          </h3>
        );
      case "table":
        return (
          <div key={i} className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className={j === 0 ? "bg-accent/10 font-semibold" : ""}>
                    {r.map((c, k) => (
                      <td key={k} className="border border-border px-2 py-1 align-top">
                        {inline(c, onCite)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "p":
        return (
          <p key={i} className="my-2">
            {inline(b.text, onCite)}
          </p>
        );
      default:
        return null; // mcq/card/sources blocks only come from structured exports, never from model text
    }
  });
  // Model output can contain URLs or glued words; wrap them instead of widening the page.
  return <div className="leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>;
}
