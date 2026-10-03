import { useId } from "react";
import { ArrowRight } from "lucide-react";
import { displayValue, isRef, type Snapshot, type Value } from "@/services/code-studio/protocol";

export function ValueBox({
  name,
  value,
  before,
  changed = false,
}: {
  name: string;
  value?: Value;
  before?: Value;
  changed?: boolean;
}) {
  return (
    <div
      className={`cs-value-box ${changed ? "is-changed" : ""} ${value === undefined ? "is-waiting" : ""}`}
    >
      <span className="cs-value-name">{name}</span>
      <div className="cs-cell">
        {changed && before !== undefined && (
          <span className="cs-value-before">
            {displayValue(before)}
            <ArrowRight size={16} />
          </span>
        )}
        <strong key={JSON.stringify(value)}>
          {value === undefined ? "—" : displayValue(value)}
        </strong>
      </div>
    </div>
  );
}

// A reusable connected-node figure, populated from real references, including cycles.
export function ConnectedScene({ step, previous }: { step: Snapshot; previous?: Snapshot }) {
  const marker = `arrow${useId().replace(/:/g, "")}`;
  const objects = Object.entries(step.heap);
  const width = 640;
  const incoming = new Set(
    objects.flatMap(([, obj]) => obj.entries.flatMap(([, v]) => (isRef(v) ? [v.ref] : []))),
  );
  const roots = objects.filter(([id]) => !incoming.has(id));
  const depths = new Map<string, number>();
  const queue: [string, number][] = (roots.length ? roots : objects.slice(0, 1)).map(([id]) => [
    id,
    0,
  ]);
  for (let i = 0; i < queue.length; i++) {
    const [id, depth] = queue[i];
    if (depths.has(id)) continue;
    depths.set(id, depth);
    step.heap[id]?.entries.forEach(([, v]) => {
      if (isRef(v) && !depths.has(v.ref)) queue.push([v.ref, depth + 1]);
    });
  }
  objects.forEach(([id]) => {
    if (!depths.has(id)) depths.set(id, 0);
  });
  const levels = Math.max(...depths.values(), 0) + 1;
  const height = Math.max(320, levels * 145);
  const positions = new Map(
    objects.map(([id]) => {
      const row = objects.filter(([other]) => depths.get(other) === depths.get(id));
      return [
        id,
        {
          x: ((row.findIndex(([other]) => other === id) + 1) * width) / (row.length + 1),
          y: 65 + depths.get(id)! * 145,
        },
      ];
    }),
  );
  return (
    <svg
      className="cs-connected-scene"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Connected values"
    >
      <defs>
        <marker
          id={marker}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {objects.flatMap(([id, obj]) =>
        obj.entries.flatMap(([key, v]) => {
          if (!isRef(v) || !positions.has(v.ref)) return [];
          const a = positions.get(id)!,
            b = positions.get(v.ref)!;
          const dx = b.x - a.x,
            dy = b.y - a.y,
            distance = Math.hypot(dx, dy) || 1;
          const start = { x: a.x + (dx / distance) * 34, y: a.y + (dy / distance) * 34 };
          const end = { x: b.x - (dx / distance) * 40, y: b.y - (dy / distance) * 40 };
          const d =
            id === v.ref
              ? `M ${a.x + 25} ${a.y - 20} C ${a.x + 95} ${a.y - 95}, ${a.x - 80} ${a.y - 95}, ${a.x - 25} ${a.y - 25}`
              : `M ${start.x} ${start.y} Q ${(a.x + b.x) / 2 + 22} ${(a.y + b.y) / 2} ${end.x} ${end.y}`;
          return (
            <g key={`${id}-${key}`} className="cs-connection">
              <path d={d} markerEnd={`url(#${marker})`} />
              <text x={(a.x + b.x) / 2 + 26} y={(a.y + b.y) / 2 - 7}>
                {key}
              </text>
            </g>
          );
        }),
      )}
      {objects.map(([id, obj]) => {
        const pos = positions.get(id)!;
        const values = obj.entries.filter(([, v]) => !isRef(v) && v !== null);
        const value = values.find(([key]) => /^(value|data|val|label)$/.test(key)) ?? values[0];
        const names = step.frames.flatMap((f) =>
          Object.entries(f.locals)
            .filter(([, v]) => isRef(v) && v.ref === id)
            .map(([name]) => name),
        );
        const changed = JSON.stringify(previous?.heap[id]) !== JSON.stringify(obj);
        return (
          <g
            key={id}
            transform={`translate(${pos.x},${pos.y})`}
            className={`cs-graph-value ${changed ? "is-changed" : ""}`}
          >
            <title>
              {names.join(", ") || obj.type}:{" "}
              {obj.entries.map(([key, v]) => `${key} = ${displayValue(v)}`).join(", ")}
            </title>
            <circle r="33" />
            <text textAnchor="middle" dy="7" className="cs-node-number">
              {value ? displayValue(value[1]).slice(0, 9) : "•"}
            </text>
            <text textAnchor="middle" y="-45" className="cs-node-name">
              {names.join(" · ")}
            </text>
            <text textAnchor="middle" y="57" className="cs-node-address">
              {id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
