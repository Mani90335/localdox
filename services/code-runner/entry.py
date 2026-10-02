"""Container entry point. Never run arbitrary submissions directly on the host."""
import json
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, "/runner")
from python_trace import trace_python

job = json.load(sys.stdin)
if job["language"] == "python":
    result = trace_python(job["source"], job.get("stdin", ""))
elif job["language"] == "cpp":
    Path("/tmp/main.cpp").write_text(job["source"])
    Path("/tmp/job.json").write_text(json.dumps(job))
    Path("/tmp/stdin.txt").write_text(job.get("stdin", ""))
    Path("/tmp/stdout.txt").touch()
    compiled = subprocess.run(["g++", "-std=c++20", "-O0", "-g", "-fno-omit-frame-pointer", "/tmp/main.cpp", "-o", "/tmp/program"], capture_output=True, text=True, timeout=15)
    if compiled.returncode:
        result = {"version":1,"language":"cpp","source":job["source"],"origin":"execution","notes":[],"steps":[{"line":0,"event":"error","frames":[],"heap":{},"stdout":"","message":compiled.stderr[:4000]}]}
    else:
        subprocess.run(["gdb", "-q", "-batch", "-x", "/runner/cpp_trace.py"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        result = json.loads(Path("/tmp/trace.json").read_text())
else:
    raise ValueError("Unsupported language")
print(json.dumps(result))
