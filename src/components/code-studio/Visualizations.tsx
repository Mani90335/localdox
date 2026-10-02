import {
  ArrowDown,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Cpu,
  Database,
  FileCode2,
  Monitor,
  Layers3,
} from "lucide-react";
import { displayValue, isRef, type Snapshot } from "@/services/code-studio/protocol";
import { explain } from "@/services/code-studio/operations";
import { useLayoutEffect, useRef } from "react";
import { animateOperation } from "@/services/code-studio/motion";

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
  return (
    <div className="cs-structures" ref={host}>
      <div className="cs-stage-heading">
        <span className="cs-eyebrow">WORKING DATA</span>
        <span className="cs-legend">
          <i /> Changed this step
        </span>
      </div>
      {objects.length === 0 ? (
        <div className="cs-empty-data">
          <Layers3 size={32} />
          <h3>{Object.keys(locals).length ? "Small values, named places" : "A fresh start"}</h3>
          <p>
            {Object.keys(locals).length
              ? "Simple values appear below. Collections and connected objects will appear here when they are created."
              : "Step forward to see values take their places in memory."}
          </p>
        </div>
      ) : (
        objects.map(([id, obj]) => {
          const names = step.frames.flatMap((f) =>
            Object.entries(f.locals)
              .filter(([, v]) => isRef(v) && v.ref === id)
              .map(([name]) => name),
          );
          const sequential = /Array|List|Tuple|Stack|Queue|Set|vector|array/i.test(obj.type);
          return (
            <article key={id} className="cs-object" id={`object-${id}`}>
              <div className="cs-object-title">
                <strong>{names.join(" · ") || `Object #${id}`}</strong>
                <span>
                  {obj.type} <small>#{id}</small>
                </span>
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
                              <ArrowDown size={12} />
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="cs-cell">
                        <span className="cs-field-name">{sequential ? "" : key}</span>
                        {isRef(value) ? (
                          <a href={`#object-${value.ref}`} aria-label={`Go to object ${value.ref}`}>
                            {displayValue(value)}
                          </a>
                        ) : (
                          <strong title={displayValue(value)}>{displayValue(value)}</strong>
                        )}
                      </div>
                      {sequential && <span className="cs-index">{key}</span>}
                    </div>
                  );
                })}
                {!obj.entries.length && <p className="cs-muted">Empty collection</p>}
              </div>
              {obj.truncated && (
                <p className="cs-muted">
                  Showing the first 200 entries; additional entries were not captured.
                </p>
              )}
            </article>
          );
        })
      )}
      {Object.keys(locals).length > 0 && (
        <div className="cs-variable-strip">
          {Object.entries(locals)
            .filter(([, v]) => !isRef(v))
            .map(([name, v]) => (
              <div key={name}>
                <span>{name}</span>
                <strong>{displayValue(v)}</strong>
              </div>
            ))}
        </div>
      )}
      <div className={`cs-operation-symbol cs-operation-${operation}`} aria-hidden="true">
        {operation === "swap" ? (
          <ArrowLeftRight />
        ) : operation === "move-left" ? (
          <ArrowLeft />
        ) : (
          <ArrowRight />
        )}
        <span>{operation.replaceAll("-", " ")}</span>
      </div>
    </div>
  );
}

export function Memory({ step }: { step: Snapshot }) {
  return (
    <div className="cs-memory">
      <div className="cs-stage-heading">
        <span className="cs-eyebrow">CALL FRAMES</span>
        <span className="cs-muted">Newest call first</span>
      </div>
      {[...step.frames].reverse().map((frame) => (
        <article className="cs-frame" key={frame.id}>
          <h3>
            <Layers3 size={15} />
            {frame.name}
            <small>frame {frame.id}</small>
          </h3>
          {Object.entries(frame.locals).length ? (
            <dl>
              {Object.entries(frame.locals).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="cs-muted">No captured variables in this frame yet.</p>
          )}
        </article>
      ))}
      <div className="cs-stage-heading">
        <span className="cs-eyebrow">OBJECT STORE</span>
        <span className="cs-muted">Logical IDs · not byte addresses</span>
      </div>
      {Object.entries(step.heap).map(([id, obj]) => (
        <article className="cs-frame" key={id}>
          <h3>
            <Database size={15} />#{id} · {obj.type}
          </h3>
          <dl>
            {obj.entries.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{displayValue(value)}</dd>
              </div>
            ))}
          </dl>
          {obj.truncated && <p>Additional entries omitted.</p>}
        </article>
      ))}
      <p className="cs-footnote">
        Only values visible to the tracer are shown. The object store is a language-neutral model;
        it does not imply that every C++ object lives on the heap.
      </p>
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
    { icon: FileCode2, name: "Your program", copy: "Instructions written for people" },
    { icon: Cpu, name: "Processor", copy: "Carries out machine instructions" },
    { icon: Database, name: "Working memory", copy: "Keeps data the program is using" },
    { icon: Monitor, name: "Output", copy: "Makes results visible" },
  ];
  return (
    <div className="cs-computer">
      <span className="cs-eyebrow">INSIDE THE COMPUTER</span>
      <h3>A small model of a big machine.</h3>
      <p>
        Follow how instructions and data work together. This is a teaching model, not a recording of
        your processor.
      </p>
      <div className="cs-machine-pipeline">
        {stages.map((stage, i) => (
          <div key={stage.name} className={`cs-machine-node ${i === active ? "is-active" : ""}`}>
            <stage.icon size={24} />
            <strong>{stage.name}</strong>
            <span>{stage.copy}</span>
          </div>
        ))}
      </div>
      <div className="cs-cpu-cycle">
        <span>Fetch</span>
        <ArrowRight size={14} />
        <span>Decode</span>
        <ArrowRight size={14} />
        <span>Execute</span>
        <ArrowRight size={14} />
        <span>Store</span>
      </div>
      <div className="cs-insight">
        <h4>What the trace can tell you</h4>
        <p>
          Compare repeated source steps, active calls, and visible objects. These help you spot
          repeated work and growing data.
        </p>
        <h4>What needs a profiler</h4>
        <p>
          CPU time, machine instructions, registers, cache misses, physical addresses, and exact
          memory usage require runtime and hardware profiling. A source step is not a CPU cycle.
        </p>
      </div>
    </div>
  );
}
