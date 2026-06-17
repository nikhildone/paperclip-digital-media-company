# SINK DINK Bulk Campaign Runbook

This runbook documents the safe bulk generation flow for the SINK DINK India media test-bed.

## Current architecture

- Render / Paperclip = control room and bridge
- Hugging Face Space = remote media worker
- Supabase = job and audit log
- Human approval = required before any publishing

## Bulk endpoint

```text
POST /api/health/sink-dink/remote-worker/bulk-create
```

The endpoint generates up to 10 media jobs sequentially to avoid overloading the free Hugging Face Space.

## Browser console test

Open the Paperclip company page first:

```text
https://paperclip-ai-company.onrender.com/NSD
```

Then open DevTools Console and run:

```js
(async () => {
  const r = await fetch("/api/health/sink-dink/remote-worker/bulk-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tone: "smart Hinglish, relatable, Instagram friendly",
      durationSec: 25,
      topics: [
        "SINK DINK India me family pressure aur personal freedom",
        "Good news kab doge pressure ka calm reply",
        "Indian couple ka financial peace before baby decision",
        "No kids by choice ko selfish samajhne wali society",
        "Marriage me apna timeline choose karna wrong nahi hai"
      ]
    })
  });

  const data = await r.json();
  console.log("HTTP:", r.status);
  console.log("BATCH:", data.batchId);
  console.log(data);

  console.table((data.results || []).map((item) => ({
    index: item.batchIndex,
    ok: item.ok,
    topic: item.topic,
    jobId: item.jobId,
    status: item.remoteStatus,
    videoCreated: item.videoCreated,
    mp4: (item.files || []).find((f) => f.file === "final_reel.mp4")?.absoluteUrl || "missing"
  })));
})();
```

## Expected response

```json
{
  "ok": true,
  "service": "sink-dink-remote-worker-bridge",
  "mode": "bulk-create",
  "batchId": "batch-YYYYMMDDHHMMSS",
  "count": 5,
  "successCount": 5,
  "failedCount": 0,
  "humanApprovalRequired": true,
  "publishingBlocked": true
}
```

Each item should include absolute URLs for files such as:

- media_pack.json
- script.txt
- voiceover.txt
- caption.txt
- hashtags.txt
- storyboard.json
- cover.svg
- cover.png
- qa_report.md
- final_reel.mp4

## Supabase verification

Check these tables:

- `sink_dink_jobs`
- `sink_dink_audit_log`

The jobs table should receive one row per generated topic. The audit table should receive one row per item plus a bulk summary row.

## Safety rules

- Do not auto-publish.
- Human approval is mandatory.
- Keep the free Hugging Face worker sequential and low volume.
- Use max 10 jobs per bulk run until a stronger worker is provisioned.
