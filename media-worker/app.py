from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
from uuid import uuid4
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
import json
import subprocess
import textwrap
import html

app = FastAPI(title="SINK DINK Media Worker")
ROOT = Path("/tmp/sink_dink_worker")
ROOT.mkdir(parents=True, exist_ok=True)

class CreateRequest(BaseModel):
    topic: str = "SINK DINK India test topic"
    tone: str = "respectful Hinglish"
    durationSec: int = 25
    mediaPack: dict | None = None

FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def safe_name(value: str) -> str:
    return "".join(ch for ch in value if ch.isalnum() or ch in "-_.")

def wrapped(text: str, width: int = 28) -> list[str]:
    return textwrap.wrap(text, width=width) or [""]

def make_pack(req: CreateRequest) -> dict:
    topic = req.topic.strip() or "SINK DINK India"
    return {
        "title": "SINK DINK India Upload Pack",
        "topic": topic,
        "tone": req.tone,
        "durationSec": req.durationSec,
        "hook": "Good news kab doge? Har couple ka answer same nahi hota.",
        "script": [
            "Good news kab doge? Ye sawaal simple lagta hai, par pressure bohot real hota hai.",
            "Har couple ka timeline alag hota hai. Career, health, money aur mental peace bhi life ka part hain.",
            "SINK DINK ka matlab selfish hona nahi. Matlab apni life choices responsibly plan karna.",
            "Family ko respect do, lekin apni marriage ka decision calm mind se lo. Approval se pehle peace zaroori hai."
        ],
        "caption": "Good news ka pressure real hai. Respect family ko bhi, peace apne relationship ko bhi. Human approval required.",
        "hashtags": ["#SINKDINKIndia", "#NoKidsByChoice", "#ModernRelationships", "#IndianCouples", "#FinancialPeace"],
        "visualStyle": "minimal premium Indian Instagram reel, dark background, bold Hinglish text",
        "approvalStatus": "pending_human_approval"
    }

def load_font(size: int, bold: bool = False):
    path = FONT_BOLD if bold else FONT_REGULAR
    return ImageFont.truetype(path, size)

def draw_centered(draw, lines, y, font, fill, width=1080, gap=12):
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        x = (width - (bbox[2] - bbox[0])) // 2
        draw.text((x, y), line, font=font, fill=fill)
        y += (bbox[3] - bbox[1]) + gap
    return y

def make_slide(path: Path, title: str, body: str, footer: str):
    img = Image.new("RGB", (1080, 1920), (18, 18, 22))
    draw = ImageDraw.Draw(img)
    title_font = load_font(74, True)
    body_font = load_font(52, False)
    footer_font = load_font(34, False)
    draw.rectangle((60, 60, 1020, 1860), outline=(210, 210, 210), width=4)
    draw.text((90, 95), "SINK DINK INDIA", font=footer_font, fill=(180, 180, 180))
    y = 430
    y = draw_centered(draw, wrapped(title, 18), y, title_font, (255, 255, 255), gap=20)
    y += 90
    draw_centered(draw, wrapped(body, 28), y, body_font, (235, 235, 235), gap=18)
    draw.text((90, 1760), footer, font=footer_font, fill=(170, 170, 170))
    img.save(path)

def make_cover_svg(path: Path, pack: dict):
    title = html.escape(pack["hook"])
    topic = html.escape(pack["topic"])
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="#121216"/>
  <rect x="60" y="60" width="960" height="1800" rx="36" fill="none" stroke="#e8e8e8" stroke-width="4"/>
  <text x="90" y="150" fill="#bbbbbb" font-size="38" font-family="Arial">SINK DINK INDIA</text>
  <text x="90" y="650" fill="#ffffff" font-size="72" font-weight="700" font-family="Arial">Good news?</text>
  <text x="90" y="750" fill="#ffffff" font-size="64" font-weight="700" font-family="Arial">Har couple ka</text>
  <text x="90" y="840" fill="#ffffff" font-size="64" font-weight="700" font-family="Arial">answer alag hota hai.</text>
  <text x="90" y="1070" fill="#d8d8d8" font-size="42" font-family="Arial">{topic}</text>
  <text x="90" y="1760" fill="#aaaaaa" font-size="34" font-family="Arial">Human approval required</text>
</svg>'''
    path.write_text(svg, encoding="utf-8")

def render_video(job_dir: Path, slide_paths: list[Path], total_seconds: int) -> Path:
    concat = job_dir / "slides.txt"
    duration = max(3, int(total_seconds / max(1, len(slide_paths))))
    lines = []
    for slide in slide_paths:
        lines.append(f"file '{slide.as_posix()}'")
        lines.append(f"duration {duration}")
    lines.append(f"file '{slide_paths[-1].as_posix()}'")
    concat.write_text("\n".join(lines), encoding="utf-8")
    out = job_dir / "final_reel.mp4"
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-t", str(max(total_seconds, duration * len(slide_paths))), str(out)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return out

@app.get("/health")
def health():
    return {"ok": True, "service": "sink-dink-media-worker", "mode": "media_pack_v2", "time": datetime.utcnow().isoformat()}

@app.post("/create")
def create(req: CreateRequest):
    job_id = datetime.utcnow().strftime("%Y%m%d") + "-" + uuid4().hex[:10]
    job_dir = ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    pack = req.mediaPack or make_pack(req)
    script_lines = pack.get("script", [])
    if isinstance(script_lines, str):
        script_lines = [script_lines]
    if not script_lines:
        script_lines = make_pack(req)["script"]
    pack["script"] = script_lines
    (job_dir / "media_pack.json").write_text(json.dumps(pack, indent=2, ensure_ascii=False), encoding="utf-8")
    (job_dir / "script.txt").write_text("\n".join(script_lines), encoding="utf-8")
    (job_dir / "voiceover.txt").write_text("\n".join(script_lines), encoding="utf-8")
    (job_dir / "caption.txt").write_text(pack.get("caption", "Human approval required."), encoding="utf-8")
    (job_dir / "hashtags.txt").write_text(" ".join(pack.get("hashtags", [])), encoding="utf-8")
    storyboard = [{"scene": i + 1, "text": line, "durationSec": max(3, int(req.durationSec / max(1, len(script_lines))))} for i, line in enumerate(script_lines)]
    (job_dir / "storyboard.json").write_text(json.dumps(storyboard, indent=2, ensure_ascii=False), encoding="utf-8")
    make_cover_svg(job_dir / "cover.svg", pack)
    slide_paths = []
    for i, line in enumerate(script_lines[:6], start=1):
        slide = job_dir / f"slide_{i:02d}.png"
        make_slide(slide, pack.get("hook", "SINK DINK India"), line, "Human approval required")
        slide_paths.append(slide)
    (job_dir / "cover.png").write_bytes(slide_paths[0].read_bytes())
    qa = "# QA Report\n\nStatus: generated_media_pack_v2\n\nPublishing: blocked until human approval.\n\nFiles include script, caption, hashtags, storyboard, cover image and final reel mp4.\n"
    (job_dir / "qa_report.md").write_text(qa, encoding="utf-8")
    video_ok = True
    try:
        render_video(job_dir, slide_paths, req.durationSec)
    except Exception as exc:
        video_ok = False
        (job_dir / "video_error.txt").write_text(str(exc), encoding="utf-8")
    file_names = ["media_pack.json", "script.txt", "voiceover.txt", "caption.txt", "hashtags.txt", "storyboard.json", "cover.svg", "cover.png", "qa_report.md"]
    if video_ok:
        file_names.append("final_reel.mp4")
    else:
        file_names.append("video_error.txt")
    return {
        "ok": True,
        "jobId": job_id,
        "status": "completed_media_pack_v2" if video_ok else "completed_without_video",
        "videoCreated": video_ok,
        "humanApprovalRequired": True,
        "publishingBlocked": True,
        "files": [{"file": name, "url": f"/files/{job_id}/{name}"} for name in file_names]
    }

@app.get("/status/{job_id}")
def status(job_id: str):
    job_dir = ROOT / safe_name(job_id)
    return {"ok": job_dir.exists(), "jobId": job_id, "status": "found" if job_dir.exists() else "not_found"}

@app.get("/files/{job_id}/{file_name}")
def files(job_id: str, file_name: str):
    path = ROOT / safe_name(job_id) / safe_name(file_name)
    if not path.exists():
        return {"ok": False, "error": "file_not_found"}
    return FileResponse(path)
