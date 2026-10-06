"""Check Localdox exam files (.xrule, .xam, .xp) before delivering them.

Usage (code interpreter):
    python localdox_check.py file1.xrule file1.xam set.xp ...      check files
    python localdox_check.py --build DIR OUT.json "Workspace name" check every file under DIR,
                                                                    then pack DIR as a workspace backup
From Python: check_files([...]) and build_workspace(dir, out, name).

Mirrors the rules Localdox's importers enforce (src/services/exams/*.ts) and
errs on the strict side: whatever passes here imports. Standard library only.
"""
import json
import re
import sys
from pathlib import Path

ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")  # the app also allows dots, but a dot breaks directive ids
NUM = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
DIFFICULTY = {"easy", "medium", "hard"}
OPEN = re.compile(r"^(:{3,})(question|solution)\{(.*)\}\s*$")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
BULLET = re.compile(r"^( {0,3})([-*+])(?: +|$)")
ORDERED = re.compile(r"^( {0,3})(\d{1,9})([.)])(?: +|$)")
HEADING = re.compile(r"^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$")
ATTR = re.compile(r'\s*(?:#([^\s}"=]+)|\.([^\s}"=]+)|([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'=<>`}]+)))?)')

XRULE_KEYS = {"xrule", "name", "summary", "preset", "rules", "durationMinutes", "questionCount",
              "passPercentage", "maxAttempts", "mcqPenalty", "calculator"}
RULES_KEYS = {
    "": {"schemaVersion", "sampleMode", "meta", "timing", "sections", "questionTypes", "navigation",
         "tools", "integrity", "results", "attempts", "progression", "diagnostics", "ui"},
    "meta": {"id", "name", "version", "instructionsMd"},
    "timing": {"mode", "durationMinutes", "autoSubmitOnExpiry", "pausable", "warnAtMinutesLeft"},
    "questionTypes": {"mcq", "msq", "nat"},
    "questionTypes.mcq": {"optionCount", "selection", "negativeMarking"},
    "questionTypes.msq": {"optionCount", "selection", "scoring", "negativeMarking"},
    "questionTypes.nat": {"inputMode", "negativeMarking"},
    "navigation": {"free", "sectionLocking", "markForReview", "markedForReviewAnswerCounts",
                   "clearResponse", "requireSave", "shuffleQuestions", "shuffleOptions"},
    "tools": {"calculator"},
    "integrity": {"requireFullscreen", "maxTabSwitches", "onViolation", "blockCopyPaste", "blockContextMenu"},
    "results": {"scoreVisibility", "solutionsRelease", "releaseAt", "showSectionBreakdown",
                "showTimePerQuestion", "rounding"},
    "attempts": {"max", "resumeInterrupted"},
    "progression": {"passPercentage", "rewriteDifficultyPercentage", "difficultyLabel"},
    "ui": {"profile", "kind"},
}
GATE_SECTIONS = [("GA", 10, {1: 5, 2: 5}), ("subject", 55, {1: 25, 2: 30})]


def _int(v, lo, hi):
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


# ── .xrule ──────────────────────────────────────────────────────────────────

def check_xrule(text, name="exam.xrule"):
    """Return (setup, errors). setup is a dict the paper check uses."""
    errors = []
    err = lambda m: errors.append(f"{name}: {m}")
    try:
        f = json.loads(text)
    except json.JSONDecodeError as e:
        return None, [f"{name}: invalid JSON ({e})"]
    if not isinstance(f, dict):
        return None, [f"{name}: must be a JSON object"]
    for k in f:
        if k not in XRULE_KEYS:
            err(f'unknown field "{k}"')
    if f.get("xrule") != 1:
        err('"xrule" must be 1')
    if not isinstance(f.get("name"), str) or not 1 <= len(f["name"].strip()) <= 160:
        err('"name" is required, 1-160 characters')
    if "summary" in f and (not isinstance(f["summary"], str) or len(f["summary"]) > 20000):
        err('"summary" must be a string up to 20000 characters')
    checks = {"durationMinutes": lambda v: _int(v, 1, 600), "questionCount": lambda v: _int(v, 1, 500),
              "passPercentage": lambda v: _num(v, 0, 100), "maxAttempts": lambda v: _int(v, 1, 20),
              "mcqPenalty": lambda v: v in ("none", "third", "quarter"),
              "calculator": lambda v: v in ("none", "basic", "scientific"), "preset": lambda v: v == "gate"}
    for k, ok in checks.items():
        if k in f and not ok(f[k]):
            err(f'"{k}" has an invalid value: {f[k]!r}')
    preset, rules = f.get("preset"), f.get("rules")
    if preset and rules is not None:
        err('use "preset" or "rules", not both')
    if (preset or rules is not None) and ("mcqPenalty" in f or "calculator" in f):
        err('"mcqPenalty"/"calculator" only apply without preset or rules; set them inside rules')
    setup = {"questionCount": f.get("questionCount"), "sections": None, "types": {"mcq": None, "msq": None, "nat": None},
             "rewritePct": 50, "rewriteLabel": "hard", "composition": False}
    if preset == "gate":
        setup["types"] = {"mcq": 4, "msq": 4, "nat": None}
        if setup["questionCount"] is None:
            setup["questionCount"] = 65
        if setup["questionCount"] == 65:
            setup["sections"] = [(s, n) for s, n, _ in GATE_SECTIONS]
            setup["composition"] = {s: c for s, _, c in GATE_SECTIONS}
    if rules is not None:
        errors += [f"{name}: rules{('.' + p) if p else ''}: {m}" for p, m in _check_rules(rules)]
        if isinstance(rules, dict) and isinstance(rules.get("sections"), list):
            secs = [(s.get("id"), s.get("questionCount")) for s in rules["sections"] if isinstance(s, dict)]
            total = sum(n for _, n in secs if isinstance(n, int))
            if setup["questionCount"] is None:
                setup["questionCount"] = total
            if setup["questionCount"] == total:
                setup["sections"] = secs
                comp = {s.get("id"): {c.get("marks"): c.get("count") for c in s.get("composition", [])}
                        for s in rules["sections"] if isinstance(s, dict) and s.get("composition")}
                setup["composition"] = comp or False
            qt = rules.get("questionTypes") if isinstance(rules.get("questionTypes"), dict) else {}
            setup["types"] = {t: None for t in qt}
            if isinstance(qt.get("mcq"), dict):
                setup["types"]["mcq"] = qt["mcq"].get("optionCount", 4)
            if isinstance(qt.get("msq"), dict):
                setup["types"]["msq"] = qt["msq"].get("optionCount")
            prog = rules.get("progression") if isinstance(rules.get("progression"), dict) else {}
            setup["rewritePct"] = prog.get("rewriteDifficultyPercentage", 50)
            setup["rewriteLabel"] = prog.get("difficultyLabel", "hard")
    return (None if errors else setup), errors


def _check_rules(r):
    out = []
    if not isinstance(r, dict):
        return [("", "must be an object")]

    def keys(path, obj):
        if not isinstance(obj, dict):
            out.append((path, "must be an object"))
            return False
        for k in obj:
            if k not in RULES_KEYS[path]:
                out.append((path, f'unknown field "{k}"'))
        return True

    keys("", r)
    if r.get("schemaVersion") != 2:
        out.append(("schemaVersion", "must be 2"))
    for req in ("meta", "timing", "sections", "questionTypes"):
        if req not in r:
            out.append((req, "required"))
    if "meta" in r and keys("meta", r["meta"]):
        m = r["meta"]
        if not (isinstance(m.get("id"), str) and ID.match(m["id"])):
            out.append(("meta.id", "letters, digits, - and _"))
        for k in ("name", "version"):
            if not (isinstance(m.get(k), str) and m[k]):
                out.append((f"meta.{k}", "required non-empty string"))
    if "timing" in r and keys("timing", r["timing"]):
        t = r["timing"]
        if t.get("mode") not in ("global", "per_section"):
            out.append(("timing.mode", '"global" or "per_section"'))
        if not _num(t.get("durationMinutes"), 1e-9, 1e9):
            out.append(("timing.durationMinutes", "a positive number"))
    secs = r.get("sections")
    if "sections" in r:
        if not isinstance(secs, list) or not secs:
            out.append(("sections", "at least one section"))
        else:
            seen = set()
            for i, s in enumerate(secs):
                p = f"sections.{i}"
                if not isinstance(s, dict):
                    out.append((p, "must be an object"))
                    continue
                for k in s:
                    if k not in {"id", "name", "questionCount", "durationMinutes", "composition"}:
                        out.append((p, f'unknown field "{k}"'))
                if not (isinstance(s.get("id"), str) and ID.match(s["id"])):
                    out.append((p + ".id", "letters, digits, - and _"))
                elif s["id"] in seen:
                    out.append((p + ".id", f"duplicate {s['id']}"))
                seen.add(s.get("id"))
                if not (isinstance(s.get("name"), str) and s["name"]):
                    out.append((p + ".name", "required"))
                if not _int(s.get("questionCount"), 1, 10**6):
                    out.append((p + ".questionCount", "a positive integer"))
                comp = s.get("composition")
                if comp is not None and (not isinstance(comp, list) or sum(c.get("count", 0) for c in comp if isinstance(c, dict)) != s.get("questionCount")):
                    out.append((p + ".composition", "counts must sum to questionCount"))
            t = r.get("timing") if isinstance(r.get("timing"), dict) else {}
            if t.get("mode") == "per_section":
                d = [s.get("durationMinutes") for s in secs if isinstance(s, dict)]
                if any(not _num(x, 1e-9, 1e9) for x in d):
                    out.append(("sections", "per_section timing needs durationMinutes on every section"))
                elif abs(sum(d) - t.get("durationMinutes", 0)) > 1e-6:
                    out.append(("timing.durationMinutes", "must equal the sum of section durations"))
    qt = r.get("questionTypes")
    if "questionTypes" in r and keys("questionTypes", qt):
        if not qt:
            out.append(("questionTypes", "at least one type"))
        for t, cfg in qt.items():
            if t in ("mcq", "msq", "nat") and keys(f"questionTypes.{t}", cfg):
                if "optionCount" in cfg and not _int(cfg["optionCount"], 2, 26):
                    out.append((f"questionTypes.{t}.optionCount", "2-26"))
                nm = cfg.get("negativeMarking")
                if nm is not None and not (
                        isinstance(nm, dict) and (set(nm) == {"marks"} and _num(nm["marks"], 0, 1e9)
                                                  or set(nm) == {"fractionOfMarks"} and isinstance(nm["fractionOfMarks"], list)
                                                  and len(nm["fractionOfMarks"]) == 2)):
                    out.append((f"questionTypes.{t}.negativeMarking", 'null, {"marks": n} or {"fractionOfMarks": [a, b]}'))
                if t == "msq" and cfg.get("scoring", "all_or_nothing") not in ("all_or_nothing", "partial_no_wrong"):
                    out.append(("questionTypes.msq.scoring", '"all_or_nothing" or "partial_no_wrong"'))
                if t == "nat" and cfg.get("inputMode", "keyboard") not in ("virtual_keypad", "keyboard"):
                    out.append(("questionTypes.nat.inputMode", '"virtual_keypad" or "keyboard"'))
    for k in ("navigation", "tools", "integrity", "results", "attempts", "progression", "ui"):
        if k in r:
            keys(k, r[k])
    if isinstance(r.get("tools"), dict) and r["tools"].get("calculator", "none") not in ("none", "basic", "scientific"):
        out.append(("tools.calculator", "none, basic or scientific"))
    if isinstance(r.get("results"), dict) and r["results"].get("scoreVisibility", "immediate") != "immediate":
        out.append(("results.scoreVisibility", 'keep "immediate"'))
    if isinstance(r.get("attempts"), dict) and not _int(r["attempts"].get("max", 1), 1, 10**6):
        out.append(("attempts.max", "a positive integer"))
    if isinstance(r.get("progression"), dict) and r["progression"].get("difficultyLabel", "hard") not in DIFFICULTY:
        out.append(("progression.difficultyLabel", "easy, medium or hard"))
    if isinstance(r.get("ui"), dict):
        if r["ui"].get("profile", "gate") not in ("gate", "jee", "upsc", "generic"):
            out.append(("ui.profile", "gate, jee, upsc or generic"))
        if r["ui"].get("kind", "full") not in ("full", "sectional", "quiz"):
            out.append(("ui.kind", "full, sectional or quiz"))
    d = r.get("diagnostics")
    if d is not None and d != {"enabled": False}:
        out.append(("diagnostics", 'use {"enabled": false}'))
    if r.get("sampleMode"):
        out.append(("sampleMode", "don't use; set the outer questionCount to the paper's real count"))
    return out


# ── .xam / .xp ──────────────────────────────────────────────────────────────

def _attrs(raw):
    """Directive attributes, or an error string."""
    out, pos = {}, 0
    while pos < len(raw):
        if raw[pos:].strip() == "":
            break
        m = ATTR.match(raw, pos)
        if not m or m.end() == pos:
            return f"cannot read attributes near: {raw[pos:pos + 20]!r}"
        pos = m.end()
        if m.group(1):
            out["id"] = m.group(1)
        elif m.group(2):
            return f'".{m.group(2)}" reads as a class: ids must not contain dots'
        else:
            val = next((g for g in m.group(4, 5, 6) if g is not None), "")
            out[m.group(3)] = val
    return out


def _lists(lines):
    """Item counts of the top-level lists in a block body, in order (CommonMark rules:
    a list continues across blank lines while items keep the same marker kind)."""
    lists, kind, blank, fence, math = [], None, False, None, False
    for line in lines:
        f = FENCE.match(line)
        if fence:
            if f and f.group(1)[0] == fence[0] and len(f.group(1)) >= len(fence):
                fence = None
            continue
        if math:
            math = line.strip() != "$$" and not line.rstrip().endswith("$$")
            continue
        if not line.strip():
            blank = True
            continue
        indented = line.startswith("  ") or line.startswith("\t")
        b, o = BULLET.match(line), ORDERED.match(line)
        if (b or o) and not indented:
            k = ("bullet", b.group(2)) if b else ("ordered", o.group(3))
            if k == kind:
                lists[-1] += 1
            else:
                lists.append(1)
                kind = k
        elif indented or (kind and not blank and not f and not line.lstrip().startswith("$$")):
            pass  # an item's continuation, or a lazy line of its paragraph
        else:
            kind = None  # anything else at column 0 ends the list
        if not indented and line.strip().startswith("$$") and line.strip().count("$$") == 1:
            math = True
        if not indented and f:
            fence = f.group(1)
        blank = False
    return lists


def _blocks(text, name):
    """Split a question file into headings and blocks; returns (items, errors)."""
    lines = text.split("\n")
    items, errors, i, start = [], [], 0, 0
    if lines and lines[0].rstrip() == "---":
        for j in range(1, len(lines)):
            if lines[j].rstrip() == "---":
                items.append(("header", lines[1:j], 1))
                start = j + 1
                break
            if lines[j].strip() and not re.match(r"^[A-Za-z][\w-]*[ \t]*:", lines[j]):
                break
    i = start
    while i < len(lines):
        line, ln = lines[i], i + 1
        if not line.strip() or re.match(r"^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$", line):
            i += 1
            continue
        h = HEADING.match(line)
        if h:
            items.append(("heading", (h.group(2) or "").strip(), ln))
            i += 1
            continue
        m = OPEN.match(line)
        if not m:
            errors.append(f"{name}:{ln}: text outside a :::question or :::solution block: {line[:60]!r}")
            i += 1
            while i < len(lines) and lines[i].strip() and not OPEN.match(lines[i]) and not HEADING.match(lines[i]):
                i += 1
            continue
        fence, kind = m.group(1), m.group(2)
        attrs = _attrs(m.group(3))
        body, j, in_code, closed = [], i + 1, None, False
        while j < len(lines):
            l = lines[j]
            f = FENCE.match(l)
            if in_code:
                if f and f.group(1)[0] == in_code[0] and len(f.group(1)) >= len(in_code):
                    in_code = None
            elif f:
                in_code = f.group(1)
            elif re.match(r"^:{3,}\s*$", l) and len(l.strip()) >= len(fence):
                if len(l.strip()) != len(fence):
                    errors.append(f"{name}:{j + 1}: closing fence {l.strip()} does not match opening {fence}")
                closed = True
                break
            elif l.startswith(":::") and OPEN.match(l):
                break
            body.append(l)
            j += 1
        if not closed:
            errors.append(f"{name}:{ln}: block is not closed with ::: alone on a line")
        items.append((kind, attrs, ln, body))
        i = j + 1 if closed else j
    return items, errors


def _check_answer(q, s, loc, errors):
    a, tol = s.get("answer", ""), s.get("tolerance")
    if q["type"] == "nat":
        parts = a.split(":")
        if len(parts) > 2 or not all(NUM.match(p.strip()) for p in parts) or \
                (len(parts) == 2 and (float(parts[0]) > float(parts[1]) or tol is not None)):
            errors.append(f'{loc}: NAT answer must be a decimal or "lo:hi" range (no tolerance with a range): {a!r}')
        if tol is not None and not (NUM.match(tol) and float(tol) >= 0):
            errors.append(f"{loc}: tolerance must be a non-negative number")
    else:
        labels = [chr(65 + k) for k in range(q["options"])]
        answers = [x.strip() for x in a.split(",")]
        if " " in a:
            errors.append(f'{loc}: write MSQ answers without spaces, e.g. answer="A,C"')
        if any(x not in labels for x in answers) or len(set(answers)) != len(answers) \
                or (q["type"] == "mcq" and len(answers) != 1) or tol is not None:
            errors.append(f"{loc}: invalid answer {a!r} for {q['type']} with options {', '.join(labels) or 'none'}")


def check_questions(text, name, setup=None, practice=False):
    """Check an .xam (practice=False, with its .xrule setup) or an .xp. Returns errors."""
    items, errors = _blocks(text, name)
    questions, solutions, ids, in_solutions = [], {}, set(), False
    for it in items:
        if it[0] == "header":
            if practice:
                errors.append(f"{name}:1: practice files have no --- header")
            for k, raw in enumerate(it[1]):
                if raw.strip() and not re.match(r"^rules[ \t]*:\s*\S.*\.xrule\s*$", raw.strip()):
                    errors.append(f"{name}:{k + 2}: the header only holds  rules: <name>.xrule")
            continue
        if it[0] == "heading":
            if practice:
                continue
            t = it[1].lower()
            if re.match(r"^(exam|questions?)\b", t):
                in_solutions = False
            elif re.match(r"^(answer keys?|answers|keys?|solutions?)\b", t):
                in_solutions = True
            elif re.match(r"^practi[cs]e\b", t):
                errors.append(f"{name}:{it[2]}: practice belongs in an .xp file")
            else:
                errors.append(f'{name}:{it[2]}: heading "{it[1]}" not allowed; use # Exam / # Solutions or none')
            continue
        kind, attrs, ln, body = it
        loc = f"{name}:{ln}"
        if isinstance(attrs, str):
            errors.append(f"{loc}: {attrs}")
            continue
        aid = attrs.get("id")
        if not aid or not ID.match(aid):
            errors.append(f"{loc}: id missing or invalid (letters, digits, - and _): {aid!r}")
            continue
        if kind == "question":
            allowed = {"id", "type", "marks", "section", "difficulty", "time", "tags"} | ({"topic"} if practice else set())
            for k in attrs:
                if k not in allowed:
                    errors.append(f'{loc}: attribute "{k}" not allowed' + (" in an .xam" if k == "topic" else ""))
            if in_solutions:
                errors.append(f"{loc}: question after the Solutions heading")
            if aid in ids:
                errors.append(f"{loc}: duplicate id {aid}")
            ids.add(aid)
            qtype = attrs.get("type")
            if qtype not in ("mcq", "msq", "nat"):
                errors.append(f"{loc}: type must be mcq, msq or nat")
                continue
            marks = attrs.get("marks", "1" if practice else None)
            if marks is None or not NUM.match(marks) or float(marks) <= 0:
                errors.append(f"{loc}: marks must be a positive number")
                marks = "1"
            d = attrs.get("difficulty")
            if d is not None and (d not in DIFFICULTY) and not practice:
                errors.append(f"{loc}: difficulty must be easy, medium or hard: {d!r}")
            sec = attrs.get("section", "practice" if practice else "exam")
            if not ID.match(sec):
                errors.append(f"{loc}: section id must use letters, digits, - and _")
            if "tags" in attrs and " " in attrs["tags"]:
                errors.append(f"{loc}: tags are comma-separated without spaces")
            if "time" in attrs and not (NUM.match(attrs["time"]) and float(attrs["time"]) > 0):
                errors.append(f"{loc}: time must be positive seconds")
            lists = _lists(body)
            n = 0 if qtype == "nat" else (lists[-1] if lists else 0)
            if qtype != "nat":
                if not 2 <= n <= 26:
                    errors.append(f"{loc}: {aid} needs 2-26 options as a final - list (found {n})")
                limit = (setup or {}).get("types", {}).get(qtype) if not practice else None
                if limit and n != limit:
                    errors.append(f"{loc}: {aid} needs exactly {limit} options under these rules (found {n})")
            if not "".join(body).strip():
                errors.append(f"{loc}: empty question")
            questions.append({"id": aid, "type": qtype, "marks": float(marks), "section": sec,
                              "difficulty": d, "options": n, "loc": loc})
        else:
            for k in attrs:
                if k not in ("id", "answer", "tolerance"):
                    errors.append(f'{loc}: solution attribute "{k}" not allowed')
            if aid in solutions:
                errors.append(f"{loc}: duplicate solution {aid}")
            if not attrs.get("answer"):
                errors.append(f"{loc}: solution needs answer=")
            solutions[aid] = {**attrs, "loc": loc}
    by_id = {q["id"]: q for q in questions}
    for sid, s in solutions.items():
        if sid not in by_id:
            errors.append(f"{s['loc']}: no question for solution {sid}")
        elif s.get("answer"):
            _check_answer(by_id[sid], s, s["loc"], errors)
    for q in questions:
        if q["id"] not in solutions:
            errors.append(f"{q['loc']}: missing solution for {q['id']}")
    if not questions:
        errors.append(f"{name}: no questions")
    if practice or setup is None:
        return errors
    if setup["questionCount"] is not None and len(questions) != setup["questionCount"]:
        errors.append(f"{name}: expected {setup['questionCount']} questions (rules questionCount), found {len(questions)}")
    if setup["sections"]:
        known = {s for s, _ in setup["sections"]}
        for q in questions:
            if q["section"] not in known:
                errors.append(f"{q['loc']}: unknown section {q['section']} (use one of {', '.join(sorted(known))})")
        for s, n in setup["sections"]:
            got = [q for q in questions if q["section"] == s]
            if len(got) != n:
                errors.append(f"{name}: section {s} expects {n} questions, found {len(got)}")
            comp = (setup["composition"] or {}).get(s)
            for marks, count in (comp or {}).items():
                have = sum(1 for q in got if q["marks"] == marks)
                if have != count:
                    errors.append(f"{name}: section {s} expects {count} questions of {marks} marks, found {have}")
    for q in questions:
        if q["type"] not in setup["types"]:
            errors.append(f"{q['loc']}: question type {q['type']} is not allowed by the rules")
    untagged = [q["id"] for q in questions if not q["difficulty"]]
    if untagged:
        print(f"note: {name}: {len(untagged)} question(s) without difficulty (needed for retake papers)")
    return errors


# ── Workspace backup ────────────────────────────────────────────────────────

IMAGE_TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp"}
TEXT_TYPES = {".xam", ".xrule", ".xp", ".md", ".mmd", ".txt", ".csv", ".json"}


def build_workspace(root, out, name):
    """Pack the files under `root` (folders kept) into a Localdox Exam Workspace backup.

    Import it with Settings > Workspace > Transfer > Import workspace. .xrule files are
    placed at the workspace root, where Settings > Exam rules lists them.
    Returns the list of errors; nothing is written when there are any.
    """
    import base64
    root = Path(root)
    paths = sorted(p for p in root.rglob("*") if p.is_file() and not p.name.startswith("."))
    errors = check_files([str(p) for p in paths if p.suffix in (".xam", ".xrule", ".xp")], quiet=True)
    names = {}
    for p in paths:
        names.setdefault(p.name, []).append(str(p.relative_to(root)))
    errors += [f"duplicate file name {n}: {', '.join(v)}" for n, v in names.items() if len(v) > 1]
    folders, folder_ids, files = [], {}, []
    for p in paths:
        rel = p.relative_to(root)
        parent = None
        if p.suffix != ".xrule":
            for i, part in enumerate(rel.parts[:-1]):
                key = "/".join(rel.parts[:i + 1])
                if key not in folder_ids:
                    folder_ids[key] = f"folder-{len(folder_ids) + 1}"
                    folders.append({"id": folder_ids[key], "name": part,
                                    **({"parentId": parent} if parent else {})})
                parent = folder_ids[key]
        entry = {"id": f"file-{len(files) + 1}", "name": p.name}
        if p.suffix.lower() in IMAGE_TYPES:
            mime = IMAGE_TYPES[p.suffix.lower()]
            entry.update(content="", mimeType=mime,
                         data=f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode())
        elif p.suffix.lower() in TEXT_TYPES:
            entry["content"] = p.read_text(encoding="utf-8")
        else:
            errors.append(f"{rel}: unsupported file type for this backup")
            continue
        if parent:
            entry["folderId"] = parent
        files.append(entry)
    if errors:
        print("\n".join(errors))
        return errors
    backup = {"format": "localdox-workspace", "version": 2,
              "workspace": {"kind": "exam", "name": name, "folders": folders, "files": files}}
    Path(out).write_text(json.dumps(backup, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: wrote {out}: {len(files)} file(s) in {len(folders)} folder(s)")
    return []


# ── Files together ──────────────────────────────────────────────────────────

def check_files(paths, quiet=False):
    files = {Path(p).name: Path(p).read_text(encoding="utf-8") for p in paths}
    errors, setups = [], {}
    for name, text in files.items():
        if name.endswith(".xrule"):
            setups[name], errs = check_xrule(text, name)
            errors += errs
    for name, text in files.items():
        if name.endswith(".xp"):
            errors += check_questions(text, name, practice=True)
        elif name.endswith(".xam"):
            header = re.match(r"^---\s*\n\s*rules[ \t]*:[ \t]*(.+?)\s*\n---", text)
            rule = header.group(1).strip().strip("\"'") if header else None
            stem = name[:-4] + ".xrule"
            if rule and rule not in files:
                print(f"note: {name} names {rule}, which is not among the checked files")
            rule = rule if rule in files else stem if stem in files else (
                next(iter(setups)) if len(setups) == 1 else None)
            if rule is None:
                print(f"note: {name}: no .xrule given; checked without rules")
            errors += check_questions(text, name, setups.get(rule) if rule else None)
        elif not name.endswith(".xrule"):
            print(f"note: skipped {name}")
    if not quiet:
        print("\n".join(errors) if errors else f"OK: {len(files)} file(s) passed")
    return errors


if __name__ == "__main__":
    if sys.argv[1:2] == ["--build"] and len(sys.argv) == 5:
        sys.exit(1 if build_workspace(*sys.argv[2:5]) else 0)
    sys.exit(1 if check_files(sys.argv[1:]) else 0)
