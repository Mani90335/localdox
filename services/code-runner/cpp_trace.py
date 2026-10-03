"""Invoked by GDB's Python interpreter inside a disposable container."""
import gdb
import json
import re

job = json.load(open("/tmp/job.json"))
steps = []


def user_frame(frame):
    name = frame.name() or ""
    return not re.match(r"^(?:_GLOBAL__sub_I_|__static_initialization_and_destruction_|__cxx_global_var_init|std::|__gnu_cxx::)", name)
gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set print elements 200")
gdb.execute("set max-value-size 65536")
gdb.execute("set breakpoint pending off")
gdb.execute("file /tmp/program")


def snapshot(event="before", message=None):
    heap = {}

    def encode(value, depth=0):
        try:
            typ = value.type.strip_typedefs()
            if value.is_optimized_out:
                return {"special": "Optimized out"}
            if typ.code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_ENUM, gdb.TYPE_CODE_BOOL):
                number = int(value)
                return number if abs(number) <= 9007199254740991 else {"special": str(number)}
            if typ.code == gdb.TYPE_CODE_FLT:
                number = float(value)
                import math
                return number if math.isfinite(number) else {"special": str(number)}
            if typ.code == gdb.TYPE_CODE_PTR:
                if int(value) == 0:
                    return None
                return encode(value.dereference(), depth+1)
            if typ.code in (gdb.TYPE_CODE_REF, gdb.TYPE_CODE_RVALUE_REF):
                return encode(value.referenced_value(), depth+1)
            ident = str(value.address) if value.address else f"value-{len(heap)}"
            if ident in heap:
                return {"ref": ident}
            if len(heap) >= 100 or depth >= 8:
                return {"special": "Object hidden (snapshot limit)"}
            node = {"type": str(typ)[:200], "entries": []}
            heap[ident] = node
            printer = gdb.default_visualizer(value)
            if printer and hasattr(printer, "children"):
                entries = printer.children()
            elif typ.code == gdb.TYPE_CODE_ARRAY:
                low, high = typ.range()
                entries = ((str(i), value[i]) for i in range(low, min(high+1, low+201)))
                node["truncated"] = high-low+1 > 200
            elif typ.code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
                entries = ((field.name, value[field]) for field in typ.fields() if field.name and not field.is_base_class)
            else:
                return {"special": str(value)[:2000]}
            for i, (key, item) in enumerate(entries):
                if i >= 200:
                    node["truncated"] = True
                    break
                node["entries"].append([str(key)[:2000], encode(item, depth+1)])
            return {"ref": ident}
        except Exception:
            return {"special": "Unavailable or invalid address"}

    frames = []
    frame = gdb.newest_frame()
    while frame and len(frames) < 100:
        sal = frame.find_sal()
        if sal.symtab and sal.symtab.fullname() == "/tmp/main.cpp" and user_frame(frame):
            values = {}
            block = frame.block()
            while block:
                for symbol in block:
                    if (symbol.is_argument or symbol.is_variable) and symbol.name not in values and len(values) < 100:
                        # Static blocks also contain symbols from included C++ headers.
                        if symbol.symtab and symbol.symtab.fullname() != "/tmp/main.cpp":
                            continue
                        if not symbol.is_argument and symbol.line >= sal.line:
                            continue
                        try:
                            values[symbol.name] = encode(frame.read_var(symbol))
                        except Exception:
                            values[symbol.name] = {"special": "Unavailable"}
                if block.is_global or block.is_static:
                    break
                block = block.superblock
            frames.append({"id": str(frame.read_register("sp")), "name": frame.name() or "anonymous", "locals": values})
        frame = frame.older()
    stdout = open("/tmp/stdout.txt", errors="replace").read(20000)
    sal = gdb.newest_frame().find_sal()
    step = {"line": max(0, sal.line), "event": event, "frames": list(reversed(frames)), "heap": heap, "stdout": stdout}
    if message:
        step["message"] = message[:4000]
    steps.append(step)


for line in range(1, len(job["source"].splitlines())+1):
    try:
        gdb.Breakpoint(f"/tmp/main.cpp:{line}", internal=True)
    except gdb.error:
        pass

try:
    gdb.execute("run < /tmp/stdin.txt > /tmp/stdout.txt 2>&1", to_string=True)
    while gdb.selected_inferior().pid and len(steps) < 2000:
        if user_frame(gdb.newest_frame()):
            snapshot()
        # Signal stops are distinct from source breakpoints.
        reason = gdb.execute("info program", to_string=True)
        if "signal" in reason.lower():
            if not steps:
                snapshot()
            steps[-1]["event"] = "error"
            steps[-1]["message"] = reason[:4000]
            break
        gdb.execute("continue", to_string=True)
    if len(steps) >= 2000:
        steps[-1]["event"] = "limit"
        steps[-1]["message"] = "Stopped at 2,000 source breakpoints."
    elif steps and steps[-1]["event"] != "error":
        final = dict(steps[-1], event="end", stdout=open("/tmp/stdout.txt", errors="replace").read(20000))
        final["message"] = "Program exited. Memory is the last captured source breakpoint, before stack teardown."
        steps.append(final)
except Exception as error:
    if steps:
        steps[-1]["event"] = "error"
        steps[-1]["message"] = str(error)[:4000]
    else:
        steps.append({"line":0,"event":"error","frames":[],"heap":{},"stdout":"","message":str(error)[:4000]})

result = {"version":1,"language":"cpp","source":job["source"],"origin":"execution","steps":steps,
          "notes":["GDB source breakpoints from C++20 compiled with -O0 -g. CPU activity is a teaching model.",
                   "Variables at their declaration are marked uninitialized. Undefined behavior cannot be interpreted reliably. Native internals, threads, and individual machine instructions are not traced.",
                   "STL pretty-printer children are shown when available. Snapshot limits: 100 objects, 200 entries, depth 8."]}
with open("/tmp/trace.json", "w") as target:
    json.dump(result, target)
