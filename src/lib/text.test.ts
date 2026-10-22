import { test } from "vitest";
import assert from "node:assert/strict";
import { batchByLength, chunkText, extractJson, spread, validateStudySet } from "./text.ts";

test("chunkText keeps every chunk within size and loses no words", () => {
  const para = "Sentence number one is here. ".repeat(40);
  const text = Array.from({ length: 30 }, () => para).join("\n\n");
  const chunks = chunkText(text, 1000, 100);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1100, `chunk too long: ${c.length}`);
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  assert.ok(chunks.reduce((n, c) => n + words(c), 0) >= words(text));
});

test("chunkText splits a separator-free string by hard cut", () => {
  assert.deepEqual(chunkText("x".repeat(2500), 1000, 0).map((c) => c.length), [1000, 1000, 500]);
  assert.deepEqual(chunkText("   "), []);
});

test("batchByLength respects the budget", () => {
  assert.deepEqual(batchByLength(["aaa", "bbb", "ccc", "d"], 7), [["aaa", "bbb"], ["ccc", "d"]]);
});

test("spread samples evenly", () => {
  assert.deepEqual(spread([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3), [0, 3, 6]);
});

test("extractJson digs JSON out of chatter and fences", () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a": "b}", "c": [1]}\n```'), { a: "b}", c: [1] });
  assert.equal(extractJson("no json"), null);
});

test("validateStudySet drops malformed items", () => {
  const out = validateStudySet({
    mcqs: [
      { question: "Q", options: ["a", "b", "c", "d"], answer: 2 },
      { question: "Q", options: ["a", "b"], answer: 0 },
      { question: "Q", options: ["a", "b", "c", "d"], answer: 4 },
    ],
    flashcards: [{ question: "Q", answer: "A" }, { question: "", answer: "A" }],
  });
  assert.equal(out.mcqs.length, 1);
  assert.equal(out.flashcards.length, 1);
});
