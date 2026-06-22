import { useEffect, useMemo, useState } from "react";

type CampaignFile = {
  file?: string;
  url?: string;
  absoluteUrl?: string | null;
};

type CampaignResult = {
  ok?: boolean;
  batchId?: string;
  batchIndex?: number;
  title?: string;
  topic?: string;
  hook?: string;
  jobId?: string | null;
  status?: unknown;
  qaScore?: number;
  approvalStatus?: string;
  publishingBlocked?: boolean;
  mp4?: string | null;
  files?: CampaignFile[];
  error?: string;
};

type CampaignBatch = {
  ok?: boolean;
  service?: string;
  mode?: string;
  batchId?: string;
  count?: number;
  successCount?: number;
  failedCount?: number;
  averageQaScore?: number;
  humanApprovalRequired?: boolean;
  publishingBlocked?: boolean;
  agentsRunMode?: string;
  ai?: {
    provider?: string;
    model?: string;
    fallbackUsed?: boolean;
    reason?: string;
  };
  results?: CampaignResult[];
};

type CampaignStatus = {
  ok?: boolean;
  service?: string;
  workerUrlConfigured?: boolean;
  geminiConfigured?: boolean;
  geminiEnabled?: boolean;
  geminiExecutionAllowed?: boolean;
  supabaseConfigured?: boolean;
  agentsRunMode?: string;
  humanApprovalRequired?: boolean;
  publishingBlocked?: boolean;
};

const LAST_BATCH_KEY = "paperclip.sinkDink.lastBatch";

function readStoredBatch(): CampaignBatch | null {
  try {
    const raw = window.localStorage.getItem(LAST_BATCH_KEY);
    return raw ? (JSON.parse(raw) as CampaignBatch) : null;
  } catch {
    return null;
  }
}

function downloadJson(batch: CampaignBatch) {
  const blob = new Blob([JSON.stringify(batch, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `paperclip-sink-dink-batch-${batch.batchId || Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatBool(value: boolean | undefined) {
  if (value === true) return "ON";
  if (value === false) return "OFF";
  return "NA";
}

export function SinkDinkCeoControl() {
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [batch, setBatch] = useState<CampaignBatch | null>(() => readStoredBatch());
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const results = batch?.results ?? [];
  const canDownload = Boolean(batch?.batchId && results.length > 0);
  const statusText = useMemo(() => {
    if (!status) return "Status not checked yet";
    if (!status.ok) return "Campaign status returned not-ok";
    if (!status.workerUrlConfigured) return "MEDIA_WORKER_URL missing";
    if (!status.geminiConfigured) return "Gemini key missing";
    return "Ready for CEO production";
  }, [status]);

  async function refreshStatus() {
    setStatusLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sink-dink/ai-campaign/status", {
        credentials: "include",
      });
      const data = (await response.json()) as CampaignStatus;
      if (!response.ok) throw new Error(`Status failed: ${response.status}`);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status check failed");
    } finally {
      setStatusLoading(false);
    }
  }

  async function startProduction() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sink-dink/ai-campaign/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          topic: "SINK DINK India me family pressure, couple freedom aur financial peace",
          count: 10,
          tone: "smart Hinglish, premium, relatable, emotionally sharp, Indian Instagram style",
          durationSec: 25,
        }),
      });
      const data = (await response.json()) as CampaignBatch;
      if (!response.ok || data.ok === false) {
        throw new Error(
          data?.ai?.reason || `Production failed: ${response.status}`,
        );
      }
      setBatch(data);
      window.localStorage.setItem(LAST_BATCH_KEY, JSON.stringify(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "CEO production failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-300">
            SINK-DINK CEO Control Room
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Start CEO Production Batch</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Generates 10 upload-ready SINK-DINK India packs using the working AI campaign engine. Publishing stays blocked until human approval.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refreshStatus}
            disabled={statusLoading || loading}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {statusLoading ? "Checking..." : "Check Status"}
          </button>
          <button
            type="button"
            onClick={startProduction}
            disabled={loading}
            className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "CEO Working..." : "Start CEO Batch"}
          </button>
          <button
            type="button"
            onClick={() => batch && downloadJson(batch)}
            disabled={!canDownload}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Download JSON
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs uppercase text-muted-foreground">Engine</p>
          <p className="mt-1 text-sm font-medium">{statusText}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs uppercase text-muted-foreground">Gemini</p>
          <p className="mt-1 text-sm font-medium">{formatBool(status?.geminiConfigured)} / Execute {formatBool(status?.geminiExecutionAllowed)}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs uppercase text-muted-foreground">Worker</p>
          <p className="mt-1 text-sm font-medium">{formatBool(status?.workerUrlConfigured)}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs uppercase text-muted-foreground">Last Batch</p>
          <p className="mt-1 text-sm font-medium">{batch?.batchId ?? "None yet"}</p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {batch ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs uppercase text-muted-foreground">Success</p>
              <p className="text-lg font-semibold">{batch.successCount ?? 0}/{batch.count ?? results.length}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs uppercase text-muted-foreground">Failed</p>
              <p className="text-lg font-semibold">{batch.failedCount ?? 0}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs uppercase text-muted-foreground">Average QA</p>
              <p className="text-lg font-semibold">{batch.averageQaScore ?? "NA"}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs uppercase text-muted-foreground">Approval</p>
              <p className="text-sm font-semibold">{batch.humanApprovalRequired ? "Human approval required" : "NA"}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Generated Upload-Ready Packs
            </h3>
            {results.length === 0 ? (
              <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                No results yet. Start a CEO batch.
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {results.map((item, index) => (
                  <article key={`${item.batchId ?? batch.batchId}-${item.batchIndex ?? index}`} className="rounded-lg border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Pack {item.batchIndex ?? index + 1}</p>
                        <h4 className="mt-1 font-semibold">{item.title ?? item.topic ?? "SINK-DINK Pack"}</h4>
                      </div>
                      <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                        QA {item.qaScore ?? "NA"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground"><strong>Topic:</strong> {item.topic ?? "NA"}</p>
                    <p className="mt-2 text-sm"><strong>Hook:</strong> {item.hook ?? "NA"}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
                        {item.approvalStatus ?? "pending_human_approval"}
                      </span>
                      {item.publishingBlocked ? (
                        <span className="rounded-full bg-red-500/10 px-2 py-1 text-red-600 dark:text-red-300">Publishing blocked</span>
                      ) : null}
                      {item.mp4 ? (
                        <a className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 underline dark:text-emerald-300" href={item.mp4} target="_blank" rel="noreferrer">
                          Open MP4
                        </a>
                      ) : null}
                    </div>
                    {item.error ? (
                      <p className="mt-3 text-sm text-red-600 dark:text-red-300">{item.error}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No local batch loaded. Click “Start CEO Batch” to generate the first visible dashboard batch.
        </div>
      )}
    </section>
  );
}
