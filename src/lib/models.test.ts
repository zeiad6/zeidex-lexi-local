import { expect, test } from "vitest";
import { forGpu, wantsF16 } from "./models";

const PHONE = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";

test("phones get the 32-bit build unless the user asks for 16-bit", () => {
  expect(forGpu("Qwen3.5-0.8B-q4f16_1-MLC", wantsF16(true, "auto", PHONE))).toBe("Qwen3.5-0.8B-q4f32_1-MLC");
  expect(wantsF16(true, "auto", DESKTOP)).toBe(true);
  expect(wantsF16(true, "f16", PHONE)).toBe(true);
  expect(wantsF16(true, "f32", DESKTOP)).toBe(false);
  // A GPU without shader-f16 cannot run the 16-bit build whatever the setting says.
  expect(wantsF16(false, "f16", DESKTOP)).toBe(false);
});
