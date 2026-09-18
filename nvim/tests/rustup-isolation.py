import http.server
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading

requests = []


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        requests.append(self.path)
        self.send_error(404)

    def log_message(self, *_args):
        return


with tempfile.TemporaryDirectory(prefix="rustup-isolation-") as directory:
    root = pathlib.Path(directory)
    project = root / "project"
    project.mkdir()
    (root / "rust-toolchain.toml").write_text('[toolchain]\nchannel = "1.97.0"\n')
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        env = dict(os.environ)
        env.pop("RUSTUP_TOOLCHAIN", None)
        env.update({
            "RUSTUP_HOME": str(root / "rustup"),
            "CARGO_HOME": str(root / "cargo"),
            "RUSTUP_DIST_SERVER": "http://127.0.0.1:" + str(server.server_port),
            "RUSTUP_UPDATE_ROOT": "http://127.0.0.1:" + str(server.server_port),
            "NO_PROXY": "127.0.0.1",
            "no_proxy": "127.0.0.1",
        })
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            env.pop(name, None)
        env["RUSTUP_AUTO_INSTALL"] = "0"
        result = subprocess.run([sys.argv[1], "--version"], cwd=project, env=env, capture_output=True, text=True, timeout=15)
        assert result.returncode != 0
        assert "is not installed" in result.stderr
        assert not requests, "Disabled rustup attempted a download"
        env["RUSTUP_AUTO_INSTALL"] = "1"
        control = subprocess.run([sys.argv[1], "--version"], cwd=project, env=env, capture_output=True, text=True, timeout=15)
        assert control.returncode != 0
        assert requests, "Positive control did not reach the local download observer"
        print(json.dumps({"disabled_download_requests": 0, "positive_control_requests": len(requests)}))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
