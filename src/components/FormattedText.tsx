import type { ReactNode } from "react";

// Renders the plain-text conventions the prompts ask for ("• " bullets, "Heading:" lines, Q/A pairs,
// [n] citations) without a markdown dependency, and tolerates stray markdown small models still emit.

const BULLET = /^\s*([•\-*–▪]|\d+[.)])\s+/;
const QA = /^(س|ج|Q|A)\s*[:：]\s*/;

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
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`ul${blocks.length}`} className="my-2 list-disc space-y-1 ps-5 marker:text-accent">{list}</ul>);
    list = [];
  };

  text
    .replace(/\*\*/g, "")
    .split("\n")
    .forEach((raw, i) => {
      const line = raw.replace(/^#{1,6}\s*/, "").trimEnd();
      if (!line.trim()) return flush();
      if (BULLET.test(line)) {
        list.push(<li key={i}>{inline(line.replace(BULLET, ""), onCite)}</li>);
        return;
      }
      flush();
      const qa = line.match(QA);
      if (qa) {
        const isQuestion = qa[1] === "س" || qa[1] === "Q";
        blocks.push(
          <p key={i} className={isQuestion ? "mt-3 font-semibold" : "text-muted-foreground"}>
            <span className="me-1 text-accent">{qa[1]}:</span>
            {inline(line.slice(qa[0].length), onCite)}
          </p>,
        );
      } else if (/[:：]$/.test(line) && line.length <= 80) {
        blocks.push(
          <h3 key={i} className="mt-4 font-display text-base font-semibold first:mt-0">
            {line.replace(/[:：]$/, "")}
          </h3>,
        );
      } else {
        blocks.push(
          <p key={i} className="my-2">
            {inline(line, onCite)}
          </p>,
        );
      }
    });
  flush();
  return <div className="leading-relaxed">{blocks}</div>;
}
