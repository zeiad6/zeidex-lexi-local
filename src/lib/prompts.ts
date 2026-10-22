import type { Lang } from "@/i18n";

export type SummaryFormat = "bullets" | "executive" | "exam";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const LANGUAGE_RULE: Record<Lang, string> = {
  ar: `Write ONLY in Modern Standard Arabic (الفصحى), in a clear, formal academic register.
The source may be in English or any other language: translate the ideas, do not copy English sentences.
Keep proper nouns, formulas, code and established technical terms in their original form, adding the term in parentheses after its Arabic equivalent the first time, e.g. "التعلّم العميق (Deep Learning)".
Use Arabic punctuation (، ؛ ؟). Never mix Arabic and English inside one sentence except for those terms.`,
  en: `Write ONLY in clear, formal academic English. If the source is in another language, translate the ideas faithfully.`,
};

const BASE = `You are a meticulous academic research assistant.
Rules:
- Use only information present in the provided text. Never invent facts, numbers, citations or authors.
- Preserve key definitions, numbers, results, methods and conclusions.
- Be concise: no introductions like "This text discusses", no closing remarks.
- Use plain text. Use "• " for bullets and short lines ending with ":" for headings. No markdown symbols like ** or #.`;

const system = (lang: Lang) => `${BASE}\n\n${LANGUAGE_RULE[lang]}`;

/** Map step: condense one chunk into dense notes that later steps can merge. */
export function chunkNotesPrompt(chunk: string, index: number, total: number, lang: Lang): ChatMessage[] {
  return [
    { role: "system", content: system(lang) },
    {
      role: "user",
      content: `Section ${index + 1} of ${total} of a longer document.
Extract its essential content as 4–8 dense bullet points: main claims, definitions, data, methods and conclusions.

<section>
${chunk}
</section>`,
    },
  ];
}

/** Reduce step: merge several sets of notes into one shorter set without losing key points. */
export function mergeNotesPrompt(notes: string[], lang: Lang): ChatMessage[] {
  return [
    { role: "system", content: system(lang) },
    {
      role: "user",
      content: `Below are notes from consecutive sections of one document.
Merge them into a single set of 6–10 bullet points. Remove repetition, keep every important fact, keep the original order of ideas.

${notes.map((n, i) => `<notes part="${i + 1}">\n${n}\n</notes>`).join("\n\n")}`,
    },
  ];
}

const FORMAT_TASK: Record<SummaryFormat, string> = {
  bullets: `Produce a structured summary:
- One heading per major theme (2–5 themes).
- Under each heading, 3–6 bullet points with the key facts.
- End with a heading "Key takeaways:" (in the output language) and 3 bullets.`,
  executive: `Produce an executive summary of 3–5 well-formed paragraphs:
1. Purpose and context.
2. Approach or main arguments.
3. Key findings, with numbers where available.
4. Implications, limitations and recommendations.
Write flowing prose, not bullets.`,
  exam: `Produce exam-preparation material:
- 8–12 study questions, each followed by a concise model answer on the next line.
- Mix recall, understanding and application questions.
- Format each item as "س: …" then "ج: …" when writing Arabic, or "Q: …" then "A: …" when writing English.`,
};

// Statistical key terms steer small models toward full coverage instead of fixating on the first section.
const coverage = (terms: string[]) =>
  terms.length ? `\nMake sure the result covers these key terms of the document where relevant: ${terms.join(", ")}.` : "";

/** Final step: turn the merged notes (or the whole short text) into the requested format. */
export function finalPrompt(
  material: string,
  format: SummaryFormat,
  lang: Lang,
  isRawText: boolean,
  keyTerms: string[] = [],
): ChatMessage[] {
  return [
    { role: "system", content: system(lang) },
    {
      role: "user",
      content: `${FORMAT_TASK[format]}${coverage(keyTerms)}

${isRawText ? "<document>" : "<notes covering the whole document>"}
${material}
${isRawText ? "</document>" : "</notes>"}`,
    },
  ];
}

/** Self-refinement: a second pass that checks the draft against its source and fixes it. */
export function refinePrompt(draft: string, source: string, format: SummaryFormat, lang: Lang): ChatMessage[] {
  return [
    { role: "system", content: system(lang) },
    {
      role: "user",
      content: `You wrote the draft below from the source material. Review it critically:
1. Remove any claim, number or name that the source does not support.
2. Add important points from the source that the draft missed.
3. Remove repetition and tighten wording.
4. Keep the required format:
${FORMAT_TASK[format]}
Output ONLY the improved final version, with no comments about the changes.

<source>
${source}
</source>

<draft>
${draft}
</draft>`,
    },
  ];
}

/** Retrieval-augmented answer: only the retrieved passages, with numbered citations. */
export function answerPrompt(question: string, passages: { n: number; text: string }[], lang: Lang): ChatMessage[] {
  return [
    { role: "system", content: system(lang) },
    {
      role: "user",
      content: `Answer the question using ONLY the numbered passages from the document.
- Cite the passages you used like [1] or [2][3] right after each claim.
- If the passages do not contain the answer, say so plainly in one sentence instead of guessing.
- Be direct: 2–6 sentences or a short list.

${passages.map((p) => `<passage n="${p.n}">\n${p.text}\n</passage>`).join("\n\n")}

Question: ${question}`,
    },
  ];
}

/** Cross-lingual retrieval: turn a question into search keywords in the document's language. */
export function queryTranslatePrompt(question: string, docLanguage: "Arabic" | "English"): ChatMessage[] {
  return [
    { role: "system", content: "You turn questions into search keywords. Output only the keywords on one line." },
    {
      role: "user",
      content: `Translate this question into ${docLanguage} search keywords: 5 to 10 important words, no punctuation, no explanation.\n\n${question}`,
    },
  ];
}

export const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

/** Self-check: the model answers its own question blind; disagreement with the key flags a bad item. */
export function verifyMcqPrompt(question: string, options: string[], source: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: "You answer multiple-choice questions strictly from the given text. Reply with a single letter: A, B, C or D.",
    },
    {
      role: "user",
      content: `<text>
${source}
</text>

${question}
${options.map((o, i) => `${OPTION_LETTERS[i]}) ${o}`).join("\n")}

Answer letter:`,
    },
  ];
}

/** JSON schema used for constrained decoding on WebLLM (and as an instruction for the CPU fallback). */
export const STUDY_SCHEMA = {
  type: "object",
  properties: {
    mcqs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          // Kept to plain types: counts and ranges are enforced by validateStudySet, not the grammar.
          options: { type: "array", items: { type: "string" } },
          answer: { type: "integer" },
          explanation: { type: "string" },
        },
        required: ["question", "options", "answer", "explanation"],
      },
    },
    flashcards: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, answer: { type: "string" } },
        required: ["question", "answer"],
      },
    },
  },
  required: ["mcqs", "flashcards"],
} as const;

export function studyPrompt(chunk: string, lang: Lang): ChatMessage[] {
  return [
    { role: "system", content: system(lang) },
    {
      role: "user",
      content: `Create study material from the section below.
Return ONLY a JSON object with:
- "mcqs": 3 multiple-choice questions. Each has "question", exactly 4 "options", "answer" (index 0–3 of the correct option) and a one-sentence "explanation". Wrong options must be plausible. Vary the position of the correct answer.
- "flashcards": 3 short question/answer pairs testing key definitions or facts.
All text values must follow the language rule above. JSON keys stay in English.

Example shape:
{"mcqs":[{"question":"…","options":["…","…","…","…"],"answer":1,"explanation":"…"}],"flashcards":[{"question":"…","answer":"…"}]}

<section>
${chunk}
</section>`,
    },
  ];
}
