FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 g++ gdb && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY entry.py python_trace.py cpp_trace.py ./
USER 65534:65534
ENTRYPOINT ["python3", "-I", "/runner/entry.py"]
