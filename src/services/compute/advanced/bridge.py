# The advanced math engine's Python side: SymPy, run by Pyodide in a worker.
#
# Input never reaches Python as code. The worker parses what the reader typed
# into MathJSON (normalize.ts), and `build` turns that tree into SymPy
# objects through an allow-list of operations. Names must be identifiers, and
# numbers must look like numbers. No `eval`, `exec` or `sympify` of user text
# appears anywhere here: Python in Pyodide can reach JavaScript, and from the
# worker, the origin's IndexedDB.
#
# Worked steps come from steps.py, run first in the same namespace.
#
# `run(request_json)` returns a JSON string shaped like ComputeResult
# (src/services/compute/protocol.ts).

import json
import re
from functools import reduce

import sympy as sp
from sympy import stats as st

NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,31}$")
NUMBER = re.compile(r"-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$")

MAX_NODES = 5000
MAX_MATRIX = 12
MAX_LATEX = 8000
APPROX_DIGITS = 12


class Refusal(Exception):
    """A labelled failure: kind and message are shown to the reader."""

    def __init__(self, kind, message, hint=None, suggest=None, variables=None):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.hint = hint
        self.suggest = suggest
        self.variables = variables


CONSTANTS = {
    "Pi": sp.pi,
    "pi": sp.pi,
    "ExponentialE": sp.E,
    "e": sp.E,
    "ImaginaryUnit": sp.I,
    "i": sp.I,
    "PositiveInfinity": sp.oo,
    "NegativeInfinity": -sp.oo,
    "ComplexInfinity": sp.zoo,
    "EulerGamma": sp.EulerGamma,
    "GoldenRatio": sp.GoldenRatio,
}

UNARY = {
    "Sin": sp.sin, "Cos": sp.cos, "Tan": sp.tan, "Sec": sp.sec, "Csc": sp.csc, "Cot": sp.cot,
    "Arcsin": sp.asin, "Arccos": sp.acos, "Arctan": sp.atan, "Arcsec": sp.asec,
    "Arccsc": sp.acsc, "Arccot": sp.acot,
    "Sinh": sp.sinh, "Cosh": sp.cosh, "Tanh": sp.tanh, "Sech": sp.sech, "Csch": sp.csch,
    "Coth": sp.coth, "Arsinh": sp.asinh, "Arcosh": sp.acosh, "Artanh": sp.atanh,
    "Exp": sp.exp, "Ln": sp.log, "Sqrt": sp.sqrt, "Abs": sp.Abs, "Factorial": sp.factorial,
    "Factorial2": sp.factorial2, "Gamma": sp.gamma, "Erf": sp.erf, "Erfc": sp.erfc,
    "Floor": sp.floor, "Ceil": sp.ceiling, "Sign": sp.sign, "Real": sp.re,
    "Imaginary": sp.im, "Conjugate": sp.conjugate, "Arg": sp.arg, "Zeta": sp.zeta,
    "Lb": lambda x: sp.log(x, 2), "Lg": lambda x: sp.log(x, 10),
}

BINARY = {
    "Binomial": sp.binomial, "Beta": sp.beta, "Mod": sp.Mod, "Root": lambda x, n: sp.root(x, n),
}

VARIADIC = {"Max": sp.Max, "Min": sp.Min, "GCD": sp.gcd, "LCM": sp.lcm}

RELATIONS = {
    "Equal": sp.Eq, "NotEqual": sp.Ne, "Less": sp.Lt, "LessEqual": sp.Le,
    "Greater": sp.Gt, "GreaterEqual": sp.Ge,
}

TRIG = (sp.sin, sp.cos, sp.tan, sp.sec, sp.csc, sp.cot)


def latex(value):
    return sp.latex(value, ln_notation=True)


# ---- the environment: assumptions, random variables, definitions ---------------------


class Env:
    def __init__(self, request):
        self.notes = []
        self.given = []
        self.symbols = {}
        self.assumed = {}
        self.functions = set(request.get("functions", []))
        self.independent_name = request.get("independent")
        self.random = {}
        self.definitions = {}
        self.function_definitions = {}
        self.nodes = 0
        # Variables bound by a sum, integral or limit: `i` in \sum_{i=1}^n i is
        # the index, not the imaginary unit.
        self.bound = set()
        for assumption in request.get("assumptions", []):
            for name in assumption["names"]:
                checked(name)
                self.assumed.setdefault(name, {})[assumption["property"]] = True
                self.given.append(
                    f"{latex(sp.Symbol(name))}\\ \\text{{{assumption['property']}}}"
                )

    def symbol(self, name):
        checked(name)
        if name not in self.symbols:
            self.symbols[name] = sp.Symbol(name, **self.assumed.get(name, {}))
        return self.symbols[name]

    def independent(self):
        name = self.independent_name or "x"
        return self.symbol(name)

    def name(self, name):
        if name in self.bound:
            return self.symbol(name)
        if name in self.definitions:
            return self.definitions[name]
        if name in self.random:
            return self.random[name]
        if name in self.functions:
            return sp.Function(name)(self.independent())
        if name in CONSTANTS and name not in self.assumed:
            return CONSTANTS[name]
        return self.symbol(name)


def checked(name):
    if not isinstance(name, str) or not NAME.match(name) or name.startswith("_"):
        raise Refusal("syntax", f"“{name}” isn't a name the engine accepts.")
    return name


# ---- MathJSON → SymPy ------------------------------------------------------------------


def build(node, env):
    env.nodes += 1
    if env.nodes > MAX_NODES:
        raise Refusal("too-complex", "This expression is too large to work with here.")
    if isinstance(node, bool):
        raise Refusal("unsupported", "True/false values aren't expressions.")
    if isinstance(node, int):
        return sp.Integer(node)
    if isinstance(node, float):
        return sp.Float(repr(node))
    if isinstance(node, str):
        return env.name(node)
    if not isinstance(node, list) or not node or not isinstance(node[0], str):
        raise Refusal("syntax", "The engine couldn't read part of this.")
    head, args = node[0], node[1:]
    handler = HANDLERS.get(head)
    if handler:
        return handler(args, env)
    if head in UNARY:
        expect(head, args, 1)
        return UNARY[head](build(args[0], env))
    if head in BINARY:
        expect(head, args, 2)
        return BINARY[head](build(args[0], env), build(args[1], env))
    if head in VARIADIC:
        return VARIADIC[head](*[build(a, env) for a in args])
    if head in RELATIONS:
        parts = [build(a, env) for a in args]
        if len(parts) == 2:
            return RELATIONS[head](parts[0], parts[1], evaluate=False)
        return sp.And(*[RELATIONS[head](a, b) for a, b in zip(parts, parts[1:])])
    raise Refusal("unsupported", f"“{head}” isn't supported yet.")


def expect(head, args, count):
    if len(args) != count:
        raise Refusal("syntax", f"{head} takes {count} argument{'s' if count > 1 else ''}.")


def product(values):
    return reduce(lambda a, b: a * b, values)


def h_number(args, env):
    text = args[0]
    if not isinstance(text, str) or not NUMBER.match(text):
        raise Refusal("syntax", "That isn't a number the engine can read.")
    if re.fullmatch(r"-?\d+", text):
        return sp.Integer(text)
    return sp.Float(text, max(15, len(text)))


def h_rational(args, env):
    expect("Rational", args, 2)
    return sp.Rational(build(args[0], env), build(args[1], env))


def h_complex(args, env):
    return build(args[0], env) + sp.I * build(args[1], env)


def h_add(args, env):
    return reduce(lambda a, b: a + b, [build(a, env) for a in args])


def h_subtract(args, env):
    values = [build(a, env) for a in args]
    return reduce(lambda a, b: a - b, values)


def h_negate(args, env):
    return -build(args[0], env)


def h_multiply(args, env):
    return product([build(a, env) for a in args])


def h_divide(args, env):
    return build(args[0], env) / build(args[1], env)


def h_power(args, env):
    base, exponent = build(args[0], env), build(args[1], env)
    if isinstance(base, list):
        base = sp.Matrix(base)
    if isinstance(base, sp.MatrixBase):
        if exponent == -1:
            return inverse(base)
        if not exponent.is_Integer:
            raise Refusal("unsupported", "Matrix powers need a whole-number exponent.")
        return base**exponent
    if exponent.is_Integer and base.is_Integer and abs(int(exponent)) > 100000:
        raise Refusal("too-complex", "That power is too large to work out exactly.")
    return base**exponent


def h_square(args, env):
    return build(args[0], env) ** 2


def h_log(args, env):
    value = build(args[0], env)
    if len(args) == 2:
        return sp.log(value, build(args[1], env))
    # \log without a base is base 10, as in the basic engine.
    return sp.log(value, 10)


def h_list(args, env):
    values = [build(a, env) for a in args]
    if values and all(isinstance(v, list) for v in values):
        return matrix(values)
    return values


def h_tuple(args, env):
    return h_list(args, env)


def h_matrix(args, env):
    rows = [build(a, env) for a in args]
    if not all(isinstance(r, list) for r in rows):
        rows = [[r] if not isinstance(r, list) else r for r in rows]
    return matrix(rows)


def matrix(rows):
    if len(rows) > MAX_MATRIX or any(len(r) > MAX_MATRIX for r in rows):
        raise Refusal("too-complex", f"Matrices are limited to {MAX_MATRIX}×{MAX_MATRIX} here.")
    if len({len(r) for r in rows}) != 1:
        raise Refusal("syntax", "Every row of a matrix needs the same number of entries.")
    return sp.Matrix(rows)


def as_matrix(value, what="This"):
    if isinstance(value, list):
        value = sp.Matrix(value)
    if not isinstance(value, sp.MatrixBase):
        raise Refusal(
            "wrong-operation",
            f"{what} needs a matrix.",
            hint="Write one as \\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}, or [[1, 2], [3, 4]], or name it first: let A = [[1, 2], [3, 4]].",
        )
    return value


def square(value, what):
    m = as_matrix(value, what)
    if m.rows != m.cols:
        raise Refusal("wrong-operation", f"{what} needs a square matrix; this one is {m.rows}×{m.cols}.")
    return m


def inverse(m):
    m = square(m, "An inverse")
    if m.det() == 0:
        raise Refusal("undefined", "This matrix has no inverse: its determinant is 0 (it is singular).")
    return m.inv()


def h_determinant(args, env):
    return square(build(args[0], env), "A determinant").det()


def h_inverse(args, env):
    return inverse(build(args[0], env))


def h_transpose(args, env):
    return as_matrix(build(args[0], env), "A transpose").T


def h_trace(args, env):
    return square(build(args[0], env), "A trace").trace()


def limits_of(spec, env, body_symbols):
    """A (variable[, lower, upper]) spec: ["Limits", var, lo?, hi?]."""
    if isinstance(spec, str):
        return (env.symbol(spec),)
    if isinstance(spec, list) and spec and spec[0] == "Limits":
        variable = spec[1]
        if variable in (None, "Nothing"):
            free = sorted(body_symbols, key=str)
            if len(free) != 1:
                raise Refusal("syntax", "Say which variable this is over, e.g. dx.")
            var = free[0]
        else:
            var = env.symbol(variable)
        bounds = [build(b, env) for b in spec[2:] if b not in (None, "Nothing")]
        return (var, *bounds)
    raise Refusal("syntax", "The engine couldn't read the variable or bounds here.")


def bound_names(specs):
    names = set()
    for spec in specs:
        if isinstance(spec, str):
            names.add(spec)
        elif isinstance(spec, list) and spec[:1] == ["Limits"] and isinstance(spec[1], str):
            names.add(spec[1])
    return names


def with_bound(names, env, fn):
    added = names - env.bound
    env.bound |= added
    try:
        return fn()
    finally:
        env.bound -= added


def h_integrate(args, env):
    return with_bound(bound_names(args[1:]), env, lambda: integral(args, env))


def integral(args, env):
    body = build(args[0], env)
    specs = [limits_of(spec, env, free_symbols(body)) for spec in args[1:]] or [
        limits_of(["Limits", None], env, free_symbols(body))
    ]
    return sp.Integral(body, *specs)


def h_sum(args, env, kind=sp.Sum):
    return with_bound(bound_names(args[1:2]), env, lambda: summation(args, env, kind))


def summation(args, env, kind):
    body = build(args[0], env)
    spec = limits_of(args[1], env, free_symbols(body))
    if len(spec) != 3:
        raise Refusal("syntax", "A sum needs an index with a start and an end, like \\sum_{n=1}^{10}.")
    return kind(body, spec)


def h_product(args, env):
    return h_sum(args, env, sp.Product)


def h_limit(args, env):
    return with_bound({args[1]} if isinstance(args[1], str) else set(), env, lambda: limit(args, env))


def limit(args, env):
    body = build(args[0], env)
    variable = env.symbol(args[1])
    point = build(args[2], env)
    direction = args[3] if len(args) > 3 else "+-"
    if direction not in ("+", "-", "+-"):
        raise Refusal("syntax", "A limit's direction is +, - or both.")
    if point in (sp.oo, -sp.oo):
        direction = "+" if point == -sp.oo else "-"
    return sp.Limit(body, variable, point, direction)


def h_derivative(args, env):
    target = args[0]
    variables = [env.symbol(v) for v in args[1:]] or [env.independent()]
    # y'(0): the derivative of y, at x = 0.
    if isinstance(target, list) and target[:1] == ["Apply"] and target[1] in env.functions:
        x = env.independent()
        point = build(target[2], env)
        return sp.Subs(sp.Derivative(sp.Function(target[1])(x), *variables), x, point)
    return sp.Derivative(build(target, env), *variables)


def h_prime(args, env):
    name = args[0]
    order = int(args[1]) if len(args) > 1 else 1
    if not isinstance(name, str):
        return sp.Derivative(build(name, env), (env.independent(), order))
    env.functions.add(name)
    return sp.Derivative(sp.Function(checked(name))(env.independent()), (env.independent(), order))


def h_apply(args, env):
    name = checked(args[0])
    values = [build(a, env) for a in args[1:]]
    if name in env.function_definitions:
        return env.function_definitions[name](*values)
    return sp.Function(name)(*values)


def h_gradient(args, env):
    value = build(args[0], env)
    variables = sorted(free_symbols(value), key=str)
    return sp.Matrix([sp.diff(value, v) for v in variables])


def h_given(args, env):
    raise Refusal("syntax", "A condition (“given …”) belongs inside P(…) or E[…].")


def condition(args, env):
    if not args:
        raise Refusal("syntax", "P(…) and E[…] need something inside: P(X < 1), E[X].")
    if len(args) == 1 and isinstance(args[0], list) and args[0][:1] == ["Given"]:
        return build(args[0][1], env), build(args[0][2], env)
    return build(args[0], env), None


def needs_random(value, what):
    if not st.random_symbols(value):
        raise Refusal(
            "wrong-operation",
            f"{what} needs a random variable.",
            hint="Define one first, on its own line: X ~ N(0, 1).",
        )


def h_probability(args, env):
    event, given = condition(args, env)
    needs_random(event, "P(…)")
    return st.P(event, given) if given is not None else st.P(event)


def h_expectation(args, env):
    value, given = condition(args, env)
    needs_random(value, "E[…]")
    return st.E(value, given) if given is not None else st.E(value)


def rv_function(fn, what):
    def handler(args, env):
        values = [build(a, env) for a in args]
        for value in values:
            needs_random(value, what)
        return fn(*values)

    return handler


def h_pdf(args, env):
    variable = build(args[0], env)
    needs_random(variable, "A density")
    point = env.symbol(str(variable).lower()) if len(args) == 1 else build(args[1], env)
    return st.density(variable)(point)


def h_cdf(args, env):
    variable = build(args[0], env)
    needs_random(variable, "A CDF")
    point = env.symbol(str(variable).lower()) if len(args) == 1 else build(args[1], env)
    return st.cdf(variable)(point)


def h_mgf(args, env):
    variable = build(args[0], env)
    needs_random(variable, "A moment generating function")
    return st.moment_generating_function(variable)(env.symbol("t"))


def data_or_random(fn_random, fn_data, what):
    def handler(args, env):
        values = [build(a, env) for a in args]
        if len(values) == 1 and isinstance(values[0], list):
            values = values[0]
        elif len(values) == 1 and isinstance(values[0], sp.MatrixBase):
            values = list(values[0])
        if len(values) == 1 and st.random_symbols(values[0]):
            return fn_random(values[0])
        if fn_data is None or len(values) < 1:
            raise Refusal("wrong-operation", f"{what} needs a random variable.")
        return fn_data(values)

    return handler


def data_median(values):
    ordered = sorted(values, key=lambda v: float(v))
    n = len(ordered)
    return ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2


def data_mean(values):
    return sp.Add(*values) / len(values)


def data_variance(values):
    if len(values) < 2:
        raise Refusal("wrong-operation", "A sample variance needs at least two values.")
    mean = data_mean(values)
    return sp.Add(*[(v - mean) ** 2 for v in values]) / (len(values) - 1)


HANDLERS = {
    "Number": h_number,
    "Rational": h_rational,
    "Complex": h_complex,
    "Add": h_add,
    "Subtract": h_subtract,
    "Negate": h_negate,
    "Multiply": h_multiply,
    "Divide": h_divide,
    "Power": h_power,
    "Square": h_square,
    "Log": h_log,
    "List": h_list,
    "Tuple": h_tuple,
    "Matrix": h_matrix,
    "Determinant": h_determinant,
    "Inverse": h_inverse,
    "Transpose": h_transpose,
    "Trace": h_trace,
    "Integrate": h_integrate,
    "Sum": h_sum,
    "Product": h_product,
    "Limit": h_limit,
    "D": h_derivative,
    "Prime": h_prime,
    "Apply": h_apply,
    "Gradient": h_gradient,
    "Given": h_given,
    "P": h_probability,
    "E": h_expectation,
    "Var": rv_function(st.variance, "Var(…)"),
    "Std": rv_function(st.std, "SD(…)"),
    "Cov": rv_function(st.covariance, "Cov(…)"),
    "Corr": rv_function(st.correlation, "Corr(…)"),
    "Skewness": rv_function(st.skewness, "Skewness"),
    "Kurtosis": rv_function(st.kurtosis, "Kurtosis"),
    "Entropy": rv_function(st.entropy, "Entropy"),
    "PDF": h_pdf,
    "CDF": h_cdf,
    "MGF": h_mgf,
    "Mean": data_or_random(st.E, data_mean, "A mean"),
    "Median": data_or_random(st.median, data_median, "A median"),
}


def free_symbols(value):
    if isinstance(value, list):
        return set().union(*[free_symbols(v) for v in value]) if value else set()
    return getattr(value, "free_symbols", set())


# ---- distributions -----------------------------------------------------------------------


def positive_int(value, what):
    if not (value.is_Integer and value > 0):
        raise Refusal("syntax", f"{what} must be a positive whole number.")
    return int(value)


# name → (parameter count, constructor, how the parameters are read)
DISTRIBUTIONS = {
    "Normal": (2, lambda n, p: st.Normal(n, p[0], sp.sqrt(p[1])), "mean {0}, variance {1}"),
    "LogNormal": (2, lambda n, p: st.LogNormal(n, p[0], sp.sqrt(p[1])), "log-mean {0}, log-variance {1}"),
    "Uniform": (2, lambda n, p: st.Uniform(n, p[0], p[1]), "on [{0}, {1}]"),
    "Exponential": (1, lambda n, p: st.Exponential(n, p[0]), "rate {0}"),
    "Gamma": (2, lambda n, p: st.Gamma(n, p[0], 1 / p[1]), "shape {0}, rate {1}"),
    "Beta": (2, lambda n, p: st.Beta(n, p[0], p[1]), "α = {0}, β = {1}"),
    "ChiSquared": (1, lambda n, p: st.ChiSquared(n, p[0]), "{0} degrees of freedom"),
    "StudentT": (1, lambda n, p: st.StudentT(n, p[0]), "{0} degrees of freedom"),
    "Cauchy": (2, lambda n, p: st.Cauchy(n, p[0], p[1]), "location {0}, scale {1}"),
    "Laplace": (2, lambda n, p: st.Laplace(n, p[0], p[1]), "location {0}, scale {1}"),
    "Weibull": (2, lambda n, p: st.Weibull(n, p[0], p[1]), "scale {0}, shape {1}"),
    "Pareto": (2, lambda n, p: st.Pareto(n, p[0], p[1]), "scale {0}, shape {1}"),
    "Erlang": (2, lambda n, p: st.Erlang(n, p[0], p[1]), "shape {0}, rate {1}"),
    "Bernoulli": (1, lambda n, p: st.Bernoulli(n, p[0]), "success probability {0}"),
    "Binomial": (2, lambda n, p: st.Binomial(n, positive_int(p[0], "n"), p[1]), "{0} trials, success probability {1}"),
    "Poisson": (1, lambda n, p: st.Poisson(n, p[0]), "rate {0}"),
    "Geometric": (1, lambda n, p: st.Geometric(n, p[0]), "success probability {0}; counts trials up to and including the first success (1, 2, 3, …)"),
    # SymPy's NegativeBinomial(r, q) has pmf C(k+r-1, k) (1-q)^r q^k: with
    # q = 1 - p it counts failures before the r-th success at success rate p.
    "NegativeBinomial": (2, lambda n, p: st.NegativeBinomial(n, p[0], 1 - p[1]), "failures before success number {0}, success probability {1}"),
    "Hypergeometric": (3, lambda n, p: st.Hypergeometric(n, positive_int(p[0], "N"), p[1], p[2]), "population {0}, {1} successes in it, {2} draws"),
    "DiscreteUniform": (2, lambda n, p: discrete_uniform(n, p), "every whole number from {0} to {1}, equally likely"),
}

DISPLAY = {
    "Normal": "\\mathcal{N}", "LogNormal": "\\operatorname{LogNormal}", "Uniform": "\\mathcal{U}",
    "Exponential": "\\operatorname{Exp}", "Gamma": "\\operatorname{Gamma}", "Beta": "\\operatorname{Beta}",
    "ChiSquared": "\\chi^2", "StudentT": "t", "Bernoulli": "\\operatorname{Bern}",
    "Binomial": "\\operatorname{Bin}", "Poisson": "\\operatorname{Pois}", "Geometric": "\\operatorname{Geom}",
}


def discrete_uniform(name, params):
    low, high = params
    if not (low.is_Integer and high.is_Integer and 0 <= high - low <= 1000):
        raise Refusal("syntax", "A discrete uniform needs two whole numbers at most 1,000 apart.")
    return st.DiscreteUniform(name, list(range(int(low), int(high) + 1)))


def define_random(entry, env):
    name = checked(entry["name"])
    kind = entry["distribution"]
    if kind not in DISTRIBUTIONS:
        raise Refusal("unsupported", f"The distribution “{kind}” isn't supported yet.")
    count, make, reading = DISTRIBUTIONS[kind]
    params = [build(p, env) for p in entry["params"]]
    if len(params) != count:
        raise Refusal("syntax", f"{kind} takes {count} parameter{'s' if count > 1 else ''}; this has {len(params)}.")
    try:
        env.random[name] = make(name, params)
    except ValueError as error:
        raise Refusal("syntax", f"{kind}{tuple(params)}: {error}")
    shown = DISPLAY.get(kind, f"\\operatorname{{{kind}}}")
    env.given.append(f"{latex(sp.Symbol(name))} \\sim {shown}\\left({', '.join(latex(p) for p in params)}\\right)")
    env.notes.append(f"Read ${latex(sp.Symbol(name))}$ as {kind}: " + reading.format(*[f"${latex(p)}$" for p in params]) + ".")


def define(entry, env):
    name = checked(entry["name"])
    if entry.get("args"):
        variables = [env.symbol(a) for a in entry["args"]]
        body = build(entry["value"], env)
        env.function_definitions[name] = sp.Lambda(tuple(variables), body)
        env.given.append(f"{name}\\left({', '.join(latex(v) for v in variables)}\\right) = {latex(body)}")
    else:
        value = build(entry["value"], env)
        env.definitions[name] = value
        env.given.append(f"{latex(sp.Symbol(name))} = {latex(value)}")


# ---- results -------------------------------------------------------------------------------


def shown(value, notes):
    text = latex(value)
    if len(text) > MAX_LATEX:
        notes.append(f"The exact result is too long to show ({len(text):,} characters).")
        return None
    return text


def unevaluated(value):
    if isinstance(value, list):
        return any(unevaluated(v) for v in value)
    if isinstance(value, sp.MatrixBase):
        return any(unevaluated(v) for v in value)
    return isinstance(value, sp.Basic) and value.has(sp.Integral, sp.Limit, sp.Sum, sp.Product, sp.Derivative)


def has_float(value):
    if isinstance(value, sp.MatrixBase):
        return any(has_float(v) for v in value)
    return isinstance(value, sp.Basic) and value.has(sp.Float)


def approximation(value):
    """The decimal value, as LaTeX, when it says something the exact form doesn't."""
    if isinstance(value, sp.MatrixBase):
        if not all(v.is_number for v in value) or all(v.is_Rational for v in value):
            return None
        return latex(value.evalf(APPROX_DIGITS))
    if not isinstance(value, sp.Basic) or not value.is_number or value.is_Integer:
        return None
    if value.has(sp.zoo, sp.nan) or value in (sp.oo, -sp.oo):
        return None
    real, imaginary = value.as_real_imag()
    # 32i or -i/2 are exact already, and a decimal adds nothing (1/3 still gets one).
    if imaginary != 0 and real.is_Rational and imaginary.is_Rational:
        return None
    try:
        number = value.evalf(APPROX_DIGITS)
    except (TypeError, ValueError):
        return None
    if not number.is_number or number.has(sp.Integral):
        return None
    text = latex(number)
    return None if text == latex(value) else text


def answer(op, value, env, lhs=None, forms=None, notes=None, extra=None):
    notes = env.notes + (notes or [])
    if isinstance(value, sp.Basic) and value.has(sp.zoo):
        raise Refusal("undefined", "Undefined: it divides by zero.")
    if isinstance(value, sp.Basic) and value.has(sp.nan):
        raise Refusal("undefined", "Undefined: the result isn't a number.")
    exact = None
    if has_float(value):
        notes.append("The input has decimals, so the result is a decimal.")
        approx = latex(value.evalf(APPROX_DIGITS)) if hasattr(value, "evalf") else latex(value)
    else:
        exact = shown(value, notes)
        approx = approximation(value)
    if unevaluated(value):
        notes.append("No closed form found; the engine left this part unevaluated.")
        if approx is None:
            try:
                number = value.evalf(APPROX_DIGITS) if hasattr(value, "evalf") else None
                if number is not None and getattr(number, "is_number", False):
                    approx = latex(number)
            except Exception:
                approx = None
    result = {
        "ok": True,
        "op": op,
        "engine": "advanced",
        "exact": exact,
        "approx": approx,
        "notes": notes,
        "given": env.given,
    }
    if lhs is not None:
        result["lhs"] = lhs
    if forms:
        result["forms"] = forms
    if extra:
        result.update(extra)
    return result


def with_steps(steps):
    """The `extra` that adds worked steps (steps.py) to an answer, when there are any."""
    return {"steps": steps} if steps else None


def form(label, value):
    return {"label": label, "latex": latex(value)}


# ---- operations -----------------------------------------------------------------------------


def single(targets, op_label):
    if len(targets) != 1:
        raise Refusal("syntax", f"{op_label} works on one expression; this has {len(targets)}.")
    return targets[0]


def variables_of(value, params, env, key="variables"):
    names = params.get(key)
    if names:
        return [env.symbol(n) for n in names]
    return sorted(free_symbols(value), key=str)


def variable_of(value, params, env, what):
    name = params.get("variable")
    if name:
        return env.symbol(name)
    free = sorted(free_symbols(value) - set(env.random.values()), key=str)
    if len(free) == 1:
        return free[0]
    if not free:
        raise Refusal("wrong-operation", f"There's no variable to {what}.")
    raise Refusal(
        "choose-variable",
        f"This has several variables. Which one should it {what}?",
        variables=[str(s) for s in free],
    )


def param(params, key, env, default=None):
    value = params.get(key)
    return default if value is None else build(value, env)


def op_evaluate(targets, params, env):
    target = single(targets, "Evaluate")
    if isinstance(target, sp.Basic) and target.is_Relational:
        raise Refusal("wrong-operation", "That's an equation or inequality. Evaluate works out an expression.", suggest="solve")
    value = deep_doit(target)
    steps = calculus_steps(target, value) if isinstance(target, sp.Basic) and not unevaluated(value) else None
    return answer("evaluate", value, env, extra=with_steps(steps))


def limit_value(expression):
    """A limit, or a Refusal saying why it doesn't exist (with both one-sided values)."""
    body, variable, point, direction = expression.args
    if str(direction) != "+-" or point in (sp.oo, -sp.oo):
        return expression.doit()
    left = sp.limit(body, variable, point, "-")
    right = sp.limit(body, variable, point, "+")
    if left == right:
        return left
    raise Refusal(
        "undefined",
        f"The limit doesn't exist: from the left it tends to ${latex(left)}$, from the right to ${latex(right)}$.",
        hint="Ask for a one-sided limit (x → a⁺ or x → a⁻).",
    )


def deep_doit(value):
    if isinstance(value, list):
        return [deep_doit(v) for v in value]
    if isinstance(value, sp.Basic) and value.has(sp.Limit):
        value = value.replace(lambda e: isinstance(e, sp.Limit), limit_value)
    if isinstance(value, sp.MatrixBase):
        return value.applyfunc(lambda v: tidy(v.doit()))
    return tidy(value.doit()) if isinstance(value, sp.Basic) else value


def tidy(value):
    """A number in its plainest exact form: (1+i)^10 → 32i, (e^3 - 17/2)/e^3 → 1 - 17/(2e^3)."""
    if not isinstance(value, sp.Expr) or not value.is_number or value.has(sp.Float):
        return value
    candidates = [value, sp.expand(value)]
    if len(latex(value)) > 40:
        try:
            candidates.append(sp.simplify(value))
        except Exception:
            pass
    return min(candidates, key=lambda v: len(latex(v)))


def op_simplify(targets, params, env):
    target = single(targets, "Simplify")
    value = sp.simplify(deep_doit(target))
    forms = []
    if isinstance(value, sp.Expr) and not value.is_number:
        main = latex(value)
        candidates = [("Expanded", sp.expand), ("Factored", sp.factor)]
        free = free_symbols(value)
        if len(free) == 1 and value.is_rational_function():
            candidates.append(("Partial fractions", sp.apart))
        if value.has(*TRIG):
            candidates.append(("Trigonometric", sp.trigsimp))
        seen = {main}
        for label, fn in candidates:
            try:
                other = fn(value)
            except Exception:
                continue
            text = latex(other)
            if text not in seen:
                seen.add(text)
                forms.append({"label": label, "latex": text})
    return answer("simplify", value, env, forms=forms)


def op_approximate(targets, params, env):
    target = single(targets, "Numeric value")
    value = deep_doit(target)
    if isinstance(value, sp.Basic) and value.free_symbols - set(env.random.values()):
        raise Refusal("wrong-operation", "A numeric value needs numbers only.", suggest="simplify")
    if not hasattr(value, "evalf"):
        raise Refusal("wrong-operation", "This doesn't have a numeric value.")
    number = value.evalf(APPROX_DIGITS)
    if isinstance(number, sp.Basic) and number.has(sp.Integral, sp.Sum, sp.Limit):
        raise Refusal("unsupported", "The engine couldn't find a numeric value for this.")
    result = answer("approximate", value, env, notes=[f"Rounded to {APPROX_DIGITS} significant digits."])
    result["exact"] = None
    result["approx"] = latex(number)
    result["notes"] = [n for n in result["notes"] if "has decimals" not in n]
    return result


def denominators(value):
    found = set()
    for part in sp.preorder_traversal(value):
        if isinstance(part, sp.Pow) and part.exp.is_negative:
            found.add(part.base)
    return found


def is_initial_condition(target, env):
    if not (isinstance(target, sp.Equality)):
        return False
    lhs = target.lhs
    if isinstance(lhs, sp.Subs):
        return True
    return isinstance(lhs, sp.core.function.AppliedUndef) and lhs.func.__name__ in env.functions and all(
        a.is_number for a in lhs.args
    )


def op_solve(targets, params, env):
    targets = [t for t in targets]
    if any(isinstance(t, list) for t in targets):
        raise Refusal("wrong-operation", "Solve needs equations, not a list.")
    relations = [t if t.is_Relational else sp.Eq(t, 0) for t in targets]
    conditions = [t for t in relations if is_initial_condition(t, env)]
    equations = [t for t in relations if t not in conditions]
    if not equations:
        raise Refusal("empty", "There's no equation to solve.")
    has_derivative = any(eq.has(sp.Derivative) for eq in equations)
    if has_derivative:
        return solve_ode(equations, conditions, params, env)
    domain = sp.S.Complexes if params.get("domain") == "complex" else sp.S.Reals
    notes = [f"Solved over the {'complex' if domain == sp.S.Complexes else 'real'} numbers."]
    if len(equations) == 1:
        equation = equations[0]
        variable = variable_of(equation, params, env, "solve for")
        if not isinstance(equation, sp.Equality) and domain == sp.S.Complexes:
            raise Refusal("unsupported", "Inequalities are solved over the real numbers only.")
        others = sorted(free_symbols(equation) - {variable} - set(env.random.values()), key=str)
        lhs = latex(variable) + " \\in "
        if others and isinstance(equation, sp.Equality):
            # Other symbols are constants: solve generically, and say what that assumes.
            found = sp.solve(equation, variable)
            notes = [f"Treats {', '.join(f'${latex(o)}$' for o in others)} as constants."]
            assumptions = sorted({latex(d) for sol in found for d in denominators(sol) if d.free_symbols}, key=str)
            if assumptions:
                notes.append("Assumes " + " and ".join(f"${a} \\neq 0$" for a in assumptions) + ".")
            return answer("solve", sp.FiniteSet(*found), env, lhs=lhs, notes=notes)
        solution = sp.solveset(equation, variable, domain)
        if isinstance(solution, sp.ConditionSet):
            notes.append("The engine couldn't solve this in closed form.")
        return answer("solve", solution, env, lhs=lhs, notes=notes)
    variables = variables_of(sp.Tuple(*equations), params, env)
    steps = None
    try:
        if all(sp.Poly(eq.lhs - eq.rhs, *variables).total_degree() <= 1 for eq in equations):
            solution = sp.linsolve([eq.lhs - eq.rhs for eq in equations], variables)
            notes.append("A linear system.")
            steps = linear_system_steps(equations, variables, solution)
        else:
            solution = sp.nonlinsolve([eq.lhs - eq.rhs for eq in equations], variables)
    except sp.PolynomialError:
        solution = sp.nonlinsolve([eq.lhs - eq.rhs for eq in equations], variables)
    lhs = "\\left(" + ", ".join(latex(v) for v in variables) + "\\right) \\in "
    return answer("solve", solution, env, lhs=lhs, notes=notes, extra=with_steps(steps))


def solve_ode(equations, conditions, params, env):
    functions = sorted({f for eq in equations for f in eq.atoms(sp.core.function.AppliedUndef)}, key=str)
    if not functions:
        raise Refusal("wrong-operation", "This differential equation has no unknown function, like y(x).")
    ics = {}
    for condition in conditions:
        ics[condition.lhs] = condition.rhs
    target = equations[0] if len(equations) == 1 else equations
    unknown = functions[0] if len(functions) == 1 else functions
    try:
        solution = sp.dsolve(target, unknown, ics=ics or None)
    except NotImplementedError as error:
        raise Refusal("unsupported", "The engine can't solve this differential equation.", hint=str(error))
    notes = ["An ordinary differential equation."]
    if not ics:
        notes.append("$C_1, C_2, \\ldots$ are arbitrary constants; add conditions such as y(0) = 1 on their own lines to fix them.")
    else:
        notes.append(f"Uses {len(ics)} initial condition{'s' if len(ics) > 1 else ''}.")
    value = solution if not isinstance(solution, list) else sp.Tuple(*solution)
    return answer("solve", value, env, notes=notes)


def op_differentiate(targets, params, env):
    target = single(targets, "Differentiate")
    variables = params.get("variables") or []
    order = int(params.get("order") or 1)
    if not 1 <= order <= 20:
        raise Refusal("syntax", "The order is between 1 and 20.")
    if variables:
        specs = [env.symbol(v) for v in variables]
    else:
        specs = [(variable_of(target, params, env, "differentiate with respect to"), order)]
    derivative = sp.Derivative(target, *specs)
    value = derivative.doit()
    steps = derivative_steps(target, specs, value) if isinstance(target, sp.Expr) else None
    return answer("differentiate", value, env, lhs=latex(derivative), extra=with_steps(steps))


def op_integrate(targets, params, env):
    target = single(targets, "Integrate")
    variable = variable_of(target, params, env, "integrate with respect to")
    lower, upper = param(params, "lower", env), param(params, "upper", env)
    if (lower is None) != (upper is None):
        raise Refusal("syntax", "A definite integral needs both bounds; leave both empty for an antiderivative.")
    integral = sp.Integral(target, (variable, lower, upper) if lower is not None else variable)
    value = integral.doit()
    notes = []
    if lower is None and not unevaluated(value):
        notes.append("An antiderivative: add any constant $C$.")
        if value.has(sp.log):
            notes.append("SymPy writes $\\ln(u)$ where a real-variable text writes $\\ln|u|$.")
    if isinstance(value, sp.Piecewise):
        notes.append("The answer depends on the conditions shown.")
    steps = None
    if isinstance(target, sp.Expr) and not unevaluated(value) and not isinstance(value, sp.Piecewise):
        steps = integral_steps(target, variable, lower, upper, value)
    return answer("integrate", value, env, lhs=latex(integral), notes=notes, extra=with_steps(steps))


def op_limit(targets, params, env):
    target = single(targets, "Limit")
    variable = variable_of(target, params, env, "take the limit in")
    point = param(params, "point", env)
    if point is None:
        raise Refusal("syntax", "Say where the variable goes, e.g. x → 0 or ∞.")
    direction = params.get("direction") or "+-"
    if point in (sp.oo, -sp.oo):
        direction = "-" if point == sp.oo else "+"
    expression = sp.Limit(target, variable, point, direction)
    return answer("limit", limit_value(expression), env, lhs=latex(expression))


def op_series(targets, params, env):
    target = single(targets, "Series")
    variable = variable_of(target, params, env, "expand in")
    point = param(params, "point", env, sp.Integer(0))
    order = int(params.get("order") or 6)
    if not 1 <= order <= 30:
        raise Refusal("syntax", "The order is between 1 and 30.")
    value = sp.series(target, variable, point, order)
    notes = ["The $O(\\ldots)$ term stands for the remainder."]
    return answer("series", value, env, lhs=latex(target), notes=notes)


def op_gradient(targets, params, env):
    target = single(targets, "Gradient")
    variables = variables_of(target, params, env)
    value = sp.Matrix([sp.diff(target, v) for v in variables])
    lhs = "\\nabla " + "\\left(" + latex(target) + "\\right)"
    return answer("gradient", value, env, lhs=lhs, notes=[f"With respect to $({', '.join(latex(v) for v in variables)})$."])


def op_hessian(targets, params, env):
    target = single(targets, "Hessian")
    variables = variables_of(target, params, env)
    value = sp.hessian(target, variables)
    return answer("hessian", value, env, lhs="H", notes=[f"With respect to $({', '.join(latex(v) for v in variables)})$."])


def op_jacobian(targets, params, env):
    target = single(targets, "Jacobian")
    if isinstance(target, list):
        target = sp.Matrix(target)
    target = as_matrix(target, "A Jacobian")
    variables = variables_of(target, params, env)
    value = target.jacobian(variables)
    return answer("jacobian", value, env, lhs="J", notes=[f"With respect to $({', '.join(latex(v) for v in variables)})$."])


def op_laplace(targets, params, env):
    target = single(targets, "Laplace transform")
    t = env.symbol(params.get("variable") or "t")
    s = env.symbol(params.get("target") or "s")
    value, abscissa, cond = sp.laplace_transform(target, t, s)
    notes = []
    if abscissa not in (-sp.oo,):
        notes.append(f"Converges for $\\operatorname{{Re}}(s) > {latex(abscissa)}$.")
    if cond is not sp.true:
        notes.append(f"Valid when ${latex(cond)}$.")
    lhs = f"\\mathcal{{L}}\\left\\{{{latex(target)}\\right\\}}({latex(s)})"
    return answer("laplace", value, env, lhs=lhs, notes=notes)


def op_inverse_laplace(targets, params, env):
    target = single(targets, "Inverse Laplace transform")
    s = env.symbol(params.get("variable") or "s")
    t = env.symbol(params.get("target") or "t")
    value = sp.inverse_laplace_transform(target, s, t)
    notes = []
    if value.has(sp.Heaviside):
        notes.append("$\\theta(t)$ is the unit step: 0 for $t < 0$, 1 for $t > 0$.")
    lhs = f"\\mathcal{{L}}^{{-1}}\\left\\{{{latex(target)}\\right\\}}({latex(t)})"
    return answer("inverse-laplace", value, env, lhs=lhs, notes=notes)


def op_fourier(targets, params, env):
    target = single(targets, "Fourier transform")
    x = env.symbol(params.get("variable") or "x")
    k = env.symbol(params.get("target") or "k")
    value = sp.fourier_transform(target, x, k)
    notes = ["Convention: $\\hat f(k) = \\int_{-\\infty}^{\\infty} f(x)\\, e^{-2\\pi i k x}\\, dx$."]
    lhs = f"\\mathcal{{F}}\\left\\{{{latex(target)}\\right\\}}({latex(k)})"
    return answer("fourier", value, env, lhs=lhs, notes=notes)


def op_residue(targets, params, env):
    target = single(targets, "Residue")
    variable = variable_of(target, params, env, "take the residue in")
    point = param(params, "point", env)
    if point is None:
        raise Refusal("syntax", "Say at which point, e.g. 0.")
    value = sp.residue(target, variable, point)
    lhs = f"\\operatorname{{Res}}_{{{latex(variable)} = {latex(point)}}}\\left({latex(target)}\\right)"
    return answer("residue", value, env, lhs=lhs)


def matrix_target(targets, what):
    return as_matrix(single(targets, what), what)


def op_matrix(kind):
    def run(targets, params, env):
        m = matrix_target(targets, LABELS[kind])
        name = f"\\left({latex(m)}\\right)"
        if kind == "determinant":
            value = square(m, "A determinant").det()
            return answer(kind, value, env, lhs=f"\\det{name}", extra=with_steps(determinant_steps(m, value)))
        if kind == "inverse":
            value = inverse(m)
            return answer(kind, value, env, lhs=f"{name}^{{-1}}", extra=with_steps(inverse_steps(m, value)))
        if kind == "transpose":
            return answer(kind, m.T, env, lhs=f"{name}^{{T}}")
        if kind == "trace":
            return answer(kind, square(m, "A trace").trace(), env, lhs=f"\\operatorname{{tr}}{name}")
        if kind == "rank":
            return answer(kind, sp.Integer(m.rank()), env, lhs=f"\\operatorname{{rank}}{name}")
        if kind == "rref":
            reduced, pivots = m.rref()
            columns = ", ".join(str(p + 1) for p in pivots) or "none"
            return answer(
                kind,
                reduced,
                env,
                lhs=f"\\operatorname{{rref}}{name}",
                notes=[f"Pivot columns: {columns}."],
                extra=with_steps(rref_steps(m, reduced)),
            )
        if kind == "nullspace":
            basis = m.nullspace()
            return answer(kind, span(basis), env, lhs=f"\\operatorname{{null}}{name}", notes=[f"Dimension {len(basis)}."])
        if kind == "columnspace":
            basis = m.columnspace()
            return answer(kind, span(basis), env, lhs=f"\\operatorname{{col}}{name}", notes=[f"Dimension {len(basis)}."])
        m = square(m, LABELS[kind])
        if kind == "eigenvalues":
            values = sorted(m.eigenvals().items(), key=lambda item: sp.default_sort_key(item[0]))
            forms = [
                {"label": f"λ{index + 1}", "latex": f"{latex(value)} \\quad (\\times {count})"}
                for index, (value, count) in enumerate(values)
            ]
            values = dict(values)
            return answer(kind, sp.FiniteSet(*values.keys()), env, lhs="\\lambda \\in", forms=forms, notes=["(×k) is the algebraic multiplicity."])
        if kind == "eigenvectors":
            forms = []
            for value, count, vectors in m.eigenvects():
                forms.append({
                    "label": f"λ = {sp.sstr(value)}" + (f" (×{count})" if count > 1 else ""),
                    "latex": latex(span(vectors)),
                })
            note = "Each eigenspace is spanned by the vectors shown."
            return answer(kind, sp.FiniteSet(*m.eigenvals().keys()), env, lhs="\\lambda \\in", forms=forms, notes=[note])
        if kind == "charpoly":
            lam = sp.Symbol("lambda")
            polynomial = m.charpoly(lam).as_expr()
            forms = [{"label": "Factored", "latex": latex(sp.factor(polynomial))}]
            return answer(kind, polynomial, env, lhs=f"\\det\\left(\\lambda I - A\\right)", forms=forms)
        if kind == "diagonalize":
            if m.is_diagonalizable():
                p, d = m.diagonalize()
                return answer(kind, d, env, lhs="D", forms=[form("P", p)], notes=["$A = P D P^{-1}$."])
            p, j = m.jordan_form()
            return answer(kind, j, env, lhs="J", forms=[form("P", p)], notes=["Not diagonalizable: this is the Jordan form, $A = P J P^{-1}$."])
        raise Refusal("unsupported", "Unknown matrix operation.")

    return run


def span(vectors):
    if not vectors:
        return sp.Symbol("\\{\\mathbf{0}\\}")
    return sp.Symbol("\\operatorname{span}\\left\\{" + ", ".join(latex(v) for v in vectors) + "\\right\\}")


def op_statistics(targets, params, env):
    target = single(targets, "Statistics")
    values = target if isinstance(target, list) else list(target) if isinstance(target, sp.MatrixBase) else None
    if not values or not all(isinstance(v, sp.Basic) and v.is_number and v.is_real for v in values):
        raise Refusal(
            "wrong-operation",
            "Statistics needs a list of numbers.",
            hint="For example: 2, 4, 4, 5, 7, 9 (or [2, 4, 4, 5, 7, 9]).",
        )
    if len(values) > 10000:
        raise Refusal("too-complex", "Statistics is limited to 10,000 values here.")
    # Decimals are read as exact decimals, so the summary is exact too.
    values = [sp.nsimplify(v, rational=True) if isinstance(v, sp.Float) else v for v in values]
    ordered = sorted(values, key=lambda v: float(v))
    n = len(values)
    mean = data_mean(values)

    def quantile(q):
        # Linear interpolation between order statistics (R type 7, NumPy's default).
        h = (n - 1) * q
        low = int(sp.floor(h))
        high = min(low + 1, n - 1)
        return ordered[low] + (h - low) * (ordered[high] - ordered[low])

    counts = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    top = max(counts.values())
    modes = sorted([v for v, c in counts.items() if c == top], key=lambda v: float(v))
    rows = [("n", sp.Integer(n)), ("Mean", mean), ("Median", data_median(values))]
    if top > 1:
        rows.append(("Mode", sp.FiniteSet(*modes) if len(modes) > 1 else modes[0]))
    if n > 1:
        variance = data_variance(values)
        rows += [("Sample variance", variance), ("Sample SD", sp.sqrt(variance))]
    population = sp.Add(*[(v - mean) ** 2 for v in values]) / n
    rows += [
        ("Population variance", population),
        ("Population SD", sp.sqrt(population)),
        ("Min", ordered[0]),
        ("Q1", quantile(sp.Rational(1, 4))),
        ("Q3", quantile(sp.Rational(3, 4))),
        ("Max", ordered[-1]),
        ("IQR", quantile(sp.Rational(3, 4)) - quantile(sp.Rational(1, 4))),
    ]
    forms = []
    for label, value in rows:
        text = latex(value)
        approx = approximation(value) if isinstance(value, sp.Expr) else None
        forms.append({"label": label, "latex": text + (f" \\approx {approx}" if approx else "")})
    notes = ["Quartiles by linear interpolation (R type 7, NumPy's default).", "Sample variance divides by $n - 1$; population variance by $n$."]
    return answer("statistics", mean, env, lhs="\\bar{x}", forms=forms, notes=notes)


LABELS = {
    "determinant": "A determinant", "inverse": "An inverse", "transpose": "A transpose",
    "trace": "A trace", "rank": "A rank", "rref": "Row reduction", "nullspace": "A null space",
    "columnspace": "A column space", "eigenvalues": "Eigenvalues", "eigenvectors": "Eigenvectors",
    "charpoly": "A characteristic polynomial", "diagonalize": "Diagonalization",
}

OPERATIONS = {
    "evaluate": op_evaluate,
    "simplify": op_simplify,
    "approximate": op_approximate,
    "solve": op_solve,
    "differentiate": op_differentiate,
    "integrate": op_integrate,
    "limit": op_limit,
    "series": op_series,
    "gradient": op_gradient,
    "hessian": op_hessian,
    "jacobian": op_jacobian,
    "laplace": op_laplace,
    "inverse-laplace": op_inverse_laplace,
    "fourier": op_fourier,
    "residue": op_residue,
    "statistics": op_statistics,
    **{kind: op_matrix(kind) for kind in LABELS},
}


def failure(op, kind, message, hint=None, suggest=None, variables=None):
    result = {"ok": False, "op": op, "kind": kind, "message": message}
    if hint:
        result["hint"] = hint
    if suggest:
        result["suggest"] = suggest
    if variables:
        result["variables"] = variables
    return result


def run(request_json):
    request = json.loads(request_json)
    op = request.get("op")
    try:
        if op not in OPERATIONS:
            raise Refusal("unsupported", f"Unknown operation “{op}”.")
        env = Env(request)
        for entry in request.get("random", []):
            define_random(entry, env)
        for entry in request.get("definitions", []):
            define(entry, env)
        targets = [build(t, env) for t in request.get("targets", [])]
        if not targets:
            raise Refusal("empty", "Type an expression after the definitions.")
        params = {
            key: value for key, value in (request.get("params") or {}).items() if value not in (None, "")
        }
        result = OPERATIONS[op](targets, params, env)
    except Refusal as refusal:
        result = failure(op, refusal.kind, refusal.message, refusal.hint, refusal.suggest, refusal.variables)
    except ZeroDivisionError:
        result = failure(op, "undefined", "Undefined: it divides by zero.")
    except sp.matrices.exceptions.NonInvertibleMatrixError:
        result = failure(op, "undefined", "This matrix has no inverse (it is singular).")
    except sp.matrices.exceptions.ShapeError as error:
        result = failure(op, "syntax", f"The matrix sizes don't fit: {error}")
    except NotImplementedError as error:
        result = failure(op, "unsupported", "The engine can't do this one yet.", hint=str(error)[:300] or None)
    except (ValueError, TypeError, AttributeError) as error:
        result = failure(op, "engine-error", "The engine couldn't work this out.", hint=str(error)[:300] or None)
    except RecursionError:
        result = failure(op, "too-complex", "This is nested too deeply for the engine.")
    return json.dumps(result)
