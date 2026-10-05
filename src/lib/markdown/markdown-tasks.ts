interface Node {
  type: string;
  value?: string;
  checked?: boolean | null;
  children?: Node[];
  position?: { start: { line: number; column: number }; end: { line: number; column: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

// Only a marker at the start of a list item or a standalone line is a task.
// Inspect parsed text nodes, so code, escaped brackets and links stay literal.
const TASK_LINE =
  /^([ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(\[(?:[ yYxX])?\])(?=[ \t\r]|$)/;

export function taskMarker(line: string) {
  const match = TASK_LINE.exec(line);
  return match ? { column: match[1].length, marker: match[2] } : null;
}

/** Change just the marker, preserving all other source bytes, including CRLF. */
export function setMarkdownTask(source: string, line: number, checked: boolean): string {
  if (!Number.isInteger(line) || line < 0) return source;
  let start = 0;
  for (let i = 0; i < line; i++) {
    const next = source.indexOf("\n", start);
    if (next < 0) return source;
    start = next + 1;
  }
  const end = source.indexOf("\n", start);
  const task = taskMarker(source.slice(start, end < 0 ? undefined : end));
  if (!task) return source;
  // Keep imported GFM tasks in their original dialect.
  const standard = /[ xX]/.test(task.marker);
  const marker = checked ? (standard ? "[x]" : "[y]") : standard ? "[ ]" : "[]";
  const offset = start + task.column;
  return source.slice(0, offset) + marker + source.slice(offset + task.marker.length);
}

/** Adds source-line metadata as part of the existing remark parse. */
export function remarkTasks() {
  return (tree: Node, file: { value: unknown }) => {
    const lines = String(file.value).split("\n");
    const checkbox = (line: number, label: string): Node => ({
      type: "taskCheckbox",
      data: {
        hName: "input",
        hProperties: {
          type: "checkbox",
          checked: /[yYxX]/.test(taskMarker(lines[line])!.marker),
          disabled: true,
          "data-task-line": line,
          "aria-label": label.trim() || "Task",
        },
      },
    });
    const text = (node: Node): string => node.value ?? node.children?.map(text).join("") ?? "";
    const walk = (node: Node) => {
      if (node.type === "listItem" && typeof node.checked === "boolean") {
        const paragraph = node.children?.[0];
        const line = paragraph?.position?.start.line;
        if (paragraph?.type === "paragraph" && line && taskMarker(lines[line - 1])) {
          paragraph.children!.unshift(checkbox(line - 1, text(paragraph)), {
            type: "text",
            value: " ",
          });
          node.checked = null;
          node.data = {
            ...node.data,
            hProperties: { ...node.data?.hProperties, className: ["task-list-item"] },
          };
        }
      }
      if (node.type === "paragraph" && node.children) {
        let labels: string[] | undefined;
        node.children = node.children.flatMap((child) => {
          if (child.type !== "text" || !child.position || !child.value) return [child];
          const parts: Node[] = [];
          const value = child.value;
          let from = 0;
          let scanned = 0;
          let line = child.position.start.line - 1;
          for (const match of value.matchAll(/^(\[(?:[ yYxX])?\])(?=[ \t]|$)/gm)) {
            for (; scanned < match.index; scanned++) if (value[scanned] === "\n") line++;
            const task = taskMarker(lines[line]);
            // Position validation prevents escaped brackets from becoming controls.
            if (
              !task ||
              task.marker !== match[1] ||
              (match.index === 0 && child.position.start.column - 1 !== task.column)
            )
              continue;
            labels ??= text(node).split("\n");
            const label = labels[line - (node.position?.start.line ?? 1) + 1] ?? "";
            parts.push({ type: "text", value: value.slice(from, match.index) });
            parts.push(checkbox(line, label.replace(/^\[[ yYxX]?\][ \t]*/, "")));
            from = match.index + match[1].length;
          }
          if (!parts.length) return [child];
          parts.push({ type: "text", value: value.slice(from) });
          return parts;
        });
      }
      node.children?.forEach(walk);
      if (
        node.type === "listItem" &&
        node.children?.some((child) => child.children?.some((part) => part.type === "taskCheckbox"))
      ) {
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, className: ["task-list-item"] },
        };
      }
    };
    walk(tree);
  };
}
