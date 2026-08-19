from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from send2trash import send2trash

import db

DB_PATH = "crate_flip.db"

app = FastAPI()


class ConfirmRequest(BaseModel):
    genre: str = Field(min_length=1)
    energy: int = Field(ge=1, le=10)


def _track_to_dict(row):
    data = dict(row)
    data["filename"] = Path(data["path"]).name
    return data


@app.get("/")
def read_root():
    return {"message": "Crate Flip is alive"}


@app.get("/tracks/stats")
def track_stats():
    with db.connect(DB_PATH) as conn:
        return db.get_stats(conn)


@app.get("/tracks/next")
def next_track():
    with db.connect(DB_PATH) as conn:
        row = db.get_next_pending(conn)
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
    return FileResponse(path)


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
