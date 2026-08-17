# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is an early-stage FastAPI skeleton. There is a single application file (`main.py`) with one route. No models, database, tests, or dependency manifest exist yet.

## Environment

A virtualenv already exists at `venv/` with FastAPI, Uvicorn, and Pydantic installed. There is no `requirements.txt` — if you add dependencies, install them into `venv` and create a `requirements.txt` (via `pip freeze`) so the environment is reproducible.

Activate the environment before running Python/pip commands:

```
source venv/bin/activate
```

## Common commands

Run the dev server (auto-reload):

```
source venv/bin/activate && uvicorn main:app --reload
```

The app is a single `FastAPI()` instance named `app` in `main.py`, so `main:app` is the entrypoint for both `uvicorn` and any future ASGI deployment config.
