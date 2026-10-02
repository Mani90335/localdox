"""Source-level snapshots; execution isolation is provided by the container, not exec()."""
import contextlib
import io
import json
import math
import sys
import types


class TraceLimit(BaseException):
    pass


class Output(io.StringIO):
    def write(self, text):
        if self.tell() + len(text) > 20000:
            raise TraceLimit("Output limit: 20,000 characters.")
        return super().write(text)


def trace_python(source, stdin=""):
    steps, identities, retained, frame_ids, retained_frames = [], {}, [], {}, []
    output = Output()
    namespace = {"__name__": "__main__"}
    last_frame = None

    def capture(frame, event, message=None, returned=None):
        heap = {}

        def encode(value, depth=0):
            kind = type(value)
            if value is None or kind is bool:
                return value
            if kind is str:
                return value if len(value) <= 2000 else {"special": value[:1980] + "… (truncated)"}
            if kind is int:
                return value if abs(value) <= 9007199254740991 else {"special": str(value)[:2000]}
            if kind is float:
                return value if math.isfinite(value) else {"special": str(value)}
            if kind in (types.FunctionType, types.BuiltinFunctionType, types.ModuleType, type):
                return {"special": f"{kind.__name__}: {getattr(value, '__name__', '')}"[:2000]}
            address = id(value)
            if address not in identities:
                identities[address] = str(len(identities) + 1)
                retained.append(value)  # Prevent ID reuse during the recording.
            ident = identities[address]
            if ident in heap:
                return {"ref": ident}
            if len(heap) >= 100 or depth >= 8:
                return {"special": "Object hidden (snapshot limit)"}
            node = {"type": kind.__name__, "entries": []}
            heap[ident] = node
            try:
                if kind in (list, tuple, set, frozenset):
                    entries = enumerate(value)
                elif kind is dict:
                    entries = value.items() if all(type(key) is str for key in value) else (
                        pair for i, (key, item) in enumerate(value.items())
                        for pair in ((f"key {i}", key), (f"value {i}", item)))
                elif kind.__module__ == "collections" and kind.__name__ == "deque":
                    entries = enumerate(value)
                else:
                    # Read instance storage; never call repr(), properties, or user getters.
                    entries = object.__getattribute__(value, "__dict__").items()
                for i, (key, item) in enumerate(entries):
                    if i == 200:
                        node["truncated"] = True
                        break
                    label = str(key)[:2000] if type(key) in (str, int, float, bool) else f"key {i} ({type(key).__name__})"
                    node["entries"].append([label, encode(item, depth + 1)])
            except (AttributeError, TypeError):
                node["entries"] = [["inspection", {"special": "Opaque value; internal fields unavailable"}]]
            return {"ref": ident}

        chain = []
        current = frame
        while current:
            if current.f_code.co_filename == "main.py":
                chain.append(current)
            current = current.f_back
        frames = []
        for current in reversed(chain[-100:]):
            if id(current) not in frame_ids:
                frame_ids[id(current)] = str(len(frame_ids))
                retained_frames.append(current)
            values = current.f_locals
            frames.append({"id": frame_ids[id(current)], "name": "Global" if current.f_code.co_name == "<module>" else current.f_code.co_name,
                           "locals": {name: encode(value) for name, value in list(values.items())[:100] if not name.startswith("__")}})
        if not frames:
            frames = [{"id": "0", "name": "Global", "locals": {name: encode(value) for name, value in namespace.items() if not name.startswith("__")}}]
        if event == "return" and frames:
            frames[-1]["locals"]["Return value"] = encode(returned)
        step = {"line": frame.f_lineno if frame else 0, "event": event, "frames": frames, "heap": heap, "stdout": output.getvalue()}
        if message:
            step["message"] = message[:4000]
        steps.append(step)

    def tracer(frame, event, arg):
        nonlocal last_frame
        if frame.f_code.co_filename != "main.py":
            return None
        last_frame = frame
        if len(steps) >= 2000:
            raise TraceLimit("Stopped at 2,000 trace steps. Try a smaller input.")
        if event in ("line", "call", "return"):
            capture(frame, {"line": "before", "call": "call", "return": "return"}[event], returned=arg)
        return tracer

    old_stdin = sys.stdin
    try:
        compiled = compile(source, "main.py", "exec")
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            sys.stdin = io.StringIO(stdin)
            sys.settrace(tracer)
            try:
                exec(compiled, namespace)
            finally:
                sys.settrace(None)
        capture(last_frame, "end")
    except BaseException as error:
        sys.settrace(None)
        capture(last_frame, "limit" if isinstance(error, TraceLimit) else "error", f"{type(error).__name__}: {error}")
        if isinstance(error, SyntaxError):
            steps[-1]["line"] = error.lineno or 0
    finally:
        sys.stdin = old_stdin
    return {"version": 1, "language": "python", "source": source, "origin": "execution", "steps": steps,
            "notes": ["CPython source-level snapshots. CPU stages are an educational model, not hardware telemetry.",
                      "Snapshots show up to 100 objects, 100 variables per frame, 200 entries per object, and depth 8. Native-library internals are opaque."]}


if __name__ == "__main__":
    job = json.load(sys.stdin)
    print(json.dumps(trace_python(job["source"], job.get("stdin", "")), ensure_ascii=True))
