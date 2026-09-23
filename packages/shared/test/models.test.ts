import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_TWELVELABS_MODEL,
  normalizeGeminiModel,
  normalizeGroqModel,
  normalizeTwelveLabsModel,
} from "../src/models.js";

describe("AI model settings", () => {
  it("migrates shut-down Gemini 1.x/2.x models", () => {
    expect(normalizeGeminiModel("models/gemini-2.5-flash")).toBe(DEFAULT_GEMINI_MODEL);
    expect(normalizeGeminiModel("gemini-2.5-flash-latest")).toBe(DEFAULT_GEMINI_MODEL);
    expect(normalizeGeminiModel("gemini-2.0-flash")).toBe(DEFAULT_GEMINI_MODEL);
    expect(normalizeGeminiModel("gemini-1.5-pro")).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("accepts current and custom Gemini model IDs", () => {
    expect(normalizeGeminiModel("models/gemini-3.6-flash")).toBe("gemini-3.6-flash");
    expect(normalizeGeminiModel("custom-gemini-model")).toBe("custom-gemini-model");
  });

  it("uses the current Groq default when the model is empty", () => {
    expect(normalizeGroqModel("")).toBe(DEFAULT_GROQ_MODEL);
    expect(normalizeGroqModel("qwen/qwen3.6-27b")).toBe("qwen/qwen3.6-27b");
  });

  it("accepts supported Pegasus models and migrates removed ones", () => {
    expect(normalizeTwelveLabsModel("PEGASUS1.5")).toBe("pegasus1.5");
    expect(normalizeTwelveLabsModel("pegasus1.2")).toBe(DEFAULT_TWELVELABS_MODEL);
    expect(normalizeTwelveLabsModel("pegasus-legacy")).toBe(DEFAULT_TWELVELABS_MODEL);
  });
});
