import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import {
  safeErrorMessage,
  type AiProvider,
  type AnalysisRequest,
  type VideoContext,
} from "@channelpilot/shared";
import { z } from "zod";
import { analyzeMedia, analyzeText } from "./analysis.js";
import { requireGoogleAccessToken } from "./auth.js";
import { config } from "./config.js";

const contextSchema = z.object({
  title: z.string().max(200).default(""),
  description: z.string().max(20_000).default(""),
  tags: z.array(z.string().max(100)).max(30).default([]),
  transcript: z.string().max(100_000).optional(),
  topic: z.string().max(300).optional(),
  language: z.enum(["ru", "en"]).default("ru"),
  audience: z.string().max(300).optional(),
  tone: z.string().max(200).optional(),
  videoId: z.string().max(32).optional(),
});

const providerSchema = z.enum([
  "auto",
  "gemini",
  "twelvelabs",
  "groq",
  "both",
  "local-fallback",
]);
const analysisSchema = z.object({
  context: contextSchema,
  provider: providerSchema.default("auto"),
});

function asVideoContext(input: z.infer<typeof contextSchema>): VideoContext {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as unknown as VideoContext;
}

const app = Fastify({
  logger: {
    level: config.nodeEnv === "development" ? "info" : "warn",
    redact: ["req.headers.authorization"],
  },
  bodyLimit: 2 * 1024 * 1024,
});

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (
      config.nodeEnv !== "production" &&
      /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }
    const extensionId = origin.match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1];
    const developmentWildcard =
      config.nodeEnv !== "production" && config.allowedExtensionIds.size === 0;
    callback(
      null,
      Boolean(
        extensionId &&
        (developmentWildcard || config.allowedExtensionIds.has(extensionId)),
      ),
    );
  },
});
await app.register(rateLimit, { max: 30, timeWindow: "1 minute" });
await app.register(multipart, {
  limits: {
    files: 1,
    fileSize: 100 * 1024 * 1024,
    fields: 4,
  },
});

app.get("/health", async () => ({
  ok: true,
  providers: {
    gemini: Boolean(config.geminiApiKey),
    twelvelabs: Boolean(config.twelveLabsApiKey),
    groq: Boolean(config.groqApiKey),
    fallback: true,
  },
}));

app.post(
  "/v1/analyze",
  { preHandler: requireGoogleAccessToken },
  async (request, reply) => {
    const parsed = analysisSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid analysis request",
        details: z.treeifyError(parsed.error),
      });
    }
    try {
      return await analyzeText(parsed.data as AnalysisRequest);
    } catch (error) {
      request.log.error(error);
      return reply.code(502).send({
        error: safeErrorMessage(error, "AI analysis failed"),
      });
    }
  },
);

app.post(
  "/v1/analyze/media",
  { preHandler: requireGoogleAccessToken },
  async (request, reply) => {
    let context: VideoContext | undefined;
    let provider: AiProvider = "auto";
    let bytes: Buffer | undefined;
    let filename = "media.bin";
    let mimeType = "application/octet-stream";

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          filename =
            part.filename
              .replace(/\u0000/g, "")
              .replace(/[^\p{L}\p{N}._ -]/gu, "_")
              .slice(0, 180) || "media.bin";
          mimeType = part.mimetype;
          const supported =
            /^(video|audio|image|text)\//.test(mimeType) ||
            /^application\/(?:octet-stream|x-subrip|vtt)$/.test(mimeType);
          if (!supported) {
            throw new Error(`Unsupported media type: ${mimeType}`);
          }
          bytes = await part.toBuffer();
        } else if (part.fieldname === "context") {
          context = asVideoContext(contextSchema.parse(JSON.parse(String(part.value))));
        } else if (part.fieldname === "provider") {
          provider = providerSchema.parse(String(part.value));
        }
      }
      if (!context || !bytes) {
        return reply.code(400).send({ error: "context and media file are required" });
      }
      if (bytes.length === 0) {
        return reply.code(400).send({ error: "media file is empty" });
      }
      const textLike =
        /^(text\/|application\/(?:x-subrip|vtt))/.test(mimeType) ||
        /\.(?:srt|vtt|txt)$/i.test(filename);
      if (textLike && bytes.length > 5 * 1024 * 1024) {
        return reply.code(413).send({
          error: "subtitle or transcript files are limited to 5 MB",
        });
      }
      return await analyzeMedia(context, provider, bytes, filename, mimeType);
    } catch (error) {
      const message = safeErrorMessage(error, "Media analysis failed");
      const statusCode =
        /too large|larger than|exceeds?.*(?:limit|maximum)|limited to \d+\s*(?:mb|мб)/i.test(
          message,
        )
          ? 413
          : /unsupported media type/i.test(message)
            ? 415
            : error instanceof SyntaxError || error instanceof z.ZodError
              ? 400
              : 502;
      if (statusCode >= 500) request.log.error(error);
      return reply.code(statusCode).send({ error: message });
    }
  },
);

app.setErrorHandler((error: FastifyError, _request, reply) => {
  const statusCode = error.statusCode ?? 500;
  void reply.code(statusCode).send({
    error: statusCode >= 500 ? "Internal server error" : error.message,
  });
});

await app.listen({ port: config.port, host: config.host });
