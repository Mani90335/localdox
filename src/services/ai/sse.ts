// Shared Server-Sent-Events line reader for streaming provider responses.
// Yields the payload after each `data:` field; skips comments and blank lines.

export async function* readSSE(response: Response, signal?: AbortSignal): AsyncIterable<string> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line; split on newlines and emit
      // each data field as it completes.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trimStart();
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
