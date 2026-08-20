"""SQLite persistence for the local track index."""

import sqlite3
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    file_mtime REAL NOT NULL,
    file_duration_sec REAL,
    tempo REAL,
    harmonic_ratio REAL,
    rms REAL,
    onset_strength REAL,
    spectral_centroid REAL,
    predicted_genre TEXT,
    predicted_energy INTEGER,
    confirmed_genre TEXT,
    confirmed_energy INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    processed_at REAL
);
"""


@contextmanager
def connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute(SCHEMA)
        conn.commit()
        yield conn
    finally:
        conn.close()


def get_track_by_path(conn, path):
    return conn.execute("SELECT * FROM tracks WHERE path = ?", (path,)).fetchone()


def needs_processing(conn, path, size, mtime):
    row = get_track_by_path(conn, path)
    if row is None:
        return True
    return row["file_size"] != size or row["file_mtime"] != mtime or row["error"] is not None


def upsert_pending(conn, path, size, mtime):
    conn.execute(
        """
        INSERT INTO tracks (path, file_size, file_mtime, status)
        VALUES (?, ?, ?, 'pending')
        ON CONFLICT(path) DO UPDATE SET
            file_size = excluded.file_size,
            file_mtime = excluded.file_mtime,
            status = 'pending',
            error = NULL
        """,
        (path, size, mtime),
    )


def save_result(conn, path, features, genre, energy, processed_at):
    conn.execute(
        """
        UPDATE tracks SET
            file_duration_sec = ?,
            tempo = ?,
            harmonic_ratio = ?,
            rms = ?,
            onset_strength = ?,
            spectral_centroid = ?,
            predicted_genre = ?,
            predicted_energy = ?,
            error = NULL,
            processed_at = ?
        WHERE path = ?
        """,
        (
            features["file_duration_sec"],
            features["tempo"],
            features["harmonic_ratio"],
            features["rms"],
            features["onset_strength"],
            features["spectral_centroid"],
            genre,
            energy,
            processed_at,
            path,
        ),
    )


def save_error(conn, path, error_message, processed_at):
    conn.execute(
        "UPDATE tracks SET error = ?, processed_at = ? WHERE path = ?",
        (error_message, processed_at, path),
    )


def get_track(conn, track_id):
    return conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()


def get_next_pending(conn, after_id=0):
    return conn.execute(
        "SELECT * FROM tracks WHERE status = 'pending' AND error IS NULL AND id > ? ORDER BY id LIMIT 1",
        (after_id,),
    ).fetchone()


def confirm_track(conn, track_id, genre, energy):
    conn.execute(
        """
        UPDATE tracks SET confirmed_genre = ?, confirmed_energy = ?, status = 'confirmed'
        WHERE id = ?
        """,
        (genre, energy, track_id),
    )
    conn.commit()


def mark_deleted(conn, track_id):
    conn.execute("UPDATE tracks SET status = 'deleted' WHERE id = ?", (track_id,))
    conn.commit()


def delete_tracks_under_folder(conn, folder):
    # Prefix-match in Python rather than SQL LIKE: a track's path is always
    # a file (never equal to the folder itself), and LIKE's wildcard chars
    # (%, _) would misbehave on folder names that happen to contain them.
    # The trailing separator prevents "/Music" from matching "/MusicOld/...".
    folder_norm = str(folder).rstrip("/") + "/"
    rows = conn.execute("SELECT id, path FROM tracks").fetchall()
    matching_ids = [row["id"] for row in rows if row["path"].startswith(folder_norm)]
    if matching_ids:
        placeholders = ",".join("?" for _ in matching_ids)
        conn.execute(f"DELETE FROM tracks WHERE id IN ({placeholders})", matching_ids)
        conn.commit()
    return matching_ids


def get_stats(conn):
    row = conn.execute(
        """
        SELECT
            SUM(CASE WHEN status = 'pending' AND error IS NULL THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
            SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted,
            SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
            COUNT(*) AS total
        FROM tracks
        """
    ).fetchone()
    return dict(row)
