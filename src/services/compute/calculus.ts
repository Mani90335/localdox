import type { ComputeEngine } from "@cortex-js/compute-engine";
import type { ComputeRequest, ComputeResult, Step } from "./protocol.ts";

/** Small, bounded calculus using the engine we already ship. No second runtime. */
export function calculus(
  ce: ComputeEngine,
  request: ComputeRequest,
  latex: string,
): ComputeResult | null {
  if (!/\\(?:int|partial)(?![a-zA-Z])|\\[dt]?frac\s*\{\s*d(?:\s|\}|\^)/.test(latex)) return null;
  const unsupported = (): ComputeResult => ({
    ok: false,
    op: request.op,
    kind: "unsupported",
    message: "This calculus problem is beyond what Compute can do.",
    hint: "Try a first derivative or an integral of powers of x, sin(x), cos(x) or exp(x). More advanced calculus needs another tool.",
  });
  // The parser can mistake these keyboard forms for multiplication and return
  // a plausible but wrong answer. Reject them before canonicalization.
  if (/\\partial\b|\\[dt]?frac\s*\{\s*d\s*\^/.test(latex)) return unsupported();
  // The upstream parser can absorb +4 in d/dx(x^2)+4 into the derivative.
  // Keep this small calculator to one whole derivative, rather than guess its scope.
  const operand = /^\\[dt]?frac\s*\{\s*d\s*\}\s*\{\s*d\s*[a-zA-Z]\s*\}\s*([\s\S]*)$/.exec(
    latex.replace(/\\(?:left|right)\s*/g, ""),
  )?.[1];
  if (operand && "({[".includes(operand[0])) {
    const open = operand[0];
    const close = ")}]"["({[".indexOf(open)];
    let depth = 0;
    for (let i = 0; i < operand.length; i++) {
      if (operand[i] === open) depth++;
      if (operand[i] === close && --depth === 0 && operand.slice(i + 1).trim())
        return unsupported();
    }
  }
  const raw = ce.parse(latex, { form: "raw" }).json;
  if (!Array.isArray(raw) || !["D", "Integrate"].includes(String(raw[0]))) return null;
  if (request.op === "solve")
    return {
      ok: false,
      op: request.op,
      kind: "wrong-operation",
      message: "This is a derivative or integral. Compute its value first.",
      suggest: "evaluate",
    };
  const integral = raw[0] === "Integrate";
  const limits = raw[2];
  const variable = Array.isArray(limits) ? limits[1] : limits;
  if (typeof variable !== "string" || !/^[a-zA-Z]$/.test(variable)) return unsupported();
  const box = (json: unknown) => ce.box(json as never);
  const show = (expression: ReturnType<typeof box>) =>
    expression.latex.replace(/\\exponentialE\b/g, "\\mathrm{e}");
  const body = box(raw[1]);
  const value = (json: unknown) => {
    const number = box(json).N();
    const real = number.im === 0 ? number.re : NaN;
    return Number.isFinite(real) ? real : null;
  };
  // Inspect the raw tree: x/x must not lose its missing value at zero before
  // we decide whether it is safe to integrate over an interval.
  const polynomial = (node: unknown): boolean => {
    if (node === variable) return true;
    if (!Array.isArray(node)) return typeof node === "number" && Number.isFinite(node);
    const [head, ...args] = node;
    if (
      ["Add", "Subtract", "Negate", "Multiply", "InvisibleOperator", "Delimiter"].includes(head)
    ) {
      return args.length > 0 && args.every(polynomial);
    }
    if (head === "Power") {
      return polynomial(args[0]) && Number.isInteger(args[1]) && args[1] >= 0 && args[1] <= 12;
    }
    if (head === "Divide" || head === "Rational") {
      const onlyNumbers = (part: unknown): boolean =>
        Array.isArray(part) ? part.slice(1).every(onlyNumbers) : typeof part === "number";
      return (
        polynomial(args[0]) &&
        onlyNumbers(args[1]) &&
        value(args[1]) !== null &&
        value(args[1]) !== 0
      );
    }
    return false;
  };
  const simpleFunction =
    Array.isArray(body.json) &&
    ((["Sin", "Cos", "Exp"].includes(String(body.json[0])) && body.json[1] === variable) ||
      (body.json[0] === "Power" && body.json[1] === "ExponentialE" && body.json[2] === variable));
  if ((!polynomial(raw[1]) && !simpleFunction) || !body.isValid) return unsupported();
  const definite = integral && Array.isArray(limits);
  if (definite && (limits.length !== 4 || value(limits[2]) === null || value(limits[3]) === null)) {
    return unsupported();
  }
  const primitive = box([integral ? "Integrate" : "D", body.json, variable]).evaluate();
  if (
    !primitive.isValid ||
    /"(?:Integrate|D|Error|Undefined)"/.test(JSON.stringify(primitive.json))
  )
    return unsupported();
  const steps: Step[] = [];
  if (simpleFunction) {
    steps.push({
      text: integral
        ? `Find a function whose derivative is $${show(body)}$.`
        : `Use the derivative of $${show(body)}$.`,
      latex: show(primitive),
    });
  } else {
    steps.push({
      text: integral
        ? "For each power, add 1 to the power and divide by that new power. Keep any number multiplying it."
        : "For each power, multiply by the power, then lower the power by 1. A number on its own becomes 0.",
      latex: integral
        ? `\\int ${variable}^n\\,d${variable}=\\frac{${variable}^{n+1}}{n+1}`
        : `\\frac{d}{d${variable}}${variable}^n=n${variable}^{n-1}\\quad(n\\ge 1)`,
    });
    const terms =
      Array.isArray(body.json) && body.json[0] === "Add" ? body.json.slice(1) : [body.json];
    for (const term of terms) {
      const part = box([integral ? "Integrate" : "D", term, variable]).evaluate();
      steps.push({ text: `Apply this to $${show(box(term))}$.`, latex: show(part) });
    }
    if (terms.length > 1) steps.push({ text: "Add the parts together.", latex: show(primitive) });
  }
  let exact = show(primitive);
  if (definite) {
    const upper = primitive.subs({ [variable]: box(limits[3]) }).evaluate();
    const lower = primitive.subs({ [variable]: box(limits[2]) }).evaluate();
    const result = upper.sub(lower).evaluate();
    exact = show(result);
    steps.push({
      text: "Put in the upper number, then subtract the value at the lower number.",
      latex: `\\left(${show(upper)}\\right)-\\left(${show(lower)}\\right)=${exact}`,
    });
  } else if (integral) {
    exact += " + C";
    steps.push({ text: "Add C because any constant gives the same derivative.", latex: exact });
  }
  if (request.op === "approximate") {
    const number = integral && !definite ? null : value(ce.parse(exact).json);
    if (number === null)
      return {
        ok: false,
        op: request.op,
        kind: "wrong-operation",
        message: "This answer still has a letter in it, so it has no single number value.",
        suggest: "evaluate",
      };
    return {
      ok: true,
      op: request.op,
      input: latex,
      approx: String(Number(number.toPrecision(12))),
      notes: ["Rounded to 12 significant digits."],
      steps,
    };
  }
  return { ok: true, op: request.op, input: latex, exact, notes: [], steps };
}
