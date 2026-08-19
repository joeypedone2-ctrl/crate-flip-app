"""Phase 2: walk a folder of audio files, index them in SQLite, and run
feature extraction + heuristic prediction across all of them in parallel.

Workers only do CPU-bound feature extraction and return results to the
main process, which does all SQLite writes sequentially — avoids any
multi-process SQLite write contention.
"""

import argparse
import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import db
from analysis import analyze

AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".aiff", ".aif", ".m4a"}


def discover_audio_files(folder):
    for path in Path(folder).rglob("*"):
        if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS:
            yield path


def _worker(path_str):
    try:
        result = analyze(path_str)
        return path_str, result, None
    except Exception as exc:  # noqa: BLE001 - surface any per-file decode/analysis failure without killing the batch
        return path_str, None, str(exc)


def scan(folder, db_path, limit=None, workers=None):
    workers = workers or os.cpu_count() or 4
    discovered = list(discover_audio_files(folder))
    print(f"Found {len(discovered)} audio files under {folder}")

    to_process = []
    with db.connect(db_path) as conn:
        for path in discovered:
            stat = path.stat()
            path_str = str(path)
            if db.needs_processing(conn, path_str, stat.st_size, stat.st_mtime):
                db.upsert_pending(conn, path_str, stat.st_size, stat.st_mtime)
                to_process.append(path_str)
        conn.commit()

    print(f"{len(to_process)} new or changed files to process")
    if limit is not None:
        to_process = to_process[:limit]
        print(f"Limiting this run to {len(to_process)} files")

    if not to_process:
        return

    start = time.perf_counter()
    processed, errors = 0, 0
    with db.connect(db_path) as conn:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_worker, p): p for p in to_process}
            for future in as_completed(futures):
                path_str, result, error = future.result()
                now = time.time()
                if error is not None:
                    db.save_error(conn, path_str, error, now)
                    errors += 1
                    print(f"  ERROR  {path_str}: {error}")
                else:
                    db.save_result(
                        conn, path_str, result["features"], result["genre"], result["energy"], now
                    )
                processed += 1
                if processed % 10 == 0 or processed == len(to_process):
                    conn.commit()
                    print(f"  {processed}/{len(to_process)} processed ({errors} errors)")
        conn.commit()

    elapsed = time.perf_counter() - start
    print(
        f"Done in {elapsed:.1f}s "
        f"({elapsed / max(processed, 1):.2f}s/file avg wall time, {workers} workers)"
    )


def main():
    parser = argparse.ArgumentParser(description="Scan a folder of audio files into the local index (Phase 2)")
    parser.add_argument("folder", help="Folder to scan recursively")
    parser.add_argument("--db", default="crate_flip.db", help="SQLite database path")
    parser.add_argument("--limit", type=int, default=None, help="Only process this many new/changed files")
    parser.add_argument("--workers", type=int, default=None, help="Parallel worker processes (default: CPU count)")
    args = parser.parse_args()

    scan(args.folder, args.db, limit=args.limit, workers=args.workers)


if __name__ == "__main__":
    main()
