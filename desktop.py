"""Launches Crate Flip as a desktop window: runs the FastAPI backend in a
background thread and displays the swipe UI in a native WKWebView window
via pywebview, instead of a browser tab.
"""

import os
import sys
import threading

import uvicorn
import webview

from main import app

HOST = "127.0.0.1"
PORT = 8756

SERVER = uvicorn.Server(uvicorn.Config(app, host=HOST, port=PORT, log_level="warning"))


def _enable_click_through_activation():
    # macOS windows consume their first click after becoming active just to
    # focus the window — it never reaches the control underneath. WKWebView
    # doesn't opt out of that default, so every toolbar button needs two
    # clicks right after switching to the app. Patch NSView itself to accept
    # the first click everywhere in this app's window.
    if sys.platform != "darwin":
        return
    import objc
    from AppKit import NSView

    def acceptsFirstMouse_(self, event):
        return True

    method = objc.selector(acceptsFirstMouse_, selector=b"acceptsFirstMouse:", signature=b"B@:@")
    objc.classAddMethod(NSView, b"acceptsFirstMouse:", method)


def _run_server():
    SERVER.run()


class Api:
    """Exposed to the page as window.pywebview.api — lets the UI trigger a
    native folder picker, which browsers can never do (they don't expose
    real filesystem paths to JavaScript)."""

    def choose_folder(self):
        result = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        return result[0] if result else None


def _on_closing():
    # Runs synchronously on the UI thread before the window actually closes.
    # Triggers the FastAPI lifespan shutdown (which cancels any in-progress
    # scan) and waits for the server to wind down, so we never leave a scan's
    # worker processes running headless after the window is gone.
    SERVER.should_exit = True


def main():
    _enable_click_through_activation()

    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()

    window = webview.create_window(
        "Crate Flip", f"http://{HOST}:{PORT}", width=560, height=820, js_api=Api()
    )
    window.events.closing += _on_closing
    webview.start()

    server_thread.join(timeout=20)
    # Belt-and-suspenders: if a scan's worker processes are still winding
    # down past the timeout above, don't let this window hang around waiting
    # on them — force the whole process (and its now-orphaned children) down.
    os._exit(0)


if __name__ == "__main__":
    main()
