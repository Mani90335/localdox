import { useEffect, useId, useState } from "react";
import DOMPurify from "dompurify";
import { withMermaid } from "@/services/diagrams/mermaid-runtime";
import { displayValue, isRef, type Snapshot } from "@/services/code-studio/protocol";

// Source text never supplies Mermaid IDs or syntax. Plain SVG labels do not
// decode numeric entities, so replace syntax-bearing characters with visible
// typographic equivalents. The generated SVG is sanitized as a second boundary.
const label = (s: string) =>
  s.slice(0, 160).replace(
    /["<>`\\&\r\n#]/g,
    (c) =>
      ({
        '"': "″",
        "<": "‹",
        ">": "›",
        "`": "′",
        "\\": "＼",
        "&": "＆",
        "#": "＃",
        "\r": " ",
        "\n": " ",
      })[c] ?? " ",
  );
function memoryMermaid(step: Snapshot): string {
  const nodes: string[] = ["flowchart LR"],
    links: string[] = [];
  const ids = new Map(Object.keys(step.heap).map((id, i) => [id, `o${i}`]));
  let index = 0;
  for (const frame of step.frames)
    for (const [name, value] of Object.entries(frame.locals)) {
      const id = `v${index++}`;
      nodes.push(
        `${id}["${label(`${frame.name} · ${name}${isRef(value) ? "" : ` = ${displayValue(value)}`}`)}"]`,
      );
      if (isRef(value) && ids.has(value.ref)) links.push(`${id} --> ${ids.get(value.ref)}`);
    }
  for (const [id, obj] of Object.entries(step.heap)) {
    const fields = obj.entries
      .filter(([, v]) => !isRef(v))
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${displayValue(v)}`)
      .join(" · ");
    nodes.push(`${ids.get(id)}["${label(`#${id} ${obj.type} | ${fields}`)}"]`);
    for (const [key, value] of obj.entries)
      if (isRef(value) && ids.has(value.ref))
        links.push(`${ids.get(id)} -->|"${label(key)}"| ${ids.get(value.ref)}`);
  }
  if (index === 0 && ids.size === 0) nodes.push('empty["Memory is empty at this step"]');
  return [...nodes, ...links].join("\n");
}

export function MemoryDiagram({ step }: { step: Snapshot }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, ""),
    [svg, setSvg] = useState(""),
    [error, setError] = useState("");
  const code = memoryMermaid(step);
  useEffect(() => {
    let active = true;
    setError("");
    setSvg("");
    // Debounce rapid seeks so Mermaid does not queue every intermediate step.
    const timer = setTimeout(() => {
      void withMermaid(
        async (mermaid) => {
          if (!active) return;
          const result = await mermaid.render(`studio${id}`, code);
          if (active)
            setSvg(
              DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } }),
            );
        },
        {
          config: {
            securityLevel: "strict",
            htmlLabels: false,
            theme: "neutral",
            flowchart: { htmlLabels: false, useMaxWidth: true },
            themeVariables: {
              fontFamily: "Inter, sans-serif",
              primaryColor: "#f8f4ed",
              primaryBorderColor: "#d6cfc4",
              lineColor: "#a6a095",
            },
          },
          label: "code-studio",
        },
      ).catch(() => {
        if (active)
          setError(
            "This diagram could not render. The Memory view still contains the recorded values.",
          );
      });
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code, id]);
  return (
    <div
      className="cs-mermaid"
      role="img"
      aria-label="Mermaid diagram showing variables, objects, and their references"
    >
      {error ? (
        <p>{error}</p>
      ) : svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="cs-muted">Drawing object connections…</p>
      )}
    </div>
  );
}
