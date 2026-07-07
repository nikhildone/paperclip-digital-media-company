import { Router } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents as agentsTable, heartbeatRuns } from "@paperclipai/db";
import { secretService } from "../services/secrets.js";
import { assertCompanyAccess } from "./authz.js";

const DEFAULT_PROVIDER = "openrouter";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TONE = "simple Hinglish, premium Indian Instagram style, practical, emotionally sharp, non-cringe, upload-ready";
const MAX_VISIBLE_AGENTS = 9;
const MAX_OUTPUT_CHARS = 40_000;
const RETRY_DELAYS = [1500, 3500];
const ROLE_ORDER = ["ceo", "strategy", "research", "content", "creative", "automation", "engineer", "qa", "analytics", "growth", "distribution", "sales", "memory", "report", "general"];
const NAME_ORDER = ["ceo", "strategy director", "research director", "content director", "creative director", "automation director", "qa director", "analytics director", "growth director", "distribution director", "sales director", "memory director", "report director"];
const DEFAULT_SECRET: Record<string, string> = { gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY", groq: "GROQ_API_KEY", deepseek: "DEEPSEEK_API_KEY", openai: "OPENAI_API_KEY" };
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = { gemini: "gemini-2.5-flash", openrouter: "google/gemini-2.5-flash-lite", groq: "llama-3.1-8b-instant", deepseek: "deepseek-chat", openai: "gpt-4o-mini" };

type AgentRow = typeof agentsTable.$inferSelect;
type RunRow = typeof heartbeatRuns.$inferSelect;
type Provider = "gemini" | "openrouter" | "groq" | "deepseek" | "openai";
type Phase = "ceo_plan" | "specialist_work" | "ceo_final";
type Route = { provider: Provider; model: string; secretName: string; secretId?: string | null; envKey: string; temperature?: number | null; maxTokens?: number | null };
type SecretRow = { id: string; name: string; key: string; latestVersion: number };
type Result = { agent: AgentRow; run: RunRow; phase: Phase; status: "completed" | "failed"; provider: Provider; model: string; attempts: number; output?: string; error?: string };

const s = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : null;
const rec = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
const trunc = (v: string, m = MAX_OUTPUT_CHARS) => v.length <= m ? v : `${v.slice(0, m)}\n\n[Output truncated]`;
const errMsg = (e: unknown) => e instanceof Error ? e.message : String(e);
const quota = (e: unknown) => /quota exceeded|rate limit|rate_limit|insufficient_quota|insufficient credits|credit balance|free_tier_requests/i.test(errMsg(e));
const transient = (e: unknown) => !quota(e) && /high demand|try again later|temporar|503|502|504|overloaded|capacity/i.test(errMsg(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function envText(env: Record<string, unknown> | null, key: string) {
  const raw = env?.[key];
  if (typeof raw === "string") return s(raw);
  const r = rec(raw);
  return r ? s(r.value) ?? s(r.plain) ?? s(r.secretId) ?? s(r.secret_id) ?? s(r.name) ?? s(r.key) : null;
}
function provider(v: unknown): Provider | null {
  const p = s(v)?.toLowerCase();
  if (p === "google" || p === "google_gemini") return "gemini";
  return p === "gemini" || p === "openrouter" || p === "groq" || p === "deepseek" || p === "openai" ? p : null;
}
function routeFor(agent: AgentRow, requestModel: string): Route {
  const ac = rec(agent.adapterConfig), rc = rec(agent.runtimeConfig), md = rec(agent.metadata), env = rec(ac?.env);
  const mr = rec(ac?.modelRouter) ?? rec(rc?.modelRouter) ?? rec(md?.modelRouter) ?? null;
  const p = provider(mr?.provider ?? mr?.type ?? envText(env, "SINK_DINK_PROVIDER") ?? envText(env, "MODEL_PROVIDER")) ?? DEFAULT_PROVIDER;
  const defSecret = DEFAULT_SECRET[p];
  return {
    provider: p,
    model: s(mr?.model) ?? s(mr?.modelId) ?? envText(env, "SINK_DINK_MODEL") ?? envText(env, "MODEL_NAME") ?? (p === "gemini" ? requestModel : DEFAULT_MODEL_BY_PROVIDER[p]),
    secretName: s(mr?.apiKeySecret) ?? s(mr?.secret) ?? s(mr?.secretName) ?? envText(env, "SINK_DINK_API_KEY_SECRET") ?? envText(env, "MODEL_API_KEY_SECRET") ?? defSecret,
    secretId: s(mr?.apiKeySecretId) ?? s(mr?.secretId) ?? envText(env, "SINK_DINK_API_KEY_SECRET_ID") ?? envText(env, "MODEL_API_KEY_SECRET_ID"),
    envKey: s(mr?.apiKeyEnv) ?? envText(env, "SINK_DINK_API_KEY_ENV") ?? envText(env, "MODEL_API_KEY_ENV") ?? defSecret,
    temperature: n(mr?.temperature) ?? n(envText(env, "SINK_DINK_TEMPERATURE")),
    maxTokens: n(mr?.maxTokens) ?? n(envText(env, "SINK_DINK_MAX_TOKENS")),
  };
}
function agentSort(a: AgentRow, b: AgentRow) {
  const an = a.name.trim().toLowerCase(), bn = b.name.trim().toLowerCase(), ar = a.role.trim().toLowerCase(), br = b.role.trim().toLowerCase();
  const ans = NAME_ORDER.indexOf(an) >= 0 ? NAME_ORDER.indexOf(an) : 100, bns = NAME_ORDER.indexOf(bn) >= 0 ? NAME_ORDER.indexOf(bn) : 100;
  if (ans !== bns) return ans - bns;
  const ars = ROLE_ORDER.indexOf(ar) >= 0 ? ROLE_ORDER.indexOf(ar) : 100, brs = ROLE_ORDER.indexOf(br) >= 0 ? ROLE_ORDER.indexOf(br) : 100;
  return ars !== brs ? ars - brs : a.name.localeCompare(b.name);
}
function agentCtx(a: AgentRow) { return [`Agent: ${a.name}`, `Role: ${a.role}`, a.title ? `Title: ${a.title}` : null, a.capabilities ? `Capabilities:\n${a.capabilities}` : null].filter(Boolean).join("\n"); }
function planPrompt(ceo: AgentRow, agents: AgentRow[], topic: string, tone: string, count: number) { return `${agentCtx(ceo)}\n\nYou are CEO of SINK DINK India AI Media Organisation inside Paperclip. Coordinate agents like a real media company.\n\nUser task:\n${topic}\n\nTone: ${tone}\nCount: ${count}\n\nAvailable agents:\n${agents.map((a, i) => `${i + 1}. ${a.name} (${a.role})`).join("\n")}\n\nCreate a crisp CEO production plan. Include: campaign angle, target audience truth, exact per-agent assignment, quality checklist, risk guardrails, and final output format. Keep it simple Hinglish and Instagram-first. Do not mention automatic Instagram posting; user uploads manually.`; }
function workPrompt(a: AgentRow, topic: string, tone: string, count: number, plan: string) { return `${agentCtx(a)}\n\nWork under this CEO plan and produce only your specialist output for CEO final merge.\n\nCEO plan:\n${plan}\n\nOriginal task:\n${topic}\n\nTone: ${tone}\nCount: ${count}\n\nReturn concise, role-specific, directly usable work. Avoid generic motivation. Give concrete hooks, scripts, visual directions, QA points, or memory notes according to your role. Use natural Indian Hinglish where useful.`; }
function finalPrompt(ceo: AgentRow, topic: string, tone: string, count: number, plan: string, results: Result[]) { const outs = results.filter(r => r.phase === "specialist_work" && r.status === "completed").map(r => `## ${r.agent.name} (${r.agent.role})\n${trunc(r.output ?? "", 10000)}`).join("\n\n---\n\n"); const fails = results.filter(r => r.status === "failed").map(r => `${r.agent.name}: ${r.error}`).join("\n"); return `${agentCtx(ceo)}\n\nYou are CEO. Merge specialist work into one polished final upload-ready pack for the user. Do not paste raw agent notes. Remove repetition, fix gaps, make it premium, and compensate for failed agents.\n\nOriginal task:\n${topic}\n\nTone: ${tone}\nCount: ${count}\n\nCEO plan:\n${plan}\n\nSpecialist outputs:\n${outs || "No specialist output available."}\n\nFailed agents:\n${fails || "None"}\n\nFINAL OUTPUT RULES:\n- Write in simple premium Hinglish.\n- Make it directly usable by a non-IT creator.\n- No theory, no vague suggestions, no auto-posting claim.\n- For each content pack include exactly these sections:\n  1. Content title\n  2. Format and duration\n  3. Target audience emotion\n  4. Strong hook options\n  5. Full voiceover/script\n  6. Scene-by-scene visual direction with timestamps\n  7. On-screen text line by line\n  8. Caption\n  9. Hashtags\n  10. CTA\n  11. Thumbnail/title idea\n  12. Canva/editor-ready instructions\n  13. QA score out of 10 with reason\n  14. Manual upload note\n  15. Memory note for future improvement\n- End with a short “CEO Recommendation” that tells the user the next practical action.`; }
async function resolveKey(companyId: string, route: Route, svc: ReturnType<typeof secretService>, cache: Map<string, Promise<SecretRow[]>>) {
  const env = process.env[route.envKey]?.trim();
  if (env) return env;
  const rowsP = cache.get(companyId) ?? svc.list(companyId) as Promise<SecretRow[]>;
  cache.set(companyId, rowsP);
  const rows = await rowsP;
  const wanted = [route.secretId, route.secretName, DEFAULT_SECRET[route.provider]].filter((v): v is string => Boolean(v?.trim()));
  const sec = rows.find(r => wanted.includes(r.id) || wanted.includes(r.name) || wanted.includes(r.key));
  if (!sec) throw new Error(`Missing ${route.provider} key. Add Paperclip Secret named/key ${route.secretName}.`);
  try { return await svc.resolveSecretValue(companyId, sec.id, "latest"); }
  catch (e) { const m = errMsg(e); if (/Secret decryption failed|master key|authenticate data/i.test(m)) throw new Error(`${m}\n\nSet stable PAPERCLIP_SECRETS_MASTER_KEY and recreate this Paperclip secret.`); throw e; }
}
async function gemini(route: Route, key: string, prompt: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.model)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: route.temperature ?? 0.7, maxOutputTokens: route.maxTokens ?? 4096 } }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: { message?: string } })?.error?.message ?? `Gemini HTTP ${res.status}`);
  const text = ((data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("\n").trim();
  if (!text) throw new Error("No text returned by Gemini");
  return text;
}
function chatEndpoint(p: Provider) { if (p === "openrouter") return "https://openrouter.ai/api/v1/chat/completions"; if (p === "groq") return "https://api.groq.com/openai/v1/chat/completions"; if (p === "deepseek") return "https://api.deepseek.com/chat/completions"; if (p === "openai") return "https://api.openai.com/v1/chat/completions"; throw new Error(`Unsupported provider ${p}`); }
async function chat(route: Route, key: string, prompt: string) {
  const res = await fetch(chatEndpoint(route.provider), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(route.provider === "openrouter" ? { "HTTP-Referer": "https://nikhil123789-paperclip-ai-company.hf.space", "X-Title": "Paperclip SINK DINK" } : {}) }, body: JSON.stringify({ model: route.model, messages: [{ role: "system", content: "You are a specialist AI media organisation agent. Return directly usable output only." }, { role: "user", content: prompt }], temperature: route.temperature ?? 0.7, max_tokens: route.maxTokens ?? 4096 }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: { message?: string } })?.error?.message ?? `${route.provider} HTTP ${res.status}`);
  const text = (data as { choices?: Array<{ message?: { content?: string }, text?: string }> }).choices?.[0]?.message?.content ?? (data as { choices?: Array<{ text?: string }> }).choices?.[0]?.text ?? "";
  if (!text.trim()) throw new Error("No text returned by model");
  return text.trim();
}
async function modelCall(route: Route, key: string, prompt: string) {
  let attempts = 0, last: unknown = null;
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    attempts++;
    try { return { text: route.provider === "gemini" ? await gemini(route, key, prompt) : await chat(route, key, prompt), provider: route.provider, model: route.model, attempts }; }
    catch (e) { last = e; if (quota(e) || !transient(e)) throw e; const d = RETRY_DELAYS[i]; if (d !== undefined) await sleep(d); }
  }
  throw last instanceof Error ? last : new Error(String(last ?? "Model failed"));
}
async function runRow(db: Db, companyId: string, agent: AgentRow, batchId: string, topic: string, route: Route, phase: Phase, prompt: string, svc: ReturnType<typeof secretService>, cache: Map<string, Promise<SecretRow[]>>) {
  const now = new Date();
  const run = (await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, invocationSource: "on_demand", triggerDetail: "system", status: "running", startedAt: now, processStartedAt: now, lastOutputAt: now, lastOutputStream: "stdout", stdoutExcerpt: `SINK DINK ${phase} started...`, externalRunId: batchId, contextSnapshot: { sinkDinkDirectProduction: true, paperclipCeoOrchestration: true, batchId, topic, phase, provider: route.provider, model: route.model }, resultJson: { sinkDinkDirectProduction: true, paperclipCeoOrchestration: true, batchId, phase, provider: route.provider, model: route.model } }).returning())[0]!;
  await db.update(agentsTable).set({ status: "running", errorReason: null, lastHeartbeatAt: now, updatedAt: now }).where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
  try {
    const out = await modelCall(route, await resolveKey(companyId, route, svc, cache), prompt);
    const end = new Date();
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: end, exitCode: 0, stdoutExcerpt: trunc(out.text, 8000), resultJson: { sinkDinkDirectProduction: true, paperclipCeoOrchestration: true, phase, provider: out.provider, model: out.model, attempts: out.attempts }, updatedAt: end, lastOutputAt: end, lastOutputStream: "stdout" }).where(eq(heartbeatRuns.id, run.id));
    await db.update(agentsTable).set({ status: "idle", errorReason: null, lastHeartbeatAt: end, updatedAt: end }).where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
    return { agent, run, phase, status: "completed" as const, provider: out.provider, model: out.model, attempts: out.attempts, output: out.text };
  } catch (e) {
    const end = new Date(), m = errMsg(e), recoverable = quota(e) || transient(e);
    await db.update(heartbeatRuns).set({ status: "failed", finishedAt: end, exitCode: 1, error: m, errorCode: quota(e) ? "model_quota_or_rate_limit" : recoverable ? "model_transient_capacity" : "sink_dink_direct_production_failed", stderrExcerpt: m, resultJson: { sinkDinkDirectProduction: true, paperclipCeoOrchestration: true, phase, error: m, provider: route.provider, model: route.model }, updatedAt: end }).where(eq(heartbeatRuns.id, run.id));
    await db.update(agentsTable).set({ status: recoverable ? "idle" : "error", errorReason: recoverable ? null : m, lastHeartbeatAt: end, updatedAt: end }).where(and(eq(agentsTable.id, agent.id), eq(agentsTable.companyId, companyId)));
    return { agent, run, phase, status: "failed" as const, provider: route.provider, model: route.model, attempts: quota(e) ? 1 : RETRY_DELAYS.length + 1, error: m };
  }
}
function output(batchId: string, results: Result[], final?: string | null) { const ok = results.filter(r => r.status === "completed").length, fail = results.length - ok; return trunc([`SINK DINK CEO-Orchestrated Production Batch: ${batchId}`, `Status: ${fail === 0 ? "ok" : ok > 0 ? "partial" : "failed"}`, `Successful phases: ${ok}`, `Failed phases: ${fail}`, "", final ? `# CEO Final Upload-Ready Output\n\n${final}\n\n---\n` : "", "# Agent Work Log", ...results.map((r, i) => `\n## ${i + 1}. ${r.agent.name} (${r.agent.role})\nPhase: ${r.phase}\nStatus: ${r.status}\nProvider: ${r.provider}\nModel: ${r.model}\nAttempts: ${r.attempts}\nRun ID: ${r.run.id}\n\n${r.status === "completed" ? trunc(r.output ?? "", 10000) : `Error: ${r.error}`}\n---`)].join("\n")); }
export function sinkDinkProductionRoutes(db: Db) {
  const router = Router();
  const svc = secretService(db);
  const cache = new Map<string, Promise<SecretRow[]>>();
  router.post("/companies/:companyId/sink-dink/production/start", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const topic = s(body.topic) ?? "Create upload-ready Instagram content for Indian SINK DINK couples.";
    const tone = s(body.tone) ?? DEFAULT_TONE;
    const requestModel = s(body.model) ?? DEFAULT_MODEL;
    const count = Math.min(10, Math.max(1, Math.floor(Number(body.count) || 3)));
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const agents = (await db.select().from(agentsTable).where(eq(agentsTable.companyId, companyId))).filter(a => !["paused", "archived"].includes(a.status.trim().toLowerCase())).sort(agentSort).slice(0, MAX_VISIBLE_AGENTS);
    if (agents.length === 0) return res.status(404).json({ error: "No runnable SINK DINK production agents found" });
    const ceo = agents.find(a => a.role.trim().toLowerCase() === "ceo" || a.name.trim().toLowerCase() === "ceo") ?? agents[0]!;
    const rest = agents.filter(a => a.id !== ceo.id);
    const results: Result[] = [];
    const ceoRoute = routeFor(ceo, requestModel);
    const plan = await runRow(db, companyId, ceo, batchId, topic, ceoRoute, "ceo_plan", planPrompt(ceo, agents, topic, tone, count), svc, cache); results.push(plan);
    const planText = plan.status === "completed" ? plan.output ?? "" : "CEO plan failed. Use original task and role judgement.";
    for (const agent of rest) results.push(await runRow(db, companyId, agent, batchId, topic, routeFor(agent, requestModel), "specialist_work", workPrompt(agent, topic, tone, count, planText), svc, cache));
    const final = await runRow(db, companyId, ceo, batchId, topic, ceoRoute, "ceo_final", finalPrompt(ceo, topic, tone, count, planText, results), svc, cache); results.push(final);
    const stdoutExcerpt = output(batchId, results, final.status === "completed" ? final.output ?? null : null);
    const ok = results.filter(r => r.status === "completed").length, fail = results.length - ok;
    res.json({ id: final.run.id, status: ok > 0 ? "succeeded" : "failed", externalRunId: batchId, stdoutExcerpt, resultJson: { sinkDinkDirectProduction: true, paperclipCeoOrchestration: true, responsePayload: { status: fail === 0 ? "ok" : ok > 0 ? "partial" : "failed", successfulAgents: ok, failedAgents: fail, visibleAgentCount: agents.length, runIds: results.map(r => r.run.id), finalRunId: final.run.id } } });
  });
  return router;
}
