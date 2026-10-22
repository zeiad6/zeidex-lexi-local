import { expect, test } from "vitest";
import { toTrainingJsonl, type HistoryEntry } from "./history";

const entry = (rating: HistoryEntry["rating"], output: string): HistoryEntry => ({
  id: output,
  kind: "summary",
  createdAt: 0,
  docName: "d.pdf",
  title: "t",
  lang: "ar",
  quality: "balanced",
  mode: "local",
  models: [],
  output,
  rating,
  pairs: [{ task: "final", via: "local", model: "m", messages: [{ role: "user", content: "q" }], output }],
});

test("training export is chat-format JSONL and never includes disliked runs", () => {
  const list = [entry(1, "good"), entry(undefined, "neutral"), entry(-1, "bad")];
  const all = toTrainingJsonl(list, false).split("\n").map((l) => JSON.parse(l));
  expect(all.map((r) => r.messages.at(-1).content)).toEqual(["good", "neutral"]);
  expect(all[0].messages[0]).toEqual({ role: "user", content: "q" });
  expect(toTrainingJsonl(list, true).split("\n")).toHaveLength(1);
});

import { diffRevisions, repoOf } from "./updates";

test("model update diff: first sight sets a baseline, a changed sha is an update", () => {
  const { outdated, nextBaseline } = diffRevisions({ a: "1", b: "2" }, { a: "1", b: "3", c: "9", d: null });
  expect(outdated).toEqual(["b"]);
  expect(nextBaseline).toEqual({ a: "1", b: "2", c: "9" });
  expect(repoOf("Qwen3.5-2B-q4f16_1-MLC")).toBe("mlc-ai/Qwen3.5-2B-q4f16_1-MLC");
  expect(repoOf("onnx-community/Qwen2.5-0.5B-Instruct")).toBe("onnx-community/Qwen2.5-0.5B-Instruct");
});
