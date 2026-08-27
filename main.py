import multiprocessing
import subprocess
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
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

# Mobile (phone) preview clips live in a separate cache from the desktop
# preview above: short and low-bitrate by design (see _mobile_preview_path),
# since these are meant to be downloaded in a batch and held on a phone,
# not streamed once from a machine on the same LAN.
MOBILE_CACHE_DIR = Path(__file__).parent / ".cache" / "mobile"
MOBILE_CLIP_SEC = 45
MOBILE_CLIP_BITRATE = "128k"
# How long a checked-out batch is held before it's considered abandoned
# (app deleted, phone lost, session never synced) and swept back into the
# normal pending pool so it doesn't get stuck off the desktop queue forever.
MOBILE_CHECKOUT_EXPIRY_SEC = 48 * 60 * 60

# Extensions whose containers commonly carry large embedded album art
# (ID3 APIC / iTunes atoms), which can delay browser metadata probing by
# several seconds.
ART_STRIP_EXTENSIONS = {".mp3", ".m4a", ".aiff", ".aif"}

# Most EDM tracks open with a bare intro (just drums), so previews start
# partway in instead — same offset used for feature-extraction windowing.
PREVIEW_START_OFFSET_SEC = ANALYSIS_OFFSET_SEC


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # A scan's ProcessPoolExecutor workers are separate OS processes, spawned
    # fresh (not forked) on macOS. If this process dies without them being
    # told to stop, they don't die with it — they keep chewing through
    # already-submitted files independently, pinning every core until the
    # whole backlog finishes. Ask nicely first (lets the in-flight file finish
    # and the pool wind itself down cleanly), but a file already in progress
    # won't even notice the cancel flag until it completes, so cap the wait
    # and then kill any worker processes still standing — that's the actual
    # guarantee, not the cooperative join.
    if SCAN_STATE["running"]:
        SCAN_CANCEL_EVENT.set()
        if SCAN_THREAD is not None:
            SCAN_THREAD.join(timeout=5)
    for child in multiprocessing.active_children():
        child.kill()


app = FastAPI(lifespan=lifespan)
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


def _mobile_preview_path(track_id, source_path, duration_sec=None):
    # Unlike the desktop preview (a near-full-length stream copy), this is
    # deliberately short and re-encoded down — it's meant to be downloaded
    # in a batch of dozens onto a phone, not streamed once over a LAN. A
    # 45s/128kbps clip is ~15-20x smaller than the desktop preview while
    # still being plenty to judge genre/energy on. Unlike
    # _playable_audio_path, there's no reasonable fallback to the original
    # file here (it would defeat the entire point of a small batch download),
    # so a failure here just raises — the caller drops that track from the
    # batch rather than handing the phone something huge or unplayable.
    offset = PREVIEW_START_OFFSET_SEC
    if duration_sec is not None and duration_sec <= offset + 5:
        offset = 0

    MOBILE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached_path = MOBILE_CACHE_DIR / f"{track_id}.m4a"
    if cached_path.exists():
        return cached_path

    cmd = ["ffmpeg", "-v", "error", "-y"]
    if offset:
        cmd += ["-ss", str(offset)]
    cmd += [
        "-i", str(source_path),
        "-t", str(MOBILE_CLIP_SEC),
        "-map", "0:a",
        "-c:a", "aac",
        "-b:a", MOBILE_CLIP_BITRATE,
        "-ac", "2",
        str(cached_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return cached_path


def _clear_mobile_preview(track_id):
    (MOBILE_CACHE_DIR / f"{track_id}.m4a").unlink(missing_ok=True)


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


SCAN_CANCEL_EVENT = threading.Event()
SCAN_THREAD = None


def _run_scan_in_background(folder):
    def on_progress(fields):
        SCAN_STATE.update(fields)

    try:
        scan_module.scan(folder, DB_PATH, on_progress=on_progress, cancel_event=SCAN_CANCEL_EVENT)
    except Exception as exc:  # noqa: BLE001 - surface any failure via status polling rather than crashing the thread silently
        SCAN_STATE["error_message"] = str(exc)
    finally:
        SCAN_STATE["running"] = False


class ScanRequest(BaseModel):
    folder: str = Field(min_length=1)


class RemoveFolderRequest(BaseModel):
    folder: str = Field(min_length=1)


class ConfirmRequest(BaseModel):
    genre: str = Field(min_length=1)
    energy: int = Field(ge=1, le=5)


class MobileSyncDecision(BaseModel):
    track_id: int
    action: Literal["confirm", "delete", "skip"]
    genre: Optional[str] = None
    energy: Optional[int] = Field(default=None, ge=1, le=5)


class MobileSyncRequest(BaseModel):
    decisions: list[MobileSyncDecision]


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

    global SCAN_THREAD
    SCAN_CANCEL_EVENT.clear()
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
    SCAN_THREAD = threading.Thread(target=_run_scan_in_background, args=(str(folder_path),), daemon=True)
    SCAN_THREAD.start()
    return dict(SCAN_STATE)


@app.get("/library/scan/status")
def scan_status():
    return dict(SCAN_STATE)


@app.post("/library/scan/cancel")
def cancel_scan():
    if not SCAN_STATE["running"]:
        raise HTTPException(status_code=409, detail="No scan is running")
    SCAN_CANCEL_EVENT.set()
    return {"cancelling": True}


@app.post("/library/remove-folder")
def remove_folder(body: RemoveFolderRequest):
    folder_path = Path(body.folder).expanduser()
    with db.connect(DB_PATH) as conn:
        removed_ids = db.delete_tracks_under_folder(conn, str(folder_path))
    return {"removed": len(removed_ids)}


@app.get("/tracks/stats")
def track_stats():
    with db.connect(DB_PATH) as conn:
        return db.get_stats(conn)


@app.get("/tracks/all")
def all_tracks():
    with db.connect(DB_PATH) as conn:
        rows = db.get_all_tracks(conn)
    return [_track_to_dict(row) for row in rows]


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


# --- Mobile (phone) batch checkout/sync -------------------------------
#
# A phone reviews tracks offline in small batches rather than talking to
# this server per-swipe: check out a batch (which also generates each
# track's small mobile preview clip), download it, swipe through it with
# no network needed, then sync the accumulated decisions back in one
# request. Checked-out tracks are hidden from the desktop queue
# (db.get_next_pending) so the same track never gets reviewed twice from
# two devices at once.
#
# NOTE before exposing this beyond localhost/LAN (e.g. via Tailscale): these
# routes have no auth yet, same as the rest of this app today. That's an
# acceptable posture for "only my own devices can reach my laptop at all,"
# but worth revisiting — these endpoints can delete files — before relying
# on it from anywhere less trusted than that.


@app.post("/mobile/batch/checkout")
def mobile_checkout(size: int = Query(default=25, ge=1, le=100)):
    with db.connect(DB_PATH) as conn:
        db.sweep_expired_checkouts(conn, MOBILE_CHECKOUT_EXPIRY_SEC)
        batch_id, rows = db.checkout_batch(conn, size)
        if batch_id is None:
            raise HTTPException(status_code=404, detail="No pending tracks available to check out")

        tracks = []
        for row in rows:
            path = Path(row["path"])
            try:
                if not path.is_file():
                    raise FileNotFoundError(path)
                _mobile_preview_path(row["id"], path, row["file_duration_sec"])
            except (subprocess.CalledProcessError, FileNotFoundError):
                # Couldn't build a preview for this one (missing file, ffmpeg
                # failure) — release it back to the pool rather than hand the
                # phone a track it can't play.
                db.release_checkout(conn, row["id"])
                continue
            tracks.append(
                {
                    "id": row["id"],
                    "filename": path.name,
                    "predicted_genre": row["predicted_genre"],
                    "predicted_energy": row["predicted_energy"],
                    "confirmed_genre": row["confirmed_genre"],
                    "confirmed_energy": row["confirmed_energy"],
                    "preview_url": f"/mobile/preview/{row['id']}",
                }
            )

    return {"batch_id": batch_id, "tracks": tracks}


@app.get("/mobile/preview/{track_id}")
def mobile_preview(track_id: int):
    cached_path = MOBILE_CACHE_DIR / f"{track_id}.m4a"
    if not cached_path.is_file():
        raise HTTPException(status_code=404, detail="No mobile preview for this track")
    return FileResponse(cached_path)


@app.post("/mobile/batch/{batch_id}/sync")
def mobile_sync(batch_id: str, body: MobileSyncRequest):
    summary = {"confirmed": 0, "deleted": 0, "skipped": 0, "errors": []}

    with db.connect(DB_PATH) as conn:
        batch_rows = {row["id"]: row for row in db.get_batch_tracks(conn, batch_id)}
        if not batch_rows:
            raise HTTPException(status_code=404, detail="Unknown or already-synced batch")

        decided_ids = set()
        for decision in body.decisions:
            row = batch_rows.get(decision.track_id)
            if row is None:
                summary["errors"].append(
                    {"track_id": decision.track_id, "detail": "not part of this batch"}
                )
                continue
            decided_ids.add(decision.track_id)

            if decision.action == "confirm":
                if not decision.genre or decision.energy is None:
                    summary["errors"].append(
                        {"track_id": decision.track_id, "detail": "confirm requires genre and energy"}
                    )
                    db.release_checkout(conn, decision.track_id)
                    continue
                db.confirm_track(conn, decision.track_id, decision.genre, decision.energy)
                summary["confirmed"] += 1
            elif decision.action == "delete":
                path = Path(row["path"])
                if path.is_file():
                    try:
                        send2trash(str(path))
                    except Exception as exc:
                        summary["errors"].append(
                            {"track_id": decision.track_id, "detail": f"trash failed: {exc}"}
                        )
                        db.release_checkout(conn, decision.track_id)
                        continue
                db.mark_deleted(conn, decision.track_id)
                summary["deleted"] += 1
            else:  # skip — leave it pending, just release the checkout
                summary["skipped"] += 1

            db.release_checkout(conn, decision.track_id)

        # Anything checked out in this batch but never mentioned in the
        # sync payload (e.g. the phone session ended early) goes back to
        # pending rather than staying stuck checked out until it expires.
        for track_id in batch_rows.keys() - decided_ids:
            db.release_checkout(conn, track_id)
            summary["skipped"] += 1

    for track_id in batch_rows:
        _clear_mobile_preview(track_id)

    return summary
