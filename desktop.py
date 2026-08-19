"""Launches Crate Flip as a desktop window: runs the FastAPI backend in a
background thread and displays the swipe UI in a native WKWebView window
via pywebview, instead of a browser tab.
"""

import threading

import uvicorn
import webview

from main import app

HOST = "127.0.0.1"
PORT = 8756


def _run_server():
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="warning")
    uvicorn.Server(config).run()


class Api:
    """Exposed to the page as window.pywebview.api — lets the UI trigger a
    native folder picker, which browsers can never do (they don't expose
    real filesystem paths to JavaScript)."""

    def choose_folder(self):
        result = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        return result[0] if result else None


def main():
    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()

    webview.create_window(
        "Crate Flip", f"http://{HOST}:{PORT}", width=560, height=820, js_api=Api()
    )
    webview.start()


if __name__ == "__main__":
    main()
