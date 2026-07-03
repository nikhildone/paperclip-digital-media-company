import { Router } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents as agentsTable, heartbeatRuns } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

const DEFAULT_AGENT_NAMES = ["CEO", "Automation Director", "Content Director"];
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TONE = "simple Hinglish, Indian Instagram reel style, emotional but practical, upload-ready, clear sections";
const MAX_OUTPUT_CHARS = 24_000;

type AgentRow = typeof agentsTable.$inferSelect;
type RunRow = typeof heartbeatRuns.$inferSelect;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
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
    "Do not write internal technical notes unless your role is Automation Director; even then keep it short and practical.",
    "Use simple Hinglish for a non-IT Indian creator. Keep output directly usable.",
  ].filter((part): part is string => Boolean(part)).join("\n");
}

async function callGemini(model: string, prompt: string) {
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

function truncate(value: string, max = MAX_OUTPUT_CHARS) {
  return value.length <= max ? value : `${value.slice(0, max)}\n\n[Output truncated]`;
}

function buildBatchOutput(input: {
  batchId: string;
  successfulAgents: number;
  failedAgents: number;
  results: Array<{ agent: AgentRow; run: RunRow; status: "completed" | "failed"; model: string; output?: string; error?: string }>;
}) {
  const lines = [
    `SINK DINK Direct Production Batch: ${input.batchId}`,
    "Status: ok",
    `Successful agents: ${input.successfulAgents}`,
    `Failed agents: ${input.failedAgents}`,
    "",
  ];
  input.results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${result.agent.name} (${result.agent.role})`);
    lines.push(`Status: ${result.status}`);
    lines.push(`Model: ${result.model}`);
    lines.push("Attempts: 1");
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
    const agentLimit = readPositiveInt(body.agentLimit, 3, 9);
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const companyAgents = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.companyId, companyId));

    const orderedAgents = DEFAULT_AGENT_NAMES
      .map((name) => companyAgents.find((agent) => agent.name === name))
      .filter((agent): agent is AgentRow => Boolean(agent))
      .slice(0, agentLimit);

    if (orderedAgents.length === 0) {
      res.status(404).json({ error: "No SINK DINK production agents found" });
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
          },
          resultJson: {
            sinkDinkDirectProduction: true,
            batchId,
            phase: "running",
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

    const results: Array<{ agent: AgentRow; run: RunRow; status: "completed" | "failed"; model: string; output?: string; error?: string }> = [];
    for (let index = 0; index < orderedAgents.length; index++) {
      const agent = orderedAgents[index];
      const run = runRows[index];
      if (!run) continue;
      try {
        const output = await callGemini(model, agentPrompt(agent, { topic, tone, count }));
        const finishedAt = new Date();
        await db
          .update(heartbeatRuns)
          .set({
            status: "succeeded",
            finishedAt,
            exitCode: 0,
            stdoutExcerpt: truncate(output, 8000),
            resultJson: {
              sinkDinkDirectProduction: true,
              batchId,
              phase: "completed",
              agentName: agent.name,
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
        results.push({ agent, run, status: "completed", model, output });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const finishedAt = new Date();
        await db
          .update(heartbeatRuns)
          .set({
            status: "failed",
            finishedAt,
            exitCode: 1,
            error: message,
            errorCode: "sink_dink_direct_production_failed",
            stderrExcerpt: message,
            resultJson: {
              sinkDinkDirectProduction: true,
              batchId,
              phase: "failed",
              agentName: agent.name,
              error: message,
            },
            updatedAt: finishedAt,
          })
          .where(eq(heartbeatRuns.id, run.id));
        await db
          .update(agentsTable)
          .set({ status: "error", errorReason: message, lastHeartbeatAt: finishedAt, updatedAt: finishedAt })
          .where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
        results.push({ agent, run, status: "failed", model, error: message });
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
          status: failedAgents === 0 ? "ok" : "partial",
          successfulAgents,
          failedAgents,
          runIds: runRows.map((run) => run.id),
        },
      },
    });
  });

  return router;
}
