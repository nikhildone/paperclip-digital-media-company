import { Router } from "express";

const ACTIONS: Record<string, { approval_status: string; status: string }> = {
  approve: { approval_status: "approved", status: "approved_human_review" },
  reject: { approval_status: "rejected", status: "rejected_human_review" },
  mark_uploaded: { approval_status: "uploaded_manual", status: "uploaded_manual" },
};

function base(raw: string | undefined) { const v = raw?.trim(); return v ? v.replace(/\/+$/, "") : null; }
function cfg() { return { url: base(process.env.SUPABASE_URL), key: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? null }; }
function headers(key: string, prefer?: string) { return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }; }
function str(v: unknown) { return typeof v === "string" && v.trim() ? v.trim() : null; }
function rec(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
function arr(v: unknown): Array<Record<string, unknown>> { return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : []; }
function esc(v: unknown) { return String(v ?? "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[c] ?? c)); }
function safeJobId(v: unknown) { const id = str(v); return id && /^[A-Za-z0-9._:-]{6,96}$/.test(id) ? id : null; }
function fileUrl(files: Array<Record<string, unknown>>, name: string) { const f = files.find((x) => JSON.stringify(x).toLowerCase().includes(name)); return str(f?.absoluteUrl) ?? str(f?.url); }

async function readJobs(limit: number) {
  const { url, key } = cfg();
  if (!url || !key) throw new Error("Supabase is not configured.");
  const r = await fetch(`${url}/rest/v1/sink_dink_jobs?select=*&order=created_at.desc&limit=${limit}`, { headers: headers(key) });
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  return JSON.parse(t) as Array<Record<string, unknown>>;
}

async function updateJob(jobId: string, action: string) {
  const selected = ACTIONS[action];
  if (!selected) throw new Error("Invalid action.");
  const { url, key } = cfg();
  if (!url || !key) throw new Error("Supabase is not configured.");
  const update = await fetch(`${url}/rest/v1/sink_dink_jobs?job_id=eq.${encodeURIComponent(jobId)}`, { method: "PATCH", headers: headers(key, "return=representation"), body: JSON.stringify(selected) });
  const updateText = await update.text();
  if (!update.ok) throw new Error(updateText);
  await fetch(`${url}/rest/v1/sink_dink_audit_log`, { method: "POST", headers: headers(key), body: JSON.stringify({ event_type: "artifact_human_review_action", payload: { jobId, action, ...selected, publishingBlocked: true, autoPublished: false, at: new Date().toISOString() }, created_at: new Date().toISOString() }) });
  return updateText ? JSON.parse(updateText) : [];
}

type Item = ReturnType<typeof mapJob>;
function mapJob(row: Record<string, unknown>) {
  const files = arr(row.files); const qa = rec(row.qa);
  return { jobId: str(row.job_id) ?? str(row.jobId), topic: str(row.topic) ?? "SINK/DINK artifact", status: str(row.status) ?? "unknown", approvalStatus: str(row.approval_status) ?? "pending_human_approval", qaScore: typeof qa.score === "number" ? qa.score : null, mp4: fileUrl(files, "final_reel.mp4") ?? fileUrl(files, "mp4"), cover: fileUrl(files, "cover.png") ?? fileUrl(files, "cover.svg"), caption: fileUrl(files, "caption.txt"), hashtags: fileUrl(files, "hashtags.txt"), script: fileUrl(files, "script.txt"), qaReport: fileUrl(files, "qa_report.md"), mediaPack: fileUrl(files, "media_pack.json"), storyboard: fileUrl(files, "storyboard.json"), publishingBlocked: true };
}
function a(label: string, url?: string | null) { return url ? `<a href="${esc(url)}" target="_blank" rel="noopener" download>${esc(label)}</a>` : ""; }
function card(x: Item) {
  const jid = esc(x.jobId);
  return `<article><div class="phone">${x.mp4 ? `<video controls preload="metadata" playsinline src="${esc(x.mp4)}"></video>` : "No MP4"}</div><div class="card-body"><h2>${esc(x.topic)}</h2><p>QA ${esc(x.qaScore ?? "-")} · <b>${esc(x.approvalStatus)}</b> · Publishing blocked</p><div class="actions"><button data-action="approve" data-job="${jid}">Approve</button><button data-action="reject" data-job="${jid}">Reject</button><button data-action="mark_uploaded" data-job="${jid}">Uploaded</button></div><div class="links">${a("MP4",x.mp4)}${a("Cover",x.cover)}${a("Caption",x.caption)}${a("Hashtags",x.hashtags)}${a("Script",x.script)}${a("QA",x.qaReport)}${a("Pack",x.mediaPack)}${a("Storyboard",x.storyboard)}</div><small>Job: ${jid}</small></div></article>`;
}
function activity(items: Item[]) {
  const top = items.slice(0, 6);
  return top.map((x, i) => `<li><b>${i === 0 ? "CEO latest output" : "Artifact"}</b> · ${esc(x.topic)} · QA ${esc(x.qaScore ?? "-")} · ${esc(x.approvalStatus)}</li>`).join("");
}
function page(items: Item[], err?: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SINK DINK Control Room</title><style>body{margin:0;background:#070a12;color:#f8fafc;font-family:system-ui;padding:20px}.hero{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(280px,.7fr);gap:18px}.panel,article{background:#0f172a;border:1px solid #273449;border-radius:22px;padding:16px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin-top:18px}.phone{aspect-ratio:9/16;background:#000;display:grid;place-items:center;border-radius:16px;overflow:hidden}video{width:100%;height:100%;object-fit:cover}button,a{display:inline-block;margin:4px;padding:9px 11px;border:1px solid #334155;border-radius:10px;background:#111827;color:#dbeafe;text-decoration:none;cursor:pointer}button:hover,a:hover{border-color:#60a5fa}.primary{background:#2563eb;color:white}.danger{background:#7f1d1d}.muted,p,small,li{color:#94a3b8}.err{color:#fecaca;background:#3b1111;padding:12px;border-radius:12px}.actions{margin:10px 0}.links{margin-top:8px}.topline{display:flex;justify-content:space-between;gap:12px;align-items:center}</style></head><body><main><section class="hero"><div class="panel"><div class="topline"><div><h1>SINK DINK Control Room</h1><p>Run, review, download, approve, reject, and mark manually uploaded. No auto-posting.</p></div><a href="/api/sink-dink/artifacts/review">Refresh</a></div><button class="primary" id="runBtn">CEO, aaj ka kaam start kro</button><a href="/api/sink-dink/artifacts/latest?limit=3" target="_blank">Latest JSON</a>${err ? `<div class="err">${esc(err)}</div>` : `<p>Loaded ${items.length} artifact(s). Human approval required. Publishing blocked.</p>`}</div><div class="panel"><h2>Agent Activity</h2><ol>${activity(items) || "<li>No activity yet.</li>"}</ol></div></section><section class="grid">${items.map(card).join("") || "<p>No artifacts yet.</p>"}</section></main><script>async function postJson(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok) throw new Error(d.error||('HTTP '+r.status));return d;}document.addEventListener('click',async(e)=>{const b=e.target.closest('button');if(!b)return;if(b.id==='runBtn'){b.disabled=true;b.textContent='Running CEO...';try{await postJson('/api/sink-dink/agent-workflow/start-day',{command:'CEO, aaj ka kaam start kro',count:3,durationSec:20});location.reload();}catch(err){alert(err.message);b.disabled=false;b.textContent='CEO, aaj ka kaam start kro';}}const action=b.dataset.action,jobId=b.dataset.job;if(action&&jobId){b.disabled=true;try{await postJson('/api/sink-dink/artifacts/review/action',{jobId,action});location.reload();}catch(err){alert(err.message);b.disabled=false;}}});</script></body></html>`;
}

export function sinkDinkArtifactReviewRoutes() {
  const router = Router();
  router.get("/sink-dink/artifacts/review/latest", async (req, res) => {
    try { const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "12"), 10) || 12, 1), 50); res.json({ ok: true, service: "sink-dink-artifact-review", artifacts: (await readJobs(limit)).map(mapJob), publishingBlocked: true, humanApprovalRequired: true }); }
    catch (error) { res.status(502).json({ ok: false, service: "sink-dink-artifact-review", error: error instanceof Error ? error.message : String(error), publishingBlocked: true }); }
  });
  router.post("/sink-dink/artifacts/review/action", async (req, res) => {
    try { const jobId = safeJobId(req.body?.jobId); const action = str(req.body?.action); if (!jobId || !action || !ACTIONS[action]) throw new Error("Invalid job/action."); res.json({ ok: true, service: "sink-dink-artifact-review", jobId, action, rows: await updateJob(jobId, action), publishingBlocked: true, humanApprovalRequired: true, autoPublished: false }); }
    catch (error) { res.status(400).json({ ok: false, service: "sink-dink-artifact-review", error: error instanceof Error ? error.message : String(error), publishingBlocked: true }); }
  });
  router.get("/sink-dink/artifacts/review", async (req, res) => {
    try { const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "12"), 10) || 12, 1), 50); res.type("html").send(page((await readJobs(limit)).map(mapJob))); }
    catch (error) { res.type("html").status(502).send(page([], error instanceof Error ? error.message : String(error))); }
  });
  return router;
}
