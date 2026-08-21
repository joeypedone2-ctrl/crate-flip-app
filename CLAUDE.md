# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Crate Flip is a working local app, not a skeleton. It scans a folder of
audio files, extracts audio features and produces a heuristic
genre/energy prediction for each track (`analysis.py`), stores results
in SQLite (`db.py`), and serves a swipe-to-review UI (`static/`) over a
FastAPI backend (`main.py`). There is no trained ML model yet — genre
and energy are predicted with a heuristic in `analysis.py`, which the
code itself notes will eventually be replaced by a scikit-learn
classifier trained on accumulated swipe corrections. There is no
automated test suite.

## Environment

A virtualenv exists at `venv/` with all dependencies installed, and
`requirements.txt` is kept in sync via `pip freeze`. Activate it before
running Python/pip commands:

```
source venv/bin/activate
```

If you add a dependency, install it into `venv` and regenerate
`requirements.txt`:

```
source venv/bin/activate && pip install <package> && pip freeze > requirements.txt
```

Audio preview playback (`/tracks/{id}/audio` in `main.py`) shells out
to `ffmpeg` to strip embedded album art and trim intros; it falls back
to serving the original file if `ffmpeg` isn't on `PATH`, so it's a
soft dependency in dev but should be present for full functionality
(`brew install ffmpeg`).

## Common commands

Run the FastAPI dev server directly (auto-reload):

```
source venv/bin/activate && uvicorn main:app --reload
```

Run as a desktop app (native macOS window via pywebview, includes a
real folder picker):

```
source venv/bin/activate && python desktop.py
```

Run as a plain browser app (opens the default browser instead of a
native window):

```
source venv/bin/activate && python browser.py
```

`Launch Crate Flip (Browser).command` is a double-clickable wrapper
around the `browser.py` path, for launching outside a terminal.

Scan a folder from the CLI directly, without the API/UI:

```
source venv/bin/activate && python scan.py <folder> --db crate_flip.db
```

## Architecture

- `main.py` — FastAPI app: routes for scanning, track review
  (confirm/delete), stats, and audio preview serving. `app` is the
  ASGI entrypoint (`main:app`), reused as-is by `desktop.py` and
  `browser.py`.
- `db.py` — SQLite persistence (schema, CRUD) for the `tracks` table.
  No migration framework — schema changes are applied via
  `CREATE TABLE IF NOT EXISTS` plus manual `ALTER TABLE` as needed.
- `scan.py` — walks a folder, diffs against the DB by file
  size/mtime to skip unchanged files, and processes new/changed files
  in parallel via `ProcessPoolExecutor`. Supports progress callbacks
  and cancellation (used by `main.py`'s background scan thread).
- `analysis.py` — per-file feature extraction (librosa/soundfile) and
  the heuristic genre/energy prediction.
- `desktop.py` / `browser.py` — alternate launchers around the same
  `main:app`; `desktop.py` additionally exposes a native folder-picker
  API to the frontend via `window.pywebview.api`.
- `static/` — vanilla HTML/CSS/JS frontend (no build step, no
  framework), served by FastAPI's `StaticFiles` plus a root route that
  returns `static/index.html`.
- `crate_flip.db` — the default SQLite database file (path is
  hardcoded as `DB_PATH` in `main.py`). `test_scan.db` is a scratch
  database produced by manual/ad-hoc `scan.py` runs, not a fixture for
  an automated test suite.
- `.cache/audio/` — transcoded/trimmed audio previews generated
  on-demand by `main.py`, keyed by track id.
