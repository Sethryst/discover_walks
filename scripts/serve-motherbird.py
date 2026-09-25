"""Serve the MotherBird static app with browser-correct JavaScript MIME types."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys


class MotherBirdHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "application/javascript; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
    }


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "motherbird"
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), lambda *args, **kwargs: MotherBirdHandler(*args, directory=str(root), **kwargs))
    print(f"Serving {root} on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
