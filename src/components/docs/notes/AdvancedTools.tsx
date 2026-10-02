import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  ADVANCED_LABELS,
  type AdvancedOperation,
  type AdvancedParams,
} from "@/services/compute/protocol";

// The Compute tab's advanced section: operations that need more than an
// expression (with respect to what, from where to where), grouped by field.
// Every operation runs on the advanced engine (SymPy); what goes in is still
// the expression typed above, so the input stays one place.

type Domain = "calculus" | "matrices" | "probability" | "statistics" | "transforms";

const DOMAINS: { id: Domain; label: string }[] = [
  { id: "calculus", label: "Calculus" },
  { id: "matrices", label: "Matrices" },
  { id: "probability", label: "Probability" },
  { id: "statistics", label: "Statistics" },
  { id: "transforms", label: "Transforms" },
];

const CALCULUS: AdvancedOperation[] = [
  "differentiate",
  "integrate",
  "limit",
  "series",
  "gradient",
  "hessian",
  "jacobian",
];
const MATRICES: AdvancedOperation[] = [
  "determinant",
  "inverse",
  "transpose",
  "trace",
  "rank",
  "rref",
  "nullspace",
  "columnspace",
  "eigenvalues",
  "eigenvectors",
  "charpoly",
  "diagonalize",
];
const TRANSFORMS: AdvancedOperation[] = ["laplace", "inverse-laplace", "fourier", "residue"];

const SHORT: Partial<Record<AdvancedOperation, string>> = {
  charpoly: "Char. polynomial",
  rref: "RREF",
  "inverse-laplace": "Inverse Laplace",
  differentiate: "Derivative",
};

/** What the run button says: a verb for the chosen operation. */
const VERBS: Partial<Record<AdvancedOperation, string>> = {
  differentiate: "Differentiate",
  integrate: "Integrate",
  limit: "Take the limit",
  series: "Expand",
  gradient: "Gradient",
  hessian: "Hessian",
  jacobian: "Jacobian",
  laplace: "Transform",
  "inverse-laplace": "Transform",
  fourier: "Transform",
  residue: "Find the residue",
};

/** Per-session settings, kept across tab switches like the input. */
const state = {
  open: false,
  domain: "calculus" as Domain,
  calculus: "differentiate" as AdvancedOperation,
  transform: "laplace" as AdvancedOperation,
  params: {} as Record<string, string>,
};

const TEMPLATES = {
  probability: ["X ~ N(0, 1)", "P(X < 1.96)", "E[X^2]", "Var(X)", "pdf(X)", "cdf(X)"],
  matrices: ["[[2, 1], [1, 2]]", "let A = [[1, 2], [3, 4]]"],
  statistics: ["2, 4, 4, 5, 7, 9"],
};

export function AdvancedTools({
  disabled,
  onRun,
  onTemplate,
}: {
  disabled: boolean;
  onRun: (op: AdvancedOperation, params: AdvancedParams) => void;
  /** Adds a line to the input. */
  onTemplate: (text: string) => void;
}) {
  const [open, setOpen] = useState(state.open);
  const [domain, setDomain] = useState(state.domain);
  const [calculus, setCalculus] = useState(state.calculus);
  const [transform, setTransform] = useState(state.transform);
  const [params, setParams] = useState(state.params);

  const field = (key: string) => params[key] ?? "";
  const set = (key: string, value: string) => {
    const next = { ...params, [key]: value };
    state.params = next;
    setParams(next);
  };
  const toggle = () => {
    state.open = !open;
    setOpen(!open);
  };
  const choose = (next: Domain) => {
    state.domain = next;
    setDomain(next);
  };

  /** The settings the chosen operation reads, from the fields shown for it. */
  const paramsFor = (op: AdvancedOperation): AdvancedParams => {
    const order = Number(field("order"));
    switch (op) {
      case "differentiate": {
        const variables = field("variable").includes(",") ? field("variable") : undefined;
        return {
          variable: variables ? undefined : field("variable"),
          variables,
          order: order > 0 ? order : undefined,
        };
      }
      case "integrate":
        return { variable: field("variable"), lower: field("lower"), upper: field("upper") };
      case "limit":
        return {
          variable: field("variable"),
          point: field("point") || "0",
          direction: (field("direction") || "+-") as AdvancedParams["direction"],
        };
      case "series":
        return {
          variable: field("variable"),
          point: field("point") || "0",
          order: order > 0 ? order : undefined,
        };
      case "gradient":
      case "hessian":
      case "jacobian":
        return { variables: field("variables") };
      case "laplace":
        return { variable: field("from") || "t", target: field("to") || "s" };
      case "inverse-laplace":
        return { variable: field("from") || "s", target: field("to") || "t" };
      case "fourier":
        return { variable: field("from") || "x", target: field("to") || "k" };
      case "residue":
        return { variable: field("from"), point: field("point") };
      default:
        return {};
    }
  };

  const run = (op: AdvancedOperation) => onRun(op, paramsFor(op));

  return (
    <section aria-label="Advanced math" className="rounded-lg border border-border/70">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:py-3"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        Advanced
        <span className="font-normal text-muted-foreground">
          · calculus, matrices, probability…
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          <div role="tablist" aria-label="Field" className="flex flex-wrap gap-1">
            {DOMAINS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={domain === d.id}
                onClick={() => choose(d.id)}
                className={`h-7 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10 coarse:px-3 ${
                  domain === d.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          {domain === "calculus" && (
            <>
              <Choices
                label="Operation"
                options={CALCULUS}
                value={calculus}
                onChange={(op) => {
                  state.calculus = op;
                  setCalculus(op);
                }}
              />
              <Fields>
                {(calculus === "differentiate" ||
                  calculus === "integrate" ||
                  calculus === "limit" ||
                  calculus === "series") && (
                  <Field
                    label={
                      calculus === "limit" ? "As" : calculus === "series" ? "In" : "With respect to"
                    }
                    value={field("variable")}
                    onChange={(v) => set("variable", v)}
                    placeholder={calculus === "differentiate" ? "x  or  x, y" : "x"}
                  />
                )}
                {calculus === "limit" && (
                  <>
                    <Field
                      label="→"
                      value={field("point")}
                      onChange={(v) => set("point", v)}
                      placeholder="0, oo"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      From
                      <select
                        value={field("direction") || "+-"}
                        onChange={(e) => set("direction", e.target.value)}
                        className="h-8 rounded-md border border-border bg-background px-1.5 text-xs text-foreground coarse:h-11"
                      >
                        <option value="+-">both sides</option>
                        <option value="+">the right (+)</option>
                        <option value="-">the left (−)</option>
                      </select>
                    </label>
                  </>
                )}
                {calculus === "integrate" && (
                  <>
                    <Field
                      label="From"
                      value={field("lower")}
                      onChange={(v) => set("lower", v)}
                      placeholder="a"
                    />
                    <Field
                      label="to"
                      value={field("upper")}
                      onChange={(v) => set("upper", v)}
                      placeholder="b"
                    />
                  </>
                )}
                {calculus === "series" && (
                  <Field
                    label="About"
                    value={field("point")}
                    onChange={(v) => set("point", v)}
                    placeholder="0"
                  />
                )}
                {(calculus === "differentiate" || calculus === "series") && (
                  <Field
                    label="Order"
                    value={field("order")}
                    onChange={(v) => set("order", v.replace(/\D/g, "").slice(0, 2))}
                    placeholder={calculus === "series" ? "6" : "1"}
                    narrow
                  />
                )}
                {(calculus === "gradient" || calculus === "hessian" || calculus === "jacobian") && (
                  <Field
                    label="Variables"
                    value={field("variables")}
                    onChange={(v) => set("variables", v)}
                    placeholder="auto: x, y"
                  />
                )}
              </Fields>
              {calculus === "integrate" && (
                <Hint>Leave both bounds empty for an antiderivative. ∞ is “oo”.</Hint>
              )}
              {calculus === "jacobian" && <Hint>A vector of functions: [x^2 y, 5x + sin(y)].</Hint>}
              <RunButton disabled={disabled} onClick={() => run(calculus)}>
                {VERBS[calculus]}
              </RunButton>
            </>
          )}

          {domain === "matrices" && (
            <>
              <Hint>
                A matrix as [[1, 2], [3, 4]] or \begin{"{pmatrix}"}…; or name it on one line (let A
                = …) and use A on the next.
              </Hint>
              <Templates items={TEMPLATES.matrices} onTemplate={onTemplate} />
              <div className="flex flex-wrap gap-1.5">
                {MATRICES.map((op) => (
                  <RunButton key={op} disabled={disabled} onClick={() => run(op)} small>
                    {SHORT[op] ?? ADVANCED_LABELS[op]}
                  </RunButton>
                ))}
              </div>
              <Hint>Products, powers and A^-1 work with Evaluate too.</Hint>
            </>
          )}

          {domain === "probability" && (
            <>
              <Hint>
                Define random variables on their own lines, then ask about them, and press Evaluate
                (exact) or Numeric:
              </Hint>
              <Templates items={TEMPLATES.probability} onTemplate={onTemplate} />
              <Hint>
                N(μ, σ²) takes the variance. Also: U, Exp, Gamma (shape, rate), Beta, Chi2, t,
                Cauchy, Laplace, LogNormal, Weibull, Pareto, Erlang, Bern, Bin, Pois, Geom, NB,
                Hypergeom, DU. Conditions: P(X &gt; 1 given X &gt; 0).
              </Hint>
            </>
          )}

          {domain === "statistics" && (
            <>
              <Hint>Numbers separated by commas; the summary is exact.</Hint>
              <Templates items={TEMPLATES.statistics} onTemplate={onTemplate} />
              <RunButton disabled={disabled} onClick={() => run("statistics")}>
                Summarize
              </RunButton>
            </>
          )}

          {domain === "transforms" && (
            <>
              <Choices
                label="Transform"
                options={TRANSFORMS}
                value={transform}
                onChange={(op) => {
                  state.transform = op;
                  setTransform(op);
                }}
              />
              <Fields>
                <Field
                  label={transform === "residue" ? "In" : "From"}
                  value={field("from")}
                  onChange={(v) => set("from", v)}
                  placeholder={
                    transform === "laplace"
                      ? "t"
                      : transform === "inverse-laplace"
                        ? "s"
                        : transform === "fourier"
                          ? "x"
                          : "z"
                  }
                  narrow
                />
                {transform === "residue" ? (
                  <Field
                    label="At"
                    value={field("point")}
                    onChange={(v) => set("point", v)}
                    placeholder="0"
                  />
                ) : (
                  <Field
                    label="to"
                    value={field("to")}
                    onChange={(v) => set("to", v)}
                    placeholder={
                      transform === "laplace" ? "s" : transform === "inverse-laplace" ? "t" : "k"
                    }
                    narrow
                  />
                )}
              </Fields>
              <RunButton disabled={disabled} onClick={() => run(transform)}>
                {VERBS[transform]}
              </RunButton>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Choices({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: AdvancedOperation[];
  value: AdvancedOperation;
  onChange: (op: AdvancedOperation) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((op) => (
        <button
          key={op}
          type="button"
          role="radio"
          aria-checked={value === op}
          onClick={() => onChange(op)}
          className={`h-7 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10 ${
            value === op
              ? "border-foreground/60 bg-accent font-medium text-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {SHORT[op] ?? ADVANCED_LABELS[op]}
        </button>
      ))}
    </div>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  narrow,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  narrow?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        aria-label={label === "to" ? "To" : label === "→" ? "Tends to" : label}
        className={`h-8 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 ${narrow ? "w-12" : "w-20"}`}
      />
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function Templates({ items, onTemplate }: { items: string[]; onTemplate: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1" aria-label="Insert an example">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onTemplate(item)}
          title="Add to the input"
          className="h-7 rounded-md bg-muted px-2 font-mono text-2xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10"
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function RunButton({
  disabled,
  onClick,
  small,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-md border border-border bg-background font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-background ${
        small ? "h-7 px-2 text-xs coarse:h-10" : "h-8 px-3 text-xs coarse:h-11"
      }`}
    >
      {children}
    </button>
  );
}
