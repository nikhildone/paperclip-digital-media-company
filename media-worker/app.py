from fastapi import FastAPI
from pydantic import BaseModel
from pathlib import Path
from uuid import uuid4
from datetime import datetime
import json

app = FastAPI(title="SINK DINK Media Worker")
ROOT = Path('/tmp/sink_dink_worker')
ROOT.mkdir(parents=True, exist_ok=True)

class CreateRequest(BaseModel):
    topic: str = 'SINK DINK India test topic'
    tone: str = 'respectful Hinglish'
    durationSec: int = 25
    mediaPack: dict | None = None

@app.get('/health')
def health():
    return {'ok': True, 'service': 'sink-dink-media-worker', 'time': datetime.utcnow().isoformat()}

@app.post('/create')
def create(req: CreateRequest):
    job_id = datetime.utcnow().strftime('%Y%m%d') + '-' + uuid4().hex[:10]
    job_dir = ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    pack = req.mediaPack or {
        'title': 'SINK DINK India Test Output',
        'topic': req.topic,
        'tone': req.tone,
        'durationSec': req.durationSec,
        'note': 'Remote worker placeholder pack. Full video render can be added after health test passes.'
    }
    (job_dir / 'media_pack.json').write_text(json.dumps(pack, indent=2), encoding='utf-8')
    (job_dir / 'caption.txt').write_text('Test caption for SINK DINK India. Human approval required.', encoding='utf-8')
    (job_dir / 'hashtags.txt').write_text('#SINKDINKIndia #NoKidsByChoice #ModernRelationships', encoding='utf-8')
    (job_dir / 'qa_report.md').write_text('# QA Report\n\nStatus: placeholder pass. Human approval required.\n', encoding='utf-8')
    return {
        'ok': True,
        'jobId': job_id,
        'status': 'completed_placeholder',
        'files': [
            {'file': 'media_pack.json', 'url': f'/files/{job_id}/media_pack.json'},
            {'file': 'caption.txt', 'url': f'/files/{job_id}/caption.txt'},
            {'file': 'hashtags.txt', 'url': f'/files/{job_id}/hashtags.txt'},
            {'file': 'qa_report.md', 'url': f'/files/{job_id}/qa_report.md'}
        ]
    }

@app.get('/status/{job_id}')
def status(job_id: str):
    job_dir = ROOT / job_id
    return {'ok': job_dir.exists(), 'jobId': job_id, 'status': 'completed_placeholder' if job_dir.exists() else 'not_found'}

@app.get('/files/{job_id}/{file_name}')
def files(job_id: str, file_name: str):
    from fastapi.responses import FileResponse
    safe_job = ''.join(ch for ch in job_id if ch.isalnum() or ch in '-_')
    safe_file = ''.join(ch for ch in file_name if ch.isalnum() or ch in '-_.')
    path = ROOT / safe_job / safe_file
    if not path.exists():
        return {'ok': False, 'error': 'file_not_found'}
    return FileResponse(path)
