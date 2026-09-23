import "dotenv/config";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_TWELVELABS_MODEL,
  normalizeGeminiModel,
  normalizeGroqModel,
  normalizeTwelveLabsModel,
} from "@channelpilot/shared";
import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default(DEFAULT_GEMINI_MODEL),
  TWELVELABS_API_KEY: z.string().default(""),
  TWELVELABS_MODEL: z.string().default(DEFAULT_TWELVELABS_MODEL),
  GROQ_API_KEY: z.string().default(""),
  GROQ_MODEL: z.string().default(DEFAULT_GROQ_MODEL),
  GROQ_TRANSCRIPTION_MODEL: z.string().default("whisper-large-v3-turbo"),
  ALLOWED_EXTENSION_IDS: z.string().default(""),
  DEV_BYPASS_AUTH: booleanFromString,
});

const parsed = schema.parse(process.env);
const allowedExtensionIds = parsed.ALLOWED_EXTENSION_IDS.split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (parsed.NODE_ENV === "production") {
  if (
    !/^[a-z0-9][a-z0-9._-]*\.apps\.googleusercontent\.com$/i.test(
      parsed.GOOGLE_CLIENT_ID.trim(),
    )
  ) {
    throw new Error(
      "Production API requires a valid GOOGLE_CLIENT_ID ending in .apps.googleusercontent.com",
    );
  }
  if (
    allowedExtensionIds.length === 0 ||
    allowedExtensionIds.some((id) => !/^[a-p]{32}$/.test(id))
  ) {
    throw new Error(
      "Production API requires ALLOWED_EXTENSION_IDS with valid 32-character Chrome extension IDs",
    );
  }
}

export const config = {
  port: parsed.PORT,
  host: parsed.HOST,
  nodeEnv: parsed.NODE_ENV,
  googleClientId: parsed.GOOGLE_CLIENT_ID,
  geminiApiKey: parsed.GEMINI_API_KEY,
  geminiModel: normalizeGeminiModel(parsed.GEMINI_MODEL),
  twelveLabsApiKey: parsed.TWELVELABS_API_KEY,
  twelveLabsModel: normalizeTwelveLabsModel(parsed.TWELVELABS_MODEL),
  groqApiKey: parsed.GROQ_API_KEY,
  groqModel: normalizeGroqModel(parsed.GROQ_MODEL),
  groqTranscriptionModel: parsed.GROQ_TRANSCRIPTION_MODEL,
  allowedExtensionIds: new Set(allowedExtensionIds),
  devBypassAuth: parsed.DEV_BYPASS_AUTH,
};
