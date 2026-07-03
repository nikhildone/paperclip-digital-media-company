import { Router } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents as agentsTable, heartbeatRuns } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TONE = "simple Hinglish, Indian Instagram reel style, emotional but practical, upload-ready, clear sections";
const MAX_OUTPUT_CHARS = 24_000;
const MAX_VISIBLE_AGENTS = 9;
const TRANSIENT_RETRY_DELAYS_MS = [1_500, 3_500];
const PRIORITY_ROLE_ORDER = ["ceo", "strategy", "research", "content", "creative", "automation", "engineer", "qa", "analytics", "growth", "distribution", "sales", "memory", "report", "general"];
const PRIORITY_NAME_ORDER = ["ceo", "strategy director", "research director", "content director", "creative director", "automation director", "qa director", "analytics director", "growth director", "distribution director", "sales director", "memory director", "report director"];

type AgentRow = typeof agentsTable.$inferSelect;
type RunRow = typeof heartbeatRuns.$inferSelect;
type GeminiRunResult = { text: string; model: string; attempts: number };

type AgentProductionResult = {
  agent: AgentRow;
  run: RunRow;
  status: "completed" | "failed";
  model: string;
  attempts: number;
  output?: string;
  error?: string;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
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

function geminiApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.PAPERCLIP_GEMINI_API_KEY ||
    ""
  ).trim();
}

function geminiText(data: unknown): string {
  const root = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    error?: { message?: unknown };
  };
  const parts = root.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  if (text) return text;
  const errorMessage = typeof root.error?.message === "string" ? root.error.message : "No text returned by Gemini";
  throw new Error(errorMessage);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isGeminiQuotaExceededError(error: unknown) {
  const message = errorMessage(error);
  return /quota exceeded|current quota|free_tier_requests|billing details|rate-limits|rate limit/i.test(message);
}

function isTransientGeminiDemandError(error: unknown) {
  if (isGeminiQuotaExceededError(error)) return false;
  const message = errorMessage(error);
  return /high demand|try again later|temporar|503|overloaded/i.test(message);
}

function isRecoverableModelCapacityError(error: unknown) {
  return isGeminiQuotaExceededError(error) || isTransientGeminiDemandError(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function candidateModels(requestedModel: string) {
  return Array.from(new Set([requestedModel, DEFAULT_MODEL]));
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

async function callGeminiOnce(model: string, prompt: string) {
  const key = geminiApiKey();
  if (!key) throw new Error("Missing Gemini API key secret");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: { message?: string } })?.error?.message ?? `Gemini HTTP ${response.status}`;
    throw new Error(message);
  }
  return geminiText(data);
}

async function callGemini(requestedModel: string, prompt: string): Promise<GeminiRunResult> {
  let attempts = 0;
  let lastError: unknown = null;
  for (const model of candidateModels(requestedModel)) {
    for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
      attempts += 1;
      try {
        const text = await callGeminiOnce(model, prompt);
        return { text, model, attempts };
      } catch (error) {
        lastError = error;
        if (isGeminiQuotaExceededError(error)) throw error;
        if (!isTransientGeminiDemandError(error)) throw error;
        const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) await sleep(delay);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Gemini request failed"));
}

function truncate(value: string, max = MAX_OUTPUT_CHARS) {
  return value.length <= max ? value : `${value.slice(0, max)}\n\n[Output truncated]`;
}

function buildBatchOutput(input: {
  batchId: string;
  successfulAgents: number;
  failedAgents: number;
  results: AgentProductionResult[];
}) {
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
    lines.push(`Model: ${result.model}`);
    lines.push(`Attempts: ${result.attempts}`);
    lines.push(`Run ID: ${result.run.id}`);
    lines.push("");
    if (result.status === "completed") {
      lines.push(result.output ?? "");
    } else {
      lines.push(`Error: ${result.error ?? "Unknown error"}`);
    }
    lines.push("", "---", "");
  });
  return truncate(lines.join("\n"));
}

export function sinkDinkProductionRoutes(db: Db) {
  const router = Router();

  router.post("/companies/:companyId/sink-dink/production/start", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const topic = readString(body.topic) ?? "Create upload-ready Instagram content for Indian SINK DINK couples.";
    const tone = readString(body.tone) ?? DEFAULT_TONE;
    const model = readString(body.model) ?? DEFAULT_MODEL;
    const count = readPositiveInt(body.count, 3, 10);
    const agentLimit = MAX_VISIBLE_AGENTS;
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const companyAgents = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.companyId, companyId));

    const orderedAgents = companyAgents
      .filter(isRunnableAgent)
      .sort(sortAgentsForSinkDinkProduction)
      .slice(0, agentLimit);

    if (orderedAgents.length === 0) {
      res.status(404).json({ error: "No runnable SINK DINK production agents found" });
      return;
    }

    const now = new Date();
    const runRows: RunRow[] = [];
    for (const agent of orderedAgents) {
      const inserted = await db
        .insert(heartbeatRuns)
        .values({
          companyId,
          agentId: agent.id,
          invocationSource: "on_demand",
          triggerDetail: "system",
          status: "running",
          startedAt: now,
          processStartedAt: now,
          lastOutputAt: now,
          lastOutputStream: "stdout",
          stdoutExcerpt: "SINK DINK direct production started...",
          externalRunId: batchId,
          contextSnapshot: {
            sinkDinkDirectProduction: true,
            batchId,
            topic,
            source: "assign_task_direct_production",
            visibleAgentCount: orderedAgents.length,
          },
          resultJson: {
            sinkDinkDirectProduction: true,
            batchId,
            phase: "running",
            visibleAgentCount: orderedAgents.length,
          },
        })
        .returning();
      const run = inserted[0];
      if (run) runRows.push(run);
      await db
        .update(agentsTable)
        .set({ status: "running", errorReason: null, lastHeartbeatAt: now, updatedAt: now })
        .where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
    }

    const results: AgentProductionResult[] = [];
    for (let index = 0; index < orderedAgents.length; index++) {
      const agent = orderedAgents[index];
      const run = runRows[index];
      if (!run) continue;
      try {
        const gemini = await callGemini(model, agentPrompt(agent, { topic, tone, count }));
        const finishedAt = new Date();
        await db
          .update(heartbeatRuns)
          .set({
            status: "succeeded",
            finishedAt,
            exitCode: 0,
            stdoutExcerpt: truncate(gemini.text, 8000),
            resultJson: {
              sinkDinkDirectProduction: true,
              batchId,
              phase: "completed",
              agentName: agent.name,
              visibleAgentCount: orderedAgents.length,
              model: gemini.model,
              attempts: gemini.attempts,
            },
            updatedAt: finishedAt,
            lastOutputAt: finishedAt,
            lastOutputStream: "stdout",
          })
          .where(eq(heartbeatRuns.id, run.id));
        await db
          .update(agentsTable)
          .set({ status: "idle", errorReason: null, lastHeartbeatAt: finishedAt, updatedAt: finishedAt })
          .where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
        results.push({ agent, run, status: "completed", model: gemini.model, attempts: gemini.attempts, output: gemini.text });
      } catch (error) {
        const message = errorMessage(error);
        const quotaExceeded = isGeminiQuotaExceededError(error);
        const recoverable = isRecoverableModelCapacityError(error);
        const finishedAt = new Date();
        await db
          .update(heartbeatRuns)
          .set({
            status: "failed",
            finishedAt,
            exitCode: 1,
            error: message,
            errorCode: quotaExceeded ? "gemini_quota_exceeded" : recoverable ? "gemini_transient_demand" : "sink_dink_direct_production_failed",
            stderrExcerpt: message,
            resultJson: {
              sinkDinkDirectProduction: true,
              batchId,
              phase: "failed",
              agentName: agent.name,
              error: message,
              quotaExceeded,
              recoverable,
              visibleAgentCount: orderedAgents.length,
            },
            updatedAt: finishedAt,
          })
          .where(eq(heartbeatRuns.id, run.id));
        await db
          .update(agentsTable)
          .set({
            status: recoverable ? "idle" : "error",
            errorReason: recoverable ? null : message,
            lastHeartbeatAt: finishedAt,
            updatedAt: finishedAt,
          })
          .where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
        results.push({ agent, run, status: "failed", model, attempts: quotaExceeded ? 1 : candidateModels(model).length * (TRANSIENT_RETRY_DELAYS_MS.length + 1), error: message });
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
      resultJson: {
        sinkDinkDirectProduction: true,
        responsePayload: {
          status: failedAgents === 0 ? "ok" : successfulAgents > 0 ? "partial" : "failed",
          successfulAgents,
          failedAgents,
          visibleAgentCount: orderedAgents.length,
          runIds: runRows.map((run) => run.id),
        },
      },
    });
  });

  return router;
}
