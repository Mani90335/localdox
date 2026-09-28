// Shared Server-Sent-Events line reader for streaming provider responses.
// Yields the payload after each `data:` field; skips comments and blank lines.
// Once `signal` aborts it throws the abort reason (an AbortError) rather than
// ending quietly, so a cancelled answer is never mistaken for a complete one.

export async function* readSSE(response: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line; split on newlines and emit
      // each data field as it completes. A final line with no newline still
      // counts once the body has ended.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1 || (done && buffer)) {
        const end = nl === -1 ? buffer.length : nl;
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line.startsWith("data:")) {
          signal?.throwIfAborted();
          yield line.slice(5).trimStart();
        }
      }
      if (done) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
