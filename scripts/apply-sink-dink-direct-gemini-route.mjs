import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const routePath = "server/src/routes/sink-dink-direct-gemini.ts";
const appPath = "server/src/app.ts";

const routeSource = String.raw`import { Router, type Request, type Response } from "express";

type GeminiCandidate = {
  content?: {
    parts?: Array<{ text?: string }>;
    role?: string;
  };
  finishReason?: string;
  index?: number;
};

type GeminiApiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: unknown;
  modelVersion?: string;
  responseId?: string;
  error?: unknown;
};

type SinkDinkCreateBody = {
  topic?: unknown;
  count?: unknown;
  tone?: unknown;
  durationSec?: unknown;
  model?: unknown;
  temperature?: unknown;
};

function envFlag(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value.trim().length > 0);
}

function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

function getGeminiModel(requested?: unknown): string {
  const raw =
    (typeof requested === "string" && requested.trim()) ||
    process.env.SINK_DINK_GEMINI_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash";
  return raw.replace(/^models\//, "");
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function toText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function extractModelText(payload: GeminiApiResponse): string {
  return (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .filter((part) => part.trim().length > 0)
    .join("\n")
    .trim();
}

function parseJsonFromText(rawText: string): unknown | null {
  const trimmed = rawText.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    // Continue to best-effort object extraction below.
  }

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function buildSinkDinkPrompt(input: Required<Pick<SinkDinkCreateBody, "topic" | "tone" | "durationSec">> & { count: number }): string {
  return `You are CEO Builder Agent for SINK DINK India AI Media Organisation.

Strict direction:
Dashboard/API trigger → CEO Builder Agent → full organisation build → upload-ready content pack.
Do not publish automatically. Human approval is required.

Create ${input.count} upload-ready Instagram content packs for this topic:
${input.topic}

Tone/style:
${input.tone}

Target niche:
SINK/DINK India: Single Income No Kids / Double Income No Kids, Indian urban audience, family pressure, couple freedom, financial peace, no-kids lifestyle, relationship clarity.

Each pack must be practical, premium, Hinglish-friendly, emotionally sharp, and Instagram-ready.
Approx reel duration target: ${input.durationSec} seconds where relevant.

Return ONLY valid JSON. No markdown.
Use this exact JSON shape:
{
  "organisationBuild": {
    "ceoDecision": "string",
    "departmentsToCreate": ["Research", "Strategy", "Script", "Visual Direction", "Caption", "QA", "Memory"],
    "workflow": ["Research", "Strategy", "Script", "Visual Direction", "Caption/Hashtag", "QA", "Output Pack", "Memory Update"],
    "approvalGate": "Human approval required before posting"
  },
  "contentPacks": [
    {
      "id": 1,
      "title": "string",
      "format": "Reel | Static | Carousel | Story",
      "targetEmotion": "string",
      "hook": "string",
      "scriptOrPostCopy": "string",
      "sceneBySceneVisualDirection": ["string"],
      "onScreenText": ["string"],
      "caption": "string",
      "hashtags": ["string"],
      "cta": "string",
      "thumbnailIdea": "string",
      "qaScoreOutOf10": 9,
      "finalUploadNote": "string",
      "canvaEditorInstructions": "string",
      "memoryNote": "string"
    }
  ],
  "nextCEOActions": ["string"]
}`;
}

async function callGemini(input: {
  prompt: string;
  model: string;
  temperature: number;
}): Promise<{ status: number; payload: GeminiApiResponse; raw: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is missing");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: input.prompt }] }],
      generationConfig: {
        temperature: input.temperature,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = await response.text();
  let payload: GeminiApiResponse = {};
  try {
    payload = JSON.parse(raw) as GeminiApiResponse;
  } catch {
    payload = { error: raw };
  }

  return { status: response.status, payload, raw };
}

async function handleCreate(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as SinkDinkCreateBody;
  const count = toInt(body.count, 5, 1, 20);
  const topic = toText(
    body.topic,
    "SINK DINK India me family pressure, couple freedom aur financial peace",
  );
  const tone = toText(
    body.tone,
    "smart Hinglish, premium, relatable, emotionally sharp, Indian Instagram style",
  );
  const durationSec = toInt(body.durationSec, 25, 10, 90);
  const model = getGeminiModel(body.model);
  const temperature = toNumber(body.temperature, 0.7, 0, 1.5);
  const prompt = buildSinkDinkPrompt({ topic, count, tone, durationSec });

  try {
    const gemini = await callGemini({ prompt, model, temperature });
    const rawText = extractModelText(gemini.payload);
    const parsed = parseJsonFromText(rawText);

    if (gemini.status < 200 || gemini.status >= 300) {
      res.status(502).json({
        ok: false,
        service: "sink-dink-direct-gemini",
        error: "Gemini API returned non-success status",
        httpStatus: gemini.status,
        model,
        details: gemini.payload,
      });
      return;
    }

    res.json({
      ok: true,
      service: "sink-dink-direct-gemini",
      route: req.path,
      geminiCliBypassed: true,
      model,
      request: { topic, count, tone, durationSec, temperature },
      result: parsed ?? { rawText },
      rawText,
      usageMetadata: gemini.payload.usageMetadata ?? null,
      modelVersion: gemini.payload.modelVersion ?? null,
      responseId: gemini.payload.responseId ?? null,
    });
  } catch (err) {
    const error = err as { message?: string; cause?: unknown };
    res.status(500).json({
      ok: false,
      service: "sink-dink-direct-gemini",
      route: req.path,
      geminiCliBypassed: true,
      error: error.message ?? String(err),
      cause: error.cause ?? null,
      hint: "For local Windows proxy networks, start Paperclip with NODE_OPTIONS=--use-env-proxy and HTTP_PROXY/HTTPS_PROXY set.",
    });
  }
}

export function sinkDinkDirectGeminiRoutes(): Router {
  const router = Router();

  router.get("/ai-campaign/status", (_req, res) => {
    res.json({
      ok: true,
      service: "sink-dink-direct-gemini",
      routeMounted: true,
      geminiConfigured: Boolean(getGeminiApiKey()),
      geminiCliBypassed: true,
      model: getGeminiModel(),
      proxyConfigured: envFlag("HTTPS_PROXY") || envFlag("HTTP_PROXY"),
      nodeOptions: process.env.NODE_OPTIONS ?? null,
      humanApprovalRequired: true,
      publishingBlocked: true,
      nextRoutes: [
        "POST /api/sink-dink/ai-campaign/create",
        "POST /api/sink-dink/ceo/start",
      ],
    });
  });

  router.get("/direct-gemini/status", (_req, res) => {
    res.json({
      ok: true,
      service: "sink-dink-direct-gemini",
      geminiConfigured: Boolean(getGeminiApiKey()),
      model: getGeminiModel(),
      proxyConfigured: envFlag("HTTPS_PROXY") || envFlag("HTTP_PROXY"),
      nodeOptions: process.env.NODE_OPTIONS ?? null,
    });
  });

  router.post("/ai-campaign/create", handleCreate);
  router.post("/ceo/start", handleCreate);

  return router;
}
`;

mkdirSync(dirname(routePath), { recursive: true });
writeFileSync(routePath, routeSource, "utf8");

let appSource = readFileSync(appPath, "utf8");
const importLine = `import { sinkDinkDirectGeminiRoutes } from "./routes/sink-dink-direct-gemini.js";`;
if (!appSource.includes(importLine)) {
  const importMarker = `import { COMPANY_IMPORT_API_PATH } from "./routes/company-import-paths.js";`;
  if (!appSource.includes(importMarker)) {
    throw new Error("SINK DINK direct Gemini patch failed: import marker not found");
  }
  appSource = appSource.replace(importMarker, `${importMarker}\n${importLine}`);
}

const mountLine = `  api.use("/sink-dink", sinkDinkDirectGeminiRoutes());`;
if (!appSource.includes(mountLine)) {
  const mountMarker = `  api.use(openApiRoutes());`;
  if (!appSource.includes(mountMarker)) {
    throw new Error("SINK DINK direct Gemini patch failed: route mount marker not found");
  }
  appSource = appSource.replace(mountMarker, `${mountMarker}\n${mountLine}`);
}

writeFileSync(appPath, appSource, "utf8");
console.log("SINK DINK direct Gemini route patch applied.");
