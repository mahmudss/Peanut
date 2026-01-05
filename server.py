import json
import subprocess
import uuid
import os
import re
from pathlib import Path

from fastapi import FastAPI, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException
from fastapi.responses import FileResponse


APP_DIR = Path(__file__).parent.resolve()
STORAGE = APP_DIR / "storage"
ORIGINALS = STORAGE / "originals"
PROCESSED = STORAGE / "processed"
WEB = APP_DIR / "web"

for p in [ORIGINALS, PROCESSED, WEB]:
    p.mkdir(parents=True, exist_ok=True)

app = FastAPI()
app.mount("/web", StaticFiles(directory=str(WEB), html=True), name="web")
app.mount("/videos", StaticFiles(directory=str(PROCESSED)), name="videos")

RENDITIONS = [
    ("240p", 240, 450),
    ("360p", 360, 900),
    ("480p", 480, 1500),
    ("720p", 720, 2800),
]

SEG_SECONDS = 2

# --- AUDIO SETTINGS (single audio) ---
AUDIO_LABEL = "audio"
AUDIO_BITRATE_KBPS = 128


def make_video_id(filename: str) -> str:
    name = Path(filename).stem
    name = name.strip().lower()

    # spaces/underscores -> hyphen
    name = re.sub(r"[\s_]+", "-", name)

    # add hyphen between letters<->digits boundaries (video1 -> video-1, 1video -> 1-video)
    name = re.sub(r"([a-z])([0-9])", r"\1-\2", name)
    name = re.sub(r"([0-9])([a-z])", r"\1-\2", name)

    # remove unsafe chars (keep only a-z 0-9 and -)
    name = re.sub(r"[^a-z0-9-]", "", name)

    # collapse repeated hyphens
    name = re.sub(r"-{2,}", "-", name).strip("-")

    return name or "video"


def run_cmd(cmd, cwd: Path):
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=str(cwd))
    print("CMD:", " ".join(cmd))
    print("CWD:", str(cwd))
    print("STDERR:\n", p.stderr)
    if p.returncode != 0:
        raise RuntimeError("FFmpeg failed")


def run_ffmpeg_dash_video_only(input_path: Path, out_dir: Path, height: int, v_bitrate_kbps: int):
    out_dir.mkdir(parents=True, exist_ok=True)

    # VIDEO ONLY -> init + numbered chunks
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),

        "-map", "0:v:0",

        "-vf", f"scale=-2:{height}",
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-profile:v", "baseline",
        "-level", "3.1",
        "-sc_threshold", "0",
        "-force_key_frames", f"expr:gte(t,n_forced*{SEG_SECONDS})",
        "-b:v", f"{v_bitrate_kbps}k",

        "-f", "dash",
        "-seg_duration", str(SEG_SECONDS),
        "-use_timeline", "0",
        "-use_template", "1",
        "-init_seg_name", "init.m4s",
        "-media_seg_name", "chunk_$Number%05d$.m4s",

        "stream.mpd",
    ]
    run_cmd(cmd, out_dir)


def run_ffmpeg_dash_audio_only(input_path: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)

    # AUDIO ONLY -> init + numbered chunks
    # Encode to AAC-LC (mp4a.40.2) which browsers support well.
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),

        "-map", "0:a:0",
        "-c:a", "aac",
        "-b:a", f"{AUDIO_BITRATE_KBPS}k",
        "-ac", "2",
        "-ar", "48000",

        "-f", "dash",
        "-seg_duration", str(SEG_SECONDS),
        "-use_timeline", "0",
        "-use_template", "1",
        "-init_seg_name", "init.m4s",
        "-media_seg_name", "chunk_$Number%05d$.m4s",

        "stream.mpd",
    ]
    run_cmd(cmd, out_dir)


def make_manifest(video_id: str, video_dir: Path):
    manifest = {
        "video_id": video_id,
        "chunk_seconds": SEG_SECONDS,

        "resolutions": {},
        "init_name": "init.m4s",

        # keep your original field for video
        "mime": 'video/mp4; codecs="avc1.42E01E"',

        # new: explicit separate mimes (used by client)
        "video_mime": 'video/mp4; codecs="avc1.42E01E"',
        "audio_mime": 'audio/mp4; codecs="mp4a.40.2"',

        # audio section
        "audio": {
            "bitrate_kbps": AUDIO_BITRATE_KBPS,
            "chunk_count": 0,
            "path": f"/videos/{video_id}/{AUDIO_LABEL}",
        },
    }

    # video renditions
    for (label, _, bitrate) in RENDITIONS:
        rdir = video_dir / label
        chunks = sorted([f for f in rdir.glob("chunk_*.m4s") if f.is_file()])
        manifest["resolutions"][label] = {
            "bitrate_kbps": bitrate,
            "chunk_count": len(chunks),
            "path": f"/videos/{video_id}/{label}",
        }

    # audio chunks
    adir = video_dir / AUDIO_LABEL
    achunks = sorted([f for f in adir.glob("chunk_*.m4s") if f.is_file()])
    manifest["audio"]["chunk_count"] = len(achunks)

    (video_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


@app.get("/api/videos")
def list_videos():
    items = []
    for d in PROCESSED.iterdir():
        if d.is_dir() and (d / "manifest.json").exists():
            items.append(d.name)
    return {"videos": sorted(items)}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    video_id = make_video_id(file.filename)


    input_path = ORIGINALS / f"{video_id}_{file.filename}"
    input_path.write_bytes(await file.read())

    video_dir = PROCESSED / video_id
    video_dir.mkdir(parents=True, exist_ok=True)

    # 1) create video renditions
    for (label, height, bitrate) in RENDITIONS:
        run_ffmpeg_dash_video_only(input_path, video_dir / label, height, bitrate)

    # 2) create ONE audio track (chunked)
    run_ffmpeg_dash_audio_only(input_path, video_dir / AUDIO_LABEL)

    # 3) manifest
    make_manifest(video_id, video_dir)
    return {"video_id": video_id, "manifest_url": f"/videos/{video_id}/manifest.json"}

@app.get("/api/download/{video_id}")
def download_original(video_id: str):
    # Your originals are saved like: ORIGINALS / f"{video_id}_{file.filename}"
    matches = sorted(ORIGINALS.glob(f"{video_id}_*"))

    if not matches:
        raise HTTPException(status_code=404, detail="Original file not found")

    fpath = matches[0]  # take the first match
    # Download "as it is in the server" -> keep server filename
    return FileResponse(
        path=str(fpath),
        media_type="application/octet-stream",
        filename=fpath.name,  # this is the server-side stored name
    )
