"""Launches Crate Flip as a plain web app: runs the FastAPI backend and
opens it in your default browser, instead of the native desktop window.
"""

import threading
import time
import webbrowser

import uvicorn

from main import app

HOST = "127.0.0.1"
PORT = 8756


def _open_browser():
    time.sleep(1)
    webbrowser.open(f"http://{HOST}:{PORT}")


def main():
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
