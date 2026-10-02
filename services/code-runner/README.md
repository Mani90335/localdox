# Isolated Code Studio runner

This optional loopback development service records real Python and C++ programs.
JavaScript runs in the browser. The main app is still deployable as a static site.

Requirements: Python 3.10+, Docker with Linux containers, and image-build network
access. No package installation is needed in the host Python environment.

From the repository root:

```sh
docker build -t localdox-code-runner:1 services/code-runner
python services/code-runner/server.py
```

Set in your local Vite environment, then restart Vite:

```dotenv
VITE_CODE_RUNNER_URL=http://127.0.0.1:4318
```

The gateway allows the exact origin `http://127.0.0.1:4175` by default. If you run
the app elsewhere, set `CODE_RUNNER_ORIGIN` before starting the Python server.
Multiple explicit origins can be separated with commas; wildcards are not supported.
`CODE_RUNNER_PORT` changes the listening port. The gateway intentionally binds
only to loopback and has no unauthenticated network deployment mode.

Each request starts a disposable container with no network, a read-only root,
an unprivileged user, dropped capabilities, no-new-privileges, two concurrent
gateway slots, 256 MB RAM, one CPU, 64 processes, a bounded tmpfs, output limits,
and a 25-second host timeout. Cleanup removes the named container on success,
failure, timeout, or output overflow. Never mount the host Docker socket inside
the submission container. Do not execute user submissions with the tracer
directly on the host: the Python tracer and GDB are instrumentation, not sandboxes.

The browser sends source to the configured service only when Run is pressed for
Python or C++. There are no calls to Python Tutor's or alg0.dev's public services.

GDB must be allowed to debug its own child inside the container. Validate this on
your Docker/kernel configuration before relying on C++ execution. Do not disable
all sandbox restrictions to work around a failed trace. A network deployment
requires authentication, rate limits, a job queue, audited isolation (preferably
a dedicated sandbox runtime), and operational monitoring; this gateway is for
local development, not a production multi-tenant service.

Validation:

```sh
cd services/code-runner
python -B -m unittest test_python_trace.py
```

For a container smoke test, pipe a JSON job to the restricted container arguments
used in `server.py`, or start the gateway and run the Python/C++ examples through
the UI. Syntax and compilation diagnostics appear in the trace. C++ breakpoints
show state before a source line, including last-known memory on final exit.

The restricted container integration suite verifies Python input, recursion and
step limits, C++ vectors, swaps, pointer cycles and compilation errors, plus
disabled container networking. Run it after building the image:

```sh
CODE_STUDIO_DOCKER_TESTS=1 python3 -B -m unittest discover -s services/code-runner -p test_runner_integration.py -v
```

On Windows with Docker available in WSL, run the build and gateway inside that
distribution. For this workspace:

```powershell
wsl --distribution Ubuntu-22.04 --exec docker build -t localdox-code-runner:1 /mnt/d/Projects/localdox/docucraft-pro/services/code-runner
wsl --distribution Ubuntu-22.04 --exec python3 -B -u /mnt/d/Projects/localdox/docucraft-pro/services/code-runner/server.py
```

All six integration tests passed in Ubuntu/WSL with Docker 29.1.3, the image's
GCC 12, GDB 13 and Python 3.11, without relaxing the container restrictions.
Set `CODE_STUDIO_RUNNER_TESTS=1` when running the Code Studio Playwright suite
to also exercise real Python and C++ execution through the browser interface.
