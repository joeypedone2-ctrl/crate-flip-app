# Crate Flip

A tool that helps DJs organize massive, messy music libraries.

## The problem

DJs end up with thousands of audio files collected over years —
duplicates, half-labeled tracks, no easy way to know what's what
without opening and listening to each one.

## What it does

Crate Flip scans a folder of audio files and uses a machine learning
model to:
- Classify each track into an EDM subgenre
- Estimate its energy level

You then review predictions through a simple swipe interface (like a
dating app) — swipe to confirm, swipe to edit, or swipe to delete.
Turns a tedious manual sort into a fast review process.

## Status

🚧 Early / actively building. Built from close to zero prior coding
experience — a hands-on way to learn how technical products actually
get made, beyond the analyst seat.

## Tech stack

- **Backend** — [FastAPI](https://fastapi.tiangolo.com/) served by
  Uvicorn, with Pydantic for data validation
- **Database** — SQLite (via Python's built-in `sqlite3`)
- **Audio analysis** — librosa, soundfile/soxr, and NumPy/SciPy for
  feature extraction; predictions are currently a heuristic bootstrap,
  soon to be replaced by a scikit-learn classifier trained on swipe
  corrections
- **Frontend** — vanilla HTML/CSS/JS (no framework), served as static
  files by the backend
- **Desktop app** — [pywebview](https://pywebview.flowrl.com/) wraps
  the FastAPI app in a native macOS window (PyObjC bindings), with a
  plain-browser launcher as an alternative
- **File handling** — Send2Trash for safe deletion

## Why I built this

I like finding the faster, smarter way to do something. This project
started as a personal need — thousands of unsorted tracks — and
turned into a way to learn the technical side of building a product,
end to end.
