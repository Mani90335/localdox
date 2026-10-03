import { ArrowDown, ArrowRight, Cpu, Database, FileCode2, Monitor, Play } from "lucide-react";
import { displayValue, isRef, type Snapshot } from "@/services/code-studio/protocol";
import { explain } from "@/services/code-studio/operations";
import { friendlyType } from "@/services/code-studio/presentation";
import { useLayoutEffect, useRef } from "react";
import { animateOperation } from "@/services/code-studio/motion";
import { ConnectedScene, ValueBox } from "./SceneParts";

export function Structures({ step, previous }: { step: Snapshot; previous?: Snapshot }) {
  const { changes, operation } = explain(previous, step);
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(
    () => (host.current ? animateOperation(host.current, operation) : undefined),
    [step, operation],
  );
  const focus = new Set(step.lesson?.focus ?? []);
  const objects = Object.entries(step.heap);
  const locals = step.frames.at(-1)?.locals ?? {};
  const connected =
    objects.length > 0 &&
    objects.length <= 40 &&
    objects.every(([, obj]) => !/Array|List|Tuple|Stack|Queue|Set|vector|array/i.test(obj.type)) &&
    objects.some(([, obj]) => obj.entries.some(([, v]) => isRef(v)));
  const values = step.frames.flatMap((f) =>
    Object.entries(f.locals)
      .filter(([, v]) => !isRef(v))
      .map(([name, value]) => ({ frame: f, name, value })),
  );
  return (
    <div className="cs-structures cs-visual-story" ref={host}>
      {step.frames.length > 1 && (
        <div className="cs-call-trail" aria-label="Active function calls">
          {step.frames.map((f, i) => (
            <span key={f.id}>
              {i > 0 && <ArrowRight size={13} />}
              {f.name}
            </span>
          ))}
        </div>
      )}
      {connected ? (
        <ConnectedScene step={step} previous={previous} />
      ) : (
        objects.map(([id, obj]) => {
          const names = step.frames.flatMap((f) =>
            Object.entries(f.locals)
              .filter(([, v]) => isRef(v) && v.ref === id)
              .map(([name]) => name),
          );
          const sequential = /Array|List|Tuple|Stack|Queue|Set|vector|array|\[\d+\]/i.test(
            obj.type,
          );
          return (
            <article key={id} className="cs-object" id={`object-${id}`}>
              <div className="cs-object-title">
                <strong>{names.join(" · ") || friendlyType(obj.type)}</strong>
                <span title="Picture label, not a physical memory address">{id}</span>
              </div>
              <div
                className={
                  sequential ? `cs-cells ${obj.type === "Stack" ? "cs-stack" : ""}` : "cs-fields"
                }
              >
                {obj.entries.map(([key, value]) => {
                  const changed =
                    focus.has(`${id}:${key}`) || changes.some((c) => c.target === `#${id}[${key}]`);
                  const pointers = Object.entries(locals).filter(
                    ([name, v]) =>
                      /^(left|right|i|j|index|mid|head|tail|cursor)$/.test(name) &&
                      v === Number(key),
                  );
                  return (
                    <div key={key} className={`cs-cell-wrap ${changed ? "is-changed" : ""}`}>
                      {sequential && (
                        <div className="cs-pointer">
                          {pointers.map(([name]) => (
                            <span key={name}>
                              {name}
                              <ArrowDown size={14} />
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="cs-cell">
                        {!sequential && <span className="cs-field-name">{key}</span>}
                        {isRef(value) ? (
                          <a href={`#object-${value.ref}`} aria-label={`Go to object ${value.ref}`}>
                            {displayValue(value)}
                          </a>
                        ) : (
                          <strong title={displayValue(value)}>{displayValue(value)}</strong>
                        )}
                      </div>
                      {sequential && (
                        <span className="cs-index">{key.replace(/^\[|\]$/g, "")}</span>
                      )}
                    </div>
                  );
                })}
                {!obj.entries.length && <span className="cs-empty-collection">[ ]</span>}
              </div>
              {obj.truncated && <small>First 200 items</small>}
            </article>
          );
        })
      )}
      {values.length > 0 && (
        <div className="cs-value-grid">
          {values.map(({ frame, name, value }) => {
            const change = changes.find((c) => c.target === `${frame.name}.${name}`);
            return (
              <ValueBox
                key={`${frame.id}:${name}`}
                name={
                  step.frames.filter((f) => name in f.locals).length > 1
                    ? `${frame.name}: ${name}`
                    : name
                }
                value={value}
                before={change?.before}
                changed={Boolean(change)}
              />
            );
          })}
        </div>
      )}
      {!objects.length && !values.length && (
        <div className="cs-scene-empty">
          <Play size={30} strokeWidth={1.2} />
          <span>Ready</span>
        </div>
      )}
    </div>
  );
}

export function Memory({ step }: { step: Snapshot }) {
  return (
    <div className="cs-memory">
      {step.frames.map((frame) => (
        <section key={frame.id} className="cs-memory-group">
          {step.frames.length > 1 && <h3>{frame.name}</h3>}
          <div className="cs-value-grid">
            {Object.entries(frame.locals).map(([name, value]) => (
              <ValueBox key={name} name={name} value={value} />
            ))}
          </div>
        </section>
      ))}
      {Object.entries(step.heap).map(([id, obj]) => (
        <article className="cs-frame" key={id}>
          <h3>
            <Database size={15} />
            <span title="Picture label, not a physical memory address">{id}</span>
            <small>{friendlyType(obj.type)}</small>
          </h3>
          <dl>
            {obj.entries.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{displayValue(value)}</dd>
              </div>
            ))}
          </dl>
          {obj.truncated && <small>First 200 items</small>}
        </article>
      ))}
      {!step.frames.some((f) => Object.keys(f.locals).length) && !Object.keys(step.heap).length && (
        <div className="cs-scene-empty">
          <Database size={32} />
          <span>Nothing saved yet</span>
        </div>
      )}
    </div>
  );
}

export function Computer({ step, previous }: { step: Snapshot; previous?: Snapshot }) {
  const { operation } = explain(previous, step);
  const active =
    operation === "input" || operation === "parse"
      ? 0
      : operation === "output" || operation === "end"
        ? 3
        : ["write", "allocate", "reference", "read", "insert", "remove"].includes(operation)
          ? 2
          : 1;
  const stages = [
    { icon: FileCode2, name: "Code" },
    { icon: Cpu, name: "Do the work" },
    { icon: Database, name: "Remember" },
    { icon: Monitor, name: "Show" },
  ];
  return (
    <div className="cs-computer cs-computer-scene">
      <div className="cs-machine-pipeline">
        {stages.map((stage, i) => (
          <div key={stage.name} className={`cs-machine-node ${i === active ? "is-active" : ""}`}>
            <stage.icon size={34} />
            <strong>{stage.name}</strong>
            {i < 3 && <ArrowRight className="cs-machine-arrow" size={18} />}
          </div>
        ))}
      </div>
      <span className="cs-model-label">Simplified computer model</span>
    </div>
  );
}
