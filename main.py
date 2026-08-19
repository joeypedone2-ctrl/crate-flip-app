import subprocess
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from send2trash import send2trash

import db
import scan as scan_module
from analysis import ANALYSIS_OFFSET_SEC

DB_PATH = "crate_flip.db"
STATIC_DIR = Path(__file__).parent / "static"
AUDIO_CACHE_DIR = Path(__file__).parent / ".cache" / "audio"

# Extensions whose containers commonly carry large embedded album art
# (ID3 APIC / iTunes atoms), which can delay browser metadata probing by
# several seconds.
ART_STRIP_EXTENSIONS = {".mp3", ".m4a", ".aiff", ".aif"}

# Most EDM tracks open with a bare intro (just drums), so previews start
# partway in instead — same offset used for feature-extraction windowing.
PREVIEW_START_OFFSET_SEC = ANALYSIS_OFFSET_SEC

app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _playable_audio_path(track_id, source_path, duration_sec=None):
    offset = PREVIEW_START_OFFSET_SEC
    if duration_sec is not None and duration_sec <= offset + 5:
        offset = 0  # too short to skip an intro without cutting the track off

    needs_processing = offset > 0 or source_path.suffix.lower() in ART_STRIP_EXTENSIONS
    if not needs_processing:
        return source_path

    AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached_path = AUDIO_CACHE_DIR / f"{track_id}{source_path.suffix}"
    if cached_path.exists():
        return cached_path

    cmd = ["ffmpeg", "-v", "error", "-y"]
    if offset:
        cmd += ["-ss", str(offset)]
    cmd += ["-i", str(source_path), "-map", "0:a", "-c", "copy", str(cached_path)]

    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return cached_path
    except (subprocess.CalledProcessError, FileNotFoundError):
        # ffmpeg missing or this file couldn't be remuxed cleanly — fall
        # back to serving the original rather than failing playback.
        return source_path


SCAN_STATE = {
    "running": False,
    "folder": None,
    "phase": None,
    "discovered": 0,
    "to_process": 0,
    "processed": 0,
    "errors": 0,
    "error_message": None,
}


def _run_scan_in_background(folder):
    def on_progress(fields):
        SCAN_STATE.update(fields)

    try:
        scan_module.scan(folder, DB_PATH, on_progress=on_progress)
    except Exception as exc:  # noqa: BLE001 - surface any failure via status polling rather than crashing the thread silently
        SCAN_STATE["error_message"] = str(exc)
    finally:
        SCAN_STATE["running"] = False


class ScanRequest(BaseModel):
    folder: str = Field(min_length=1)


class ConfirmRequest(BaseModel):
    genre: str = Field(min_length=1)
    energy: int = Field(ge=1, le=5)


def _track_to_dict(row):
    data = dict(row)
    data["filename"] = Path(data["path"]).name
    return data


@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC_DIR / "index.html").read_text()


@app.get("/api/health")
def health():
    return {"message": "Crate Flip is alive"}


@app.post("/library/scan")
def start_scan(body: ScanRequest):
    if SCAN_STATE["running"]:
        raise HTTPException(status_code=409, detail="A scan is already running")

    folder_path = Path(body.folder).expanduser()
    if not folder_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a folder: {body.folder}")

    SCAN_STATE.update(
        running=True,
        folder=str(folder_path),
        phase="starting",
        discovered=0,
        to_process=0,
        processed=0,
        errors=0,
        error_message=None,
    )
    threading.Thread(target=_run_scan_in_background, args=(str(folder_path),), daemon=True).start()
    return dict(SCAN_STATE)


@app.get("/library/scan/status")
def scan_status():
    return dict(SCAN_STATE)


@app.get("/tracks/stats")
def track_stats():
    with db.connect(DB_PATH) as conn:
        return db.get_stats(conn)


@app.get("/tracks/next")
def next_track(after_id: int = 0):
    with db.connect(DB_PATH) as conn:
        row = db.get_next_pending(conn, after_id=after_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No pending tracks")
    return _track_to_dict(row)


@app.get("/tracks/{track_id}")
def read_track(track_id: int):
    with db.connect(DB_PATH) as conn:
        row = db.get_track(conn, track_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return _track_to_dict(row)


@app.get("/tracks/{track_id}/audio")
def track_audio(track_id: int):
    with db.connect(DB_PATH) as conn:
        row = db.get_track(conn, track_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Track not found")
    path = Path(row["path"])
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Audio file missing on disk")
    return FileResponse(_playable_audio_path(track_id, path, row["file_duration_sec"]))


@app.post("/tracks/{track_id}/confirm")
def confirm_track(track_id: int, body: ConfirmRequest):
    with db.connect(DB_PATH) as conn:
        row = db.get_track(conn, track_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Track not found")
        db.confirm_track(conn, track_id, body.genre, body.energy)
        updated = db.get_track(conn, track_id)
    return _track_to_dict(updated)


@app.post("/tracks/{track_id}/delete")
def delete_track(track_id: int):
    with db.connect(DB_PATH) as conn:
        row = db.get_track(conn, track_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Track not found")
        path = Path(row["path"])
        if path.is_file():
            try:
                send2trash(str(path))
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to move file to trash: {exc}")
        db.mark_deleted(conn, track_id)
        updated = db.get_track(conn, track_id)
    return _track_to_dict(updated)
