# SINK DINK Remote Worker + Supabase Setup

This project uses a low-risk multi-server layout for the SINK DINK India test organisation.

## Servers

- Render / Paperclip: control room, agents, approval, orchestration.
- Hugging Face Space: remote media worker for output-pack generation.
- Supabase: job queue, audit log, and output status tracking.
- GitHub: source code, memory files, and deployment history.

## Render environment variables

Set these in the Render service environment.

```text
PAPERCLIP_MEDIA_RENDER_MODE=remote
MEDIA_WORKER_URL=https://nikhil123789-sink-dink-media-worker.hf.space
SUPABASE_URL=https://scmlsgoiiawaaairltzd.supabase.co
SUPABASE_ANON_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret key>
SINK_DINK_QUEUE_MODE=supabase
```

Never commit the Supabase secret/service-role key to GitHub.

## Supabase schema

Run this once in Supabase SQL Editor.

```sql
create table if not exists sink_dink_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text unique,
  source text default 'paperclip',
  worker text default 'huggingface',
  topic text,
  status text default 'created',
  files jsonb default '[]'::jsonb,
  qa jsonb default '{}'::jsonb,
  approval_status text default 'pending_human_approval',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists sink_dink_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  job_id text,
  actor text default 'system',
  details jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_sink_dink_jobs_job_id on sink_dink_jobs(job_id);
create index if not exists idx_sink_dink_jobs_status on sink_dink_jobs(status);
create index if not exists idx_sink_dink_audit_job_id on sink_dink_audit_log(job_id);
```

## Test endpoints after Render deploy

Status:

```text
https://paperclip-ai-company.onrender.com/api/health/sink-dink/remote-worker/status
```

Create a remote worker job:

```text
POST https://paperclip-ai-company.onrender.com/api/health/sink-dink/remote-worker/create
```

Example payload:

```json
{
  "topic": "Indian married couple ko good news kab doge family pressure",
  "tone": "respectful Hinglish, calm, emotionally mature",
  "durationSec": 25
}
```

Expected successful response:

```json
{
  "ok": true,
  "service": "sink-dink-remote-worker-bridge",
  "jobId": "...",
  "remoteStatus": "completed_placeholder",
  "files": [
    {
      "file": "caption.txt",
      "url": "/files/.../caption.txt",
      "absoluteUrl": "https://nikhil123789-sink-dink-media-worker.hf.space/files/.../caption.txt"
    }
  ],
  "humanApprovalRequired": true,
  "publishingBlocked": true
}
```

## Safety rules

- This is still a testing project, not the final company.
- No auto-publishing.
- Every output requires human approval.
- The worker creates output links; Paperclip remains the control room.
- Supabase stores logs/status only; secrets must stay in Render environment variables.
