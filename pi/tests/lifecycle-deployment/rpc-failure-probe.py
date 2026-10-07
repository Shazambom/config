"""Bounded RPC subprocess IO. jq parses records; no model or SDK dependency."""
import select
import subprocess
import sys
import time
from pathlib import Path

run = Path(sys.argv[1])
with (run / "stdout.txt").open("wb") as output, (run / "stderr.txt").open("wb") as errors:
    process = subprocess.Popen(
        sys.argv[2:], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=errors, bufsize=0,
    )
    try:
        process.stdin.write((run / "prompt.jsonl").read_bytes())
        process.stdin.flush()
        deadline = time.monotonic() + 15
        settled = False
        while time.monotonic() < deadline:
            if not select.select([process.stdout], [], [], 0.1)[0]:
                if process.poll() is not None:
                    break
                continue
            line = process.stdout.readline()
            if not line:
                break
            output.write(line)
            output.flush()
            if subprocess.run(
                ["jq", "-e", '.type == "agent_settled"'], input=line,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            ).returncode == 0:
                settled = True
                break
        process.stdin.close()
        try:
            result = process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            result = 124
        (run / "settled.txt").write_text(str(settled) + "\n")
        sys.exit(result if settled else 124)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
