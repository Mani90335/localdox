"""Loopback development gateway: each submission gets a new restricted container."""
import json
import os
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGINS = {origin.strip() for origin in os.environ.get("CODE_RUNNER_ORIGIN", "http://127.0.0.1:4175").split(",") if origin.strip()}
PORT = int(os.environ.get("CODE_RUNNER_PORT", "4318"))
IMAGE = "localdox-code-runner:1"
slots = threading.BoundedSemaphore(2)


def run_container(job):
    name = "localdox-trace-" + uuid.uuid4().hex
    args = ["docker", "run", "--rm", "-i", "--name", name, "--network", "none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=256m", "--memory-swap=256m", "--cpus=1", "--ulimit", "cpu=15:15", "--ulimit", "fsize=16777216:16777216", "--tmpfs", "/tmp:rw,exec,nosuid,size=64m", IMAGE]
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    chunks, total, oversized = [], [0], threading.Event()

    def read_output():
        while data := process.stdout.read(65536):
            total[0] += len(data)
            if total[0] > 16000000:
                oversized.set()
                return
            chunks.append(data)

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    try:
        process.stdin.write(json.dumps(job).encode())
        process.stdin.close()
        deadline = time.monotonic() + 25
        while process.poll() is None:
            if oversized.is_set():
                raise ValueError("Trace exceeded 16 MB. Use a smaller input.")
            if time.monotonic() > deadline:
                raise TimeoutError("Stopped after 25 seconds. Check for infinite loops or reduce the input.")
            time.sleep(.05)
        reader.join(timeout=2)
        if oversized.is_set():
            raise ValueError("Trace exceeded 16 MB.")
        output = b"".join(chunks)
        if process.returncode:
            raise RuntimeError("The isolated runner failed. Ensure the Docker image is built and Docker is running. " + output.decode(errors="replace")[-1000:])
        result = json.loads(output)
        if result.get("version") != 1 or not isinstance(result.get("steps"), list) or not result["steps"] or len(result["steps"]) > 2002:
            raise ValueError("The isolated process returned an invalid trace.")
        return output
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        reader.join(timeout=2)
        process.stdout.close()
        if not process.stdin.closed:
            process.stdin.close()


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data, content_type="text/plain"):
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        if self.headers.get("Origin") in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        if self.headers.get("Origin") not in ORIGINS:
            return self.reply(403, b"Origin not allowed.")
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path != "/trace":
            return self.reply(404, b"Not found.")
        if self.headers.get("Origin") not in ORIGINS:
            return self.reply(403, b"Origin not allowed.")
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.reply(415, b"Expected application/json.")
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 250000:
                return self.reply(413, b"Submission exceeds the request limit.")
            self.connection.settimeout(10)
            job = json.loads(self.rfile.read(size))
            if job.get("language") not in ("python", "cpp") or not isinstance(job.get("source"), str) or not 0 < len(job["source"]) <= 50000 or not isinstance(job.get("stdin", ""), str) or len(job.get("stdin", "")) > 20000:
                return self.reply(400, b"Invalid language, source, or input.")
        except (ValueError, AttributeError, TimeoutError):
            return self.reply(400, b"Invalid request.")
        if not slots.acquire(blocking=False):
            return self.reply(429, b"Both execution slots are busy. Try again shortly.")
        try:
            self.reply(200, run_container(job), "application/json")
        except Exception as error:
            self.reply(422, str(error).encode()[:2000])
        finally:
            slots.release()


if __name__ == "__main__":
    print(f"Code runner listening on http://127.0.0.1:{PORT}; allowed origins: {', '.join(sorted(ORIGINS))}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
