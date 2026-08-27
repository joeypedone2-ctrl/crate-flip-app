"""SQLite persistence for the local track index."""

import sqlite3
import time
import uuid
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
    processed_at REAL,
    checked_out_at REAL,
    checkout_batch_id TEXT
);
"""

# Columns added after the initial release — applied via ALTER TABLE for
# existing databases (CREATE TABLE IF NOT EXISTS above only covers a fresh
# one). Each entry is (column_name, column_ddl_type).
_MIGRATED_COLUMNS = [
    ("checked_out_at", "REAL"),
    ("checkout_batch_id", "TEXT"),
]


def _ensure_columns(conn):
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(tracks)").fetchall()}
    for name, ddl_type in _MIGRATED_COLUMNS:
        if name not in existing:
            conn.execute(f"ALTER TABLE tracks ADD COLUMN {name} {ddl_type}")


@contextmanager
def connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute(SCHEMA)
        _ensure_columns(conn)
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
    # checked_out_at IS NULL excludes tracks currently out on a mobile batch —
    # otherwise the desktop queue and a phone session could hand out the same
    # track to review twice.
    return conn.execute(
        """
        SELECT * FROM tracks
        WHERE status = 'pending' AND error IS NULL AND checked_out_at IS NULL AND id > ?
        ORDER BY id LIMIT 1
        """,
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


def get_all_tracks(conn):
    return conn.execute("SELECT * FROM tracks ORDER BY id").fetchall()


def sweep_expired_checkouts(conn, expiry_sec):
    # A phone batch that's checked out but never synced back (app deleted,
    # phone lost, session abandoned) would otherwise lock those tracks out of
    # the desktop queue forever. Run this before every checkout so orphans
    # get reclaimed automatically instead of needing manual cleanup.
    cutoff = time.time() - expiry_sec
    conn.execute(
        """
        UPDATE tracks SET checked_out_at = NULL, checkout_batch_id = NULL
        WHERE checked_out_at IS NOT NULL AND checked_out_at < ?
        """,
        (cutoff,),
    )
    conn.commit()


def checkout_batch(conn, size):
    candidate_ids = [
        row["id"]
        for row in conn.execute(
            """
            SELECT id FROM tracks
            WHERE status = 'pending' AND error IS NULL AND checked_out_at IS NULL
            ORDER BY id LIMIT ?
            """,
            (size,),
        ).fetchall()
    ]
    if not candidate_ids:
        return None, []

    batch_id = uuid.uuid4().hex
    now = time.time()
    placeholders = ",".join("?" for _ in candidate_ids)
    conn.execute(
        f"UPDATE tracks SET checked_out_at = ?, checkout_batch_id = ? WHERE id IN ({placeholders})",
        (now, batch_id, *candidate_ids),
    )
    conn.commit()
    return batch_id, get_batch_tracks(conn, batch_id)


def get_batch_tracks(conn, batch_id):
    return conn.execute(
        "SELECT * FROM tracks WHERE checkout_batch_id = ? ORDER BY id", (batch_id,)
    ).fetchall()


def release_checkout(conn, track_id):
    conn.execute(
        "UPDATE tracks SET checked_out_at = NULL, checkout_batch_id = NULL WHERE id = ?",
        (track_id,),
    )
    conn.commit()


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
