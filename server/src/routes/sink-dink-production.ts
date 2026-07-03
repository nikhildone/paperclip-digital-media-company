import { Router } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents as agentsTable, heartbeatRuns } from "@paperclipai/db";
import { secretService } from "../services/secrets.js";
import { assertCompanyAccess } from "./authz.js";

const DEFAULT_PROVIDER = "gemini";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TONE = "simple Hinglish, Indian Instagram reel style, emotional but practical, upload-ready, clear sections";
const MAX_OUTPUT_CHARS = 24_000;
const MAX_VISIBLE_AGENTS = 9;
const TRANSIENT_RETRY_DELAYS_MS = [1_500, 3_500];
const PRIORITY_ROLE_ORDER = ["ceo", "strategy", "research", "content", "creative", "automation", "engineer", "qa", "analytics", "growth", "distribution", "sales", "memory", "report", "general"];
const PRIORITY_NAME_ORDER = ["ceo", "strategy director", "research director", "content director", "creative director", "automation director", "qa director", "analytics director", "growth director", "distribution director", "sales director", "memory director", "report director"];

const PROVIDER_DEFAULT_SECRET: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
};

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  gemini: "gemini-2.5-flash",
  openrouter: "google/gemini-2.5-flash-lite",
  groq: "llama-3.1-8b-instant",
  deepseek: "deepseek-chat",
  openai: "gpt-4o-mini",
};

type AgentRow = typeof agentsTable.$inferSelect;
type RunRow = typeof heartbeatRuns.$inferSelect;
type Provider = "gemini" | "openrouter" | "groq" | "deepseek" | "openai";

type ModelRoute = {
  provider: Provider;
  model: string;
  secretName: string;
  secretId?: string | null;
  envKey: string;
  temperature?: number | null;
  maxTokens?: number | null;
};

type ModelRunResult = { text: string; provider: Provider; model: string; attempts: number };

type AgentProductionResult = {
  agent: AgentRow;
  run: RunRow;
  status: "completed" | "failed";
  provider: Provider;
  model: string;
  attempts: number;
  output?: string;
  error?: string;
};

type SecretListRow = { id: string; name: string; key: string; latestVersion: number };

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function readPositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeProvider(value: unknown): Provider | null {
  const provider = readString(value)?.toLowerCase();
  if (provider === "google" || provider === "google_gemini") return "gemini";
  if (provider === "gemini" || provider === "openrouter" || provider === "groq" || provider === "deepseek" || provider === "openai") return provider;
  return null;
}

function sortAgentsForSinkDinkProduction(left: AgentRow, right: AgentRow) {
  const leftName = left.name.trim().toLowerCase();
  const rightName = right.name.trim().toLowerCase();
  const leftRole = left.role.trim().toLowerCase();
  const rightRole = right.role.trim().toLowerCase();
  const leftNameIndex = PRIORITY_NAME_ORDER.indexOf(leftName);
  const rightNameIndex = PRIORITY_NAME_ORDER.indexOf(rightName);
  const leftNameScore = leftNameIndex >= 0 ? leftNameIndex : 100;
  const rightNameScore = rightNameIndex >= 0 ? rightNameIndex : 100;
  if (leftNameScore !== rightNameScore) return leftNameScore - rightNameScore;
  const leftRoleIndex = PRIORITY_ROLE_ORDER.indexOf(leftRole);
  const rightRoleIndex = PRIORITY_ROLE_ORDER.indexOf(rightRole);
  const leftRoleScore = leftRoleIndex >= 0 ? leftRoleIndex : 100;
  const rightRoleScore = rightRoleIndex >= 0 ? rightRoleIndex : 100;
  if (leftRoleScore !== rightRoleScore) return leftRoleScore - rightRoleScore;
  return left.name.localeCompare(right.name);
}

function isRunnableAgent(agent: AgentRow) {
  const status = agent.status.trim().toLowerCase();
  return status !== "paused" && status !== "archived";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isQuotaOrRateLimitError(error: unknown) {
  const message = errorMessage(error);
  return /quota exceeded|current quota|free_tier_requests|billing details|rate-limits|rate limit|rate_limit|insufficient_quota|insufficient credits|credit balance/i.test(message);
}

function isTransientCapacityError(error: unknown) {
  if (isQuotaOrRateLimitError(error)) return false;
  const message = errorMessage(error);
  return /high demand|try again later|temporar|503|502|504|overloaded|capacity/i.test(message);
}

function isRecoverableModelCapacityError(error: unknown) {
  return isQuotaOrRateLimitError(error) || isTransientCapacityError(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function agentPrompt(agent: AgentRow, input: { topic: string; tone: string; count: number }) {
  return [
    `You are ${agent.name}, role: ${agent.role}.`,
    agent.title ? `Title: ${agent.title}` : null,
    agent.capabilities ? `Capabilities: ${agent.capabilities}` : null,
    "",
    "Project: SINK DINK India AI Media Organisation.",
    "Task:",
    input.topic,
    "",
    `Tone: ${input.tone}`,
    `Create ${input.count} concise, upload-ready Instagram reel/post content pack(s).`,
    "Work only from your role perspective. Keep output useful for the CEO final production pack.",
    "Use simple Hinglish for a non-IT Indian creator. Keep output directly usable.",
  ].filter((part): part is string => Boolean(part)).join("\n");
}

function readAgentModelRoute(agent: AgentRow, bodyModel: string): ModelRoute {
  const adapterConfig = asRecord(agent.adapterConfig);
  const runtimeConfig = asRecord(agent.runtimeConfig);
  const metadata = asRecord(agent.metadata);
  const routerConfig = asRecord(adapterConfig?.modelRouter) ?? asRecord(runtimeConfig?.modelRouter) ?? asRecord(metadata?.modelRouter) ?? null;
  const provider = normalizeProvider(routerConfig?.provider) ?? normalizeProvider(routerConfig?.type) ?? DEFAULT_PROVIDER;
  const model = readString(routerConfig?.model) ?? readString(routerConfig?.modelId) ?? (provider === DEFAULT_PROVIDER ? bodyModel : PROVIDER_DEFAULT_MODEL[provider]);
  const defaultSecret = PROVIDER_DEFAULT_SECRET[provider];
  return {
    provider,
    model,
    secretName: readString(routerConfig?.apiKeySecret) ?? readString(routerConfig?.secret) ?? readString(routerConfig?.secretName) ?? defaultSecret,
    secretId: readString(routerConfig?.apiKeySecretId) ?? readString(routerConfig?.secretId),
    envKey: readString(routerConfig?.apiKeyEnv) ?? defaultSecret,
    temperature: readNumber(routerConfig?.temperature),
    maxTokens: readNumber(routerConfig?.maxTokens),
  };
}

async function resolveModelKey(input: {
  companyId: string;
  route: ModelRoute;
  secretsSvc: ReturnType<typeof secretService>;
  secretCache: Map<string, Promise<SecretListRow[]>>;
}) {
  const directEnv = process.env[input.route.envKey]?.trim();
  if (directEnv) return directEnv;

  const secretRowsPromise = input.secretCache.get(input.companyId) ?? input.secretsSvc.list(input.companyId) as Promise<SecretListRow[]>;
  input.secretCache.set(input.companyId, secretRowsPromise);
  const secretRows = await secretRowsPromise;
  const wanted = [input.route.secretId, input.route.secretName, PROVIDER_DEFAULT_SECRET[input.route.provider]].filter((value): value is string => Boolean(value?.trim()));
  const secret = secretRows.find((row) => wanted.includes(row.id) || wanted.includes(row.name) || wanted.includes(row.key));
  if (!secret) throw new Error(`Missing ${input.route.provider} key. Add Paperclip Secret named/key ${input.route.secretName}.`);
  return input.secretsSvc.resolveSecretValue(input.companyId, secret.id, "latest");
}

function geminiText(data: unknown): string {
  const root = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>; error?: { message?: unknown } };
  const parts = root.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n").trim();
  if (text) return text;
  const message = typeof root.error?.message === "string" ? root.error.message : "No text returned by Gemini";
  throw new Error(message);
}

function chatText(data: unknown): string {
  const root = data as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }>; error?: { message?: unknown } };
  const content = root.choices?.[0]?.message?.content ?? root.choices?.[0]?.text;
  if (typeof content === "string" && content.trim()) return content.trim();
  const message = typeof root.error?.message === "string" ? root.error.message : "No text returned by model";
  throw new Error(message);
}

async function callGeminiOnce(route: ModelRoute, key: string, prompt: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.model)}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: route.temperature ?? 0.7, maxOutputTokens: route.maxTokens ?? 4096 },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: { message?: string } })?.error?.message ?? `Gemini HTTP ${response.status}`);
  return geminiText(data);
}

function chatEndpoint(provider: Provider) {
  if (provider === "openrouter") return "https://openrouter.ai/api/v1/chat/completions";
  if (provider === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  if (provider === "deepseek") return "https://api.deepseek.com/chat/completions";
  if (provider === "openai") return "https://api.openai.com/v1/chat/completions";
  throw new Error(`Unsupported chat provider: ${provider}`);
}

async function callChatOnce(route: ModelRoute, key: string, prompt: string) {
  const response = await fetch(chatEndpoint(route.provider), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...(route.provider === "openrouter" ? { "HTTP-Referer": "https://paperclip-ai-company.hf.space", "X-Title": "Paperclip SINK DINK" } : {}),
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        { role: "system", content: "You are a specialist AI media organisation agent. Return directly usable output only." },
        { role: "user", content: prompt },
      ],
      temperature: route.temperature ?? 0.7,
      max_tokens: route.maxTokens ?? 4096,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: { message?: string } })?.error?.message ?? `${route.provider} HTTP ${response.status}`);
  return chatText(data);
}

async function callModel(input: { route: ModelRoute; key: string; prompt: string }): Promise<ModelRunResult> {
  let attempts = 0;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
    attempts += 1;
    try {
      const text = input.route.provider === "gemini"
        ? await callGeminiOnce(input.route, input.key, input.prompt)
        : await callChatOnce(input.route, input.key, input.prompt);
      return { text, provider: input.route.provider, model: input.route.model, attempts };
    } catch (error) {
      lastError = error;
      if (isQuotaOrRateLimitError(error)) throw error;
      if (!isTransientCapacityError(error)) throw error;
      const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Model request failed"));
}

function truncate(value: string, max = MAX_OUTPUT_CHARS) {
  return value.length <= max ? value : `${value.slice(0, max)}\n\n[Output truncated]`;
}

function buildBatchOutput(input: { batchId: string; successfulAgents: number; failedAgents: number; results: AgentProductionResult[] }) {
  const lines = [
    `SINK DINK Direct Production Batch: ${input.batchId}`,
    `Status: ${input.failedAgents === 0 ? "ok" : input.successfulAgents > 0 ? "partial" : "failed"}`,
    `Successful agents: ${input.successfulAgents}`,
    `Failed agents: ${input.failedAgents}`,
    "",
  ];
  input.results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${result.agent.name} (${result.agent.role})`);
    lines.push(`Status: ${result.status}`);
    lines.push(`Provider: ${result.provider}`);
    lines.push(`Model: ${result.model}`);
    lines.push(`Attempts: ${result.attempts}`);
    lines.push(`Run ID: ${result.run.id}`);
    lines.push("");
    lines.push(result.status === "completed" ? result.output ?? "" : `Error: ${result.error ?? "Unknown error"}`);
    lines.push("", "---", "");
  });
  return truncate(lines.join("\n"));
}

export function sinkDinkProductionRoutes(db: Db) {
  const router = Router();
  const secretsSvc = secretService(db);
  const secretCache = new Map<string, Promise<SecretListRow[]>>();

  router.post("/companies/:companyId/sink-dink/production/start", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const topic = readString(body.topic) ?? "Create upload-ready Instagram content for Indian SINK DINK couples.";
    const tone = readString(body.tone) ?? DEFAULT_TONE;
    const model = readString(body.model) ?? DEFAULT_MODEL;
    const count = readPositiveInt(body.count, 3, 10);
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const companyAgents = await db.select().from(agentsTable).where(eq(agentsTable.companyId, companyId));
    const orderedAgents = companyAgents.filter(isRunnableAgent).sort(sortAgentsForSinkDinkProduction).slice(0, MAX_VISIBLE_AGENTS);
    if (orderedAgents.length === 0) {
      res.status(404).json({ error: "No runnable SINK DINK production agents found" });
      return;
    }

    const now = new Date();
    const runRows: RunRow[] = [];
    for (const agent of orderedAgents) {
      const route = readAgentModelRoute(agent, model);
      const inserted = await db.insert(heartbeatRuns).values({
        companyId,
        agentId: agent.id,
        invocationSource: "on_demand",
        triggerDetail: "system",
        status: "running",
        startedAt: now,
        processStartedAt: now,
        lastOutputAt: now,
        lastOutputStream: "stdout",
        stdoutExcerpt: "SINK DINK multi-model production started...",
        externalRunId: batchId,
        contextSnapshot: { sinkDinkDirectProduction: true, multiModelRouter: true, batchId, topic, source: "assign_task_direct_production", visibleAgentCount: orderedAgents.length, provider: route.provider, model: route.model },
        resultJson: { sinkDinkDirectProduction: true, multiModelRouter: true, batchId, phase: "running", visibleAgentCount: orderedAgents.length, provider: route.provider, model: route.model },
      }).returning();
      const run = inserted[0];
      if (run) runRows.push(run);
      await db.update(agentsTable).set({ status: "running", errorReason: null, lastHeartbeatAt: now, updatedAt: now }).where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
    }

    const results: AgentProductionResult[] = [];
    for (let index = 0; index < orderedAgents.length; index++) {
      const agent = orderedAgents[index];
      const run = runRows[index];
      if (!run) continue;
      const route = readAgentModelRoute(agent, model);
      try {
        const key = await resolveModelKey({ companyId, route, secretsSvc, secretCache });
        const output = await callModel({ route, key, prompt: agentPrompt(agent, { topic, tone, count }) });
        const finishedAt = new Date();
        await db.update(heartbeatRuns).set({
          status: "succeeded",
          finishedAt,
          exitCode: 0,
          stdoutExcerpt: truncate(output.text, 8000),
          resultJson: { sinkDinkDirectProduction: true, multiModelRouter: true, batchId, phase: "completed", agentName: agent.name, visibleAgentCount: orderedAgents.length, provider: output.provider, model: output.model, attempts: output.attempts },
          updatedAt: finishedAt,
          lastOutputAt: finishedAt,
          lastOutputStream: "stdout",
        }).where(eq(heartbeatRuns.id, run.id));
        await db.update(agentsTable).set({ status: "idle", errorReason: null, lastHeartbeatAt: finishedAt, updatedAt: finishedAt }).where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
        results.push({ agent, run, status: "completed", provider: output.provider, model: output.model, attempts: output.attempts, output: output.text });
      } catch (error) {
        const message = errorMessage(error);
        const quotaExceeded = isQuotaOrRateLimitError(error);
        const recoverable = isRecoverableModelCapacityError(error);
        const finishedAt = new Date();
        await db.update(heartbeatRuns).set({
          status: "failed",
          finishedAt,
          exitCode: 1,
          error: message,
          errorCode: quotaExceeded ? "model_quota_or_rate_limit" : recoverable ? "model_transient_capacity" : "sink_dink_direct_production_failed",
          stderrExcerpt: message,
          resultJson: { sinkDinkDirectProduction: true, multiModelRouter: true, batchId, phase: "failed", agentName: agent.name, error: message, quotaExceeded, recoverable, visibleAgentCount: orderedAgents.length, provider: route.provider, model: route.model },
          updatedAt: finishedAt,
        }).where(eq(heartbeatRuns.id, run.id));
        await db.update(agentsTable).set({ status: recoverable ? "idle" : "error", errorReason: recoverable ? null : message, lastHeartbeatAt: finishedAt, updatedAt: finishedAt }).where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
        results.push({ agent, run, status: "failed", provider: route.provider, model: route.model, attempts: quotaExceeded ? 1 : TRANSIENT_RETRY_DELAYS_MS.length + 1, error: message });
      }
    }

    const successfulAgents = results.filter((result) => result.status === "completed").length;
    const failedAgents = results.filter((result) => result.status === "failed").length;
    const stdoutExcerpt = buildBatchOutput({ batchId, successfulAgents, failedAgents, results });
    const primaryRun = runRows[0] ?? null;
    res.json({
      id: primaryRun?.id ?? batchId,
      status: failedAgents === 0 ? "succeeded" : successfulAgents > 0 ? "succeeded" : "failed",
      externalRunId: batchId,
      stdoutExcerpt,
      resultJson: { sinkDinkDirectProduction: true, multiModelRouter: true, responsePayload: { status: failedAgents === 0 ? "ok" : successfulAgents > 0 ? "partial" : "failed", successfulAgents, failedAgents, visibleAgentCount: orderedAgents.length, runIds: runRows.map((run) => run.id) } },
    });
  });

  return router;
}
