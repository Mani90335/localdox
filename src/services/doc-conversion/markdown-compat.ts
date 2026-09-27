interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hName: string; hProperties?: Record<string, string> };
}

/** Interpret only AnyDoc's two structural HTML forms; never enable raw HTML. */
export function remarkConvertedHtml({ prefix }: { prefix: string }) {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "html") {
        if (/^<br\s*\/?\s*>$/i.test(node.value ?? "")) {
          node.type = "text";
          node.value = "";
          node.data = { hName: "br" };
        } else {
          const anchor = /^<a id="([a-zA-Z0-9_-]+)">(?:<\/a>)?$/.exec(node.value ?? "");
          if (anchor) {
            node.type = "text";
            node.value = "";
            node.data = { hName: "span", hProperties: { id: prefix + anchor[1] } };
          } else if (node.value === "</a>") {
            node.type = "text";
            node.value = "";
          }
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

export function convertedAnchorMap(chunks: { id: string; content: string }[], prefix: string) {
  const owners: Record<string, string> = {};
  const targets: Record<string, string> = {};
  for (const chunk of chunks) {
    for (const match of chunk.content.matchAll(/<a id="([a-zA-Z0-9_-]+)">/g)) {
      targets[match[1]] = prefix + match[1];
      owners[prefix + match[1]] = chunk.id;
    }
  }
  return { owners, targets };
}

/** AnyDoc emits footnote definitions at the end, outside earlier reader pages. */
export function convertedFootnotes(source: string): string {
  const lines = source.split("\n");
  const definitions: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    }
    if (fence || !/^\[\^[^\]]+\]:/.test(lines[i])) continue;
    const body = [lines[i]];
    while (
      i + 1 < lines.length &&
      (/^( {4}|\t)/.test(lines[i + 1]) ||
        (lines[i + 1] === "" && /^( {4}|\t)/.test(lines[i + 2] ?? "")))
    )
      body.push(lines[++i]);
    definitions.push(body.join("\n"));
  }
  return definitions.join("\n\n");
}
