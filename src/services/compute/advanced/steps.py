# Worked steps for the advanced engine: derivatives rule by rule, integrals
# by SymPy's own method tree (manualintegrate), and matrices by row
# operations and cofactor expansion. Loaded into the same Python namespace
# before bridge.py, which calls these functions.
#
# Steps explain a result the bridge has already computed; they never replace
# it. Each function returns a list of steps, or None when there is no method
# to show or the steps would not arrive at that same result: every step tree
# is checked (derivatives against sp.diff, antiderivatives by differentiating
# back, row reductions against SymPy's rref) before it is returned.
#
# A step is {"text": Markdown with $…$ math, "latex"?: str, "substeps"?: [...]}.

import random

import sympy as sp
from sympy.integrals import manualintegrate as mi

# Past this many steps, a worked solution stops being readable; none is shown.
MAX_STEPS = 80
# Past this size (SymPy's operation count), steps aren't attempted: they'd be
# slow to check and too long to read.
MAX_OPS = 60


def tex(value):
    return sp.latex(value, ln_notation=True)


def step(text, latex=None, substeps=None):
    out = {"text": text}
    if latex is not None:
        out["latex"] = latex
    if substeps:
        out["substeps"] = substeps
    return out


def count(steps):
    return sum(1 + count(s.get("substeps", [])) for s in steps)


def grouped(text):
    """Brackets for a sum or a signed term inside a product: (2x + 1), (-3)."""
    inner = text.strip()
    if inner.startswith("-") or any(c in inner[1:] for c in "+-"):
        return f"\\left({text}\\right)"
    return text


def same(a, b):
    try:
        return sp.simplify(a - b) == 0
    except Exception:
        return False


def close_numerically(a, b, variable, tries=3):
    """a = b at a few random points: a cheap check for each node of a step tree."""
    rng = random.Random(7)
    for _ in range(tries):
        point = sp.Rational(rng.randint(11, 97), 37)
        try:
            gap = complex(sp.N((a - b).subs(variable, point), 20))
        except (TypeError, ValueError, ZeroDivisionError):
            return False
        size = max(1.0, abs(complex(sp.N(b.subs(variable, point), 20))))
        if not abs(gap) <= 1e-8 * size:
            return False
    return True


class NoSteps(Exception):
    """A part with no method to show, or one that doesn't check out."""


# ---- derivatives ------------------------------------------------------------------------


def d_of(expr, x, partial):
    op = f"\\frac{{\\partial}}{{\\partial {tex(x)}}}" if partial else f"\\frac{{d}}{{d{tex(x)}}}"
    return f"{op}\\left[{tex(expr)}\\right]"


def differentiate(expr, x, partial):
    """(step, derivative) for d/dx expr, one rule per node."""
    lhs = d_of(expr, x, partial)
    if not expr.has(x):
        return step("The derivative of a constant is $0$.", f"{lhs} = 0"), sp.Integer(0)
    if expr == x:
        return step(f"The derivative of ${tex(x)}$ is $1$.", f"{lhs} = 1"), sp.Integer(1)

    if expr.is_Add:
        terms = expr.as_ordered_terms()
        parts = [differentiate(term, x, partial) for term in terms if term.has(x)]
        result = sp.Add(*[r for _, r in parts])
        constants = [t for t in terms if not t.has(x)]
        text = "Sum rule: differentiate each term."
        if constants:
            text += " Constant terms give $0$."
        combined = joined([tex(r) for _, r in parts])
        return step(text, f"{lhs} = {combined}" + tail(combined, result), [s for s, _ in parts]), result

    if expr.is_Mul:
        coefficient, rest = expr.as_independent(x, as_Add=False)
        if coefficient != 1:
            inner, d_rest = differentiate(rest, x, partial)
            result = coefficient * d_rest
            shown = f"{tex(coefficient)} \\cdot {grouped(tex(d_rest))}"
            return (
                step(
                    f"Constant multiple rule: keep ${tex(coefficient)}$ and differentiate the rest.",
                    f"{lhs} = {shown}" + tail(shown, result),
                    [inner],
                ),
                result,
            )
        numerator, denominator = sp.fraction(sp.together(rest)) if rest.is_Mul else (rest, 1)
        if denominator != 1 and denominator.has(x) and numerator.has(x):
            u, v = numerator, denominator
            su, du = differentiate(u, x, partial)
            sv, dv = differentiate(v, x, partial)
            result = sp.factor(sp.cancel((du * v - u * dv) / v**2))
            shown = (
                f"\\frac{{{grouped(tex(du))} \\cdot {grouped(tex(v))} - {grouped(tex(u))} \\cdot {grouped(tex(dv))}}}"
                f"{{{grouped(tex(v))}^{{2}}}}"
            )
            return (
                step(
                    "Quotient rule: $\\left(\\frac{u}{v}\\right)' = \\frac{u'v - uv'}{v^{2}}$, "
                    f"with $u = {tex(u)}$ and $v = {tex(v)}$.",
                    f"{lhs} = {shown}" + tail(shown, result),
                    [su, sv],
                ),
                result,
            )
        factors = rest.args
        u, v = factors[0], sp.Mul(*factors[1:])
        su, du = differentiate(u, x, partial)
        sv, dv = differentiate(v, x, partial)
        result = du * v + u * dv
        shown = f"{grouped(tex(du))} \\cdot {grouped(tex(v))} + {grouped(tex(u))} \\cdot {grouped(tex(dv))}"
        return (
            step(
                f"Product rule: $(uv)' = u'v + uv'$, with $u = {tex(u)}$ and $v = {tex(v)}$.",
                f"{lhs} = {shown}" + tail(shown, result),
                [su, sv],
            ),
            result,
        )

    if expr.is_Pow:
        base, exponent = expr.args
        if not exponent.has(x):
            outer = exponent * base ** (exponent - 1)
            if base == x:
                v = tex(x)
                rule = (
                    f"Power rule: $\\frac{{d}}{{d{v}}}{v}^{{n}} = n {v}^{{n-1}}$."
                    if exponent != sp.Rational(1, 2)
                    else f"Power rule, with $\\sqrt{{{v}}} = {v}^{{1/2}}$."
                )
                return step(rule, f"{lhs} = {tex(outer)}"), outer
            inner, d_base = differentiate(base, x, partial)
            result = outer * d_base
            shown = f"{tex(outer)} \\cdot {grouped(tex(d_base))}"
            return (
                step(
                    f"Chain rule: the power rule on the outside, times the derivative of the inside, ${tex(base)}$.",
                    f"{lhs} = {shown}" + tail(shown, result),
                    [inner],
                ),
                result,
            )
        if not base.has(x):
            outer = expr * (sp.log(base) if base != sp.E else 1)
            formula = (
                "\\frac{d}{dx}e^{x} = e^{x}" if base == sp.E else "\\frac{d}{dx}a^{x} = a^{x}\\ln a"
            )
            if exponent == x:
                return step(f"Exponential rule: ${formula}$.", f"{lhs} = {tex(outer)}"), outer
            inner, d_exponent = differentiate(exponent, x, partial)
            result = outer * d_exponent
            shown = f"{tex(outer)} \\cdot {grouped(tex(d_exponent))}"
            return (
                step(
                    f"Chain rule: ${formula}$ on the outside, times the derivative of the exponent.",
                    f"{lhs} = {shown}" + tail(shown, result),
                    [inner],
                ),
                result,
            )
        raise NoSteps()

    if isinstance(expr, sp.Function) and len(expr.args) == 1 and not isinstance(expr, sp.core.function.AppliedUndef):
        (argument,) = expr.args
        u = sp.Dummy("u")
        outer = expr.func(u).diff(u)
        if outer.has(sp.Derivative, sp.Subs):
            raise NoSteps()
        at = outer.subs(u, argument)
        if argument == x:
            known = f"$\\frac{{d}}{{d{tex(x)}}}{tex(expr)} = {tex(at)}$"
            return step(f"Standard derivative: {known}.", f"{lhs} = {tex(at)}"), at
        w = sp.Symbol("u")
        known = f"$\\frac{{d}}{{du}}{tex(expr.func(w))} = {tex(outer.subs(u, w))}$"
        inner, d_argument = differentiate(argument, x, partial)
        result = at * d_argument
        shown = f"{grouped(tex(at))} \\cdot {grouped(tex(d_argument))}"
        return (
            step(
                f"Chain rule: {known} on the outside, with $u = {tex(argument)}$, times $u'$.",
                f"{lhs} = {shown}" + tail(shown, result),
                [inner],
            ),
            result,
        )
    raise NoSteps()


def joined(parts):
    """a + b - c, from the terms' LaTeX: a leading minus becomes the sign."""
    out = parts[0] if parts else "0"
    for part in parts[1:]:
        out += f" - {part[1:].strip()}" if part.startswith("-") else f" + {part}"
    return out


def tail(shown, result):
    """ = simplified, when the rule's raw form isn't already it."""
    text = tex(result)
    return "" if text.replace(" ", "") == shown.replace(" ", "") else f" = {text}"


def derivative_steps(target, specs, result):
    """Steps for d/dx… of target, one differentiation per variable (and order)."""
    try:
        if sp.count_ops(target) > MAX_OPS:
            return None
        order = []
        for spec in specs:
            variable, times = spec if isinstance(spec, tuple) else (spec, 1)
            if not 1 <= times <= 3:
                return None
            order += [variable] * times
        partial = len(target.free_symbols) > 1
        current = target
        steps = []
        ordinals = ["first", "second", "third", "fourth", "fifth", "sixth"]
        for index, variable in enumerate(order):
            previous = current
            tree, current = differentiate(previous, variable, partial)
            if not same(current, sp.diff(previous, variable)):
                return None
            if len(order) > 1:
                steps.append(
                    step(
                        f"The {ordinals[index] if index < 6 else str(index + 1) + 'th'} derivative, with respect to ${tex(variable)}$.",
                        None,
                        [tree],
                    )
                )
            else:
                steps.append(tree)
        if not same(current, result):
            return None
        if tex(current) != tex(result):
            steps.append(step("The result above is the same, written another way.", f"= {tex(result)}"))
        return steps if count(steps) <= MAX_STEPS else None
    except NoSteps:
        return None
    except (RecursionError, TypeError, ValueError, AttributeError, NotImplementedError):
        return None


# ---- integrals --------------------------------------------------------------------------


def integral_of(integrand, variable):
    body = tex(integrand)
    if integrand.is_Add:
        body = f"\\left({body}\\right)"
    return f"\\int {body} \\, d{tex(variable)}"


def best(rule):
    """An AlternativeRule's shortest alternative (fewest nodes), recursively."""
    if isinstance(rule, mi.AlternativeRule):
        options = [best(r) for r in rule.alternatives]
        options = [r for r in options if not contains_unknown(r)] or options
        return min(options, key=size)
    return rule


def size(rule):
    children = getattr(rule, "substeps", None) or [
        getattr(rule, name) for name in ("substep", "v_step", "second_step") if getattr(rule, name, None)
    ]
    if isinstance(rule, mi.AlternativeRule):
        children = rule.alternatives
    return 1 + sum(size(c) for c in children if isinstance(c, mi.Rule))


def contains_unknown(rule):
    if isinstance(rule, mi.DontKnowRule):
        return True
    if isinstance(rule, mi.AlternativeRule):
        return all(contains_unknown(r) for r in rule.alternatives)
    children = getattr(rule, "substeps", None) or [
        getattr(rule, name) for name in ("substep", "v_step", "second_step") if getattr(rule, name, None)
    ]
    return any(contains_unknown(c) for c in children if isinstance(c, mi.Rule))


STANDARD = {
    "SinRule": "\\int \\sin u \\, du = -\\cos u",
    "CosRule": "\\int \\cos u \\, du = \\sin u",
    "Sec2Rule": "\\int \\sec^{2} u \\, du = \\tan u",
    "Csc2Rule": "\\int \\csc^{2} u \\, du = -\\cot u",
    "SecTanRule": "\\int \\sec u \\tan u \\, du = \\sec u",
    "CscCotRule": "\\int \\csc u \\cot u \\, du = -\\csc u",
    "ArcsinRule": "\\int \\frac{du}{\\sqrt{1 - u^{2}}} = \\arcsin u",
    "ArcsinhRule": "\\int \\frac{du}{\\sqrt{1 + u^{2}}} = \\operatorname{arsinh} u",
    "SinhRule": "\\int \\sinh u \\, du = \\cosh u",
    "CoshRule": "\\int \\cosh u \\, du = \\sinh u",
}


def integrate_rule(rule, integrand, variable):
    """(step, antiderivative) for ∫ integrand d(variable), following `rule`."""
    rule = best(rule)
    name = type(rule).__name__
    if isinstance(rule, mi.DontKnowRule):
        raise NoSteps()
    result = rule.eval()
    if not close_numerically(sp.diff(result, variable), integrand, variable):
        raise NoSteps()
    lhs = integral_of(integrand, variable)
    statement = f"{lhs} = {tex(result)}"
    v = tex(variable)

    if name == "ConstantRule":
        return step(f"The integral of a constant $c$ is $c{v}$.", statement), result
    if name == "PowerRule":
        if rule.exp == -1:
            return step(f"$\\int \\frac{{1}}{{{v}}} \\, d{v} = \\ln|{v}|$.", statement), result
        return step(
            f"Power rule: $\\int {v}^{{n}} \\, d{v} = \\frac{{{v}^{{n+1}}}}{{n+1}}$, here with $n = {tex(rule.exp)}$.",
            statement,
        ), result
    if name == "ReciprocalRule":
        text = "$\\int \\frac{1}{u} \\, du = \\ln|u|$"
        if rule.base != variable:
            text += f", with $u = {tex(rule.base)}$"
        return step(text + ".", statement), result
    if name == "ExpRule":
        formula = "\\int e^{u} \\, du = e^{u}" if rule.base == sp.E else "\\int a^{u} \\, du = \\frac{a^{u}}{\\ln a}"
        return step(f"Exponential rule: ${formula}$.", statement), result
    if name == "ConstantTimesRule":
        inner, _ = integrate_rule(rule.substep, rule.other, variable)
        return step(
            f"Take the constant ${tex(rule.constant)}$ out of the integral.",
            f"{lhs} = {tex(rule.constant)} {integral_of(rule.other, variable)} = {tex(result)}",
            [inner],
        ), result
    if name == "AddRule":
        terms = [r.integrand for r in rule.substeps]
        if not same(sp.Add(*terms), integrand):
            raise NoSteps()
        parts = [integrate_rule(r, term, variable)[0] for r, term in zip(rule.substeps, terms)]
        return step("Integrate term by term.", statement, parts), result
    if name == "URule":
        u = rule.u_var
        du = sp.diff(rule.u_func, variable)
        inner, inner_result = integrate_rule(rule.substep, rule.substep.integrand, u)
        return step(
            f"Substitute $u = {tex(rule.u_func)}$, so $du = {tex(du)} \\, d{v}$.",
            statement,
            [
                inner,
                step(
                    f"Put back $u = {tex(rule.u_func)}$.",
                    f"{tex(inner_result)} = {tex(result)}" if inner_result != result else None,
                ),
            ],
        ), result
    if name == "PartsRule":
        u, dv = rule.u, rule.dv
        du = sp.diff(u, variable)
        v_step, v_value = integrate_rule(rule.v_step, dv, variable)
        substeps = [step(f"Find $v = \\int dv$.", None, [v_step])]
        rest_integrand = v_value * du
        if rule.second_step is not None:
            second, _ = integrate_rule(rule.second_step, rest_integrand, variable)
            substeps.append(step("Then the remaining integral, $\\int v \\, du$.", None, [second]))
        return step(
            f"Integrate by parts, $\\int u \\, dv = uv - \\int v \\, du$, with $u = {tex(u)}$ and $dv = {tex(dv)} \\, d{v}$.",
            f"{lhs} = {grouped(tex(u))} \\cdot {grouped(tex(v_value))} - {integral_of(rest_integrand, variable)} = {tex(result)}",
            substeps,
        ), result
    if name == "CyclicPartsRule":
        choices = ", then ".join(f"$u = {tex(p.u)}$, $dv = {tex(p.dv)} \\, d{v}$" for p in rule.parts_rules)
        return step(
            f"Integrate by parts twice ({choices}). The original integral comes back, so solve for it.",
            statement,
        ), result
    if name in ("RewriteRule", "CompleteSquareRule"):
        inner, _ = integrate_rule(rule.substep, rule.rewritten, variable)
        text = "Complete the square." if name == "CompleteSquareRule" else "Rewrite the integrand."
        if name == "RewriteRule":
            try:
                if sp.apart(integrand, variable) == rule.rewritten and rule.rewritten.is_Add:
                    text = "Split into partial fractions."
            except Exception:
                pass
        return step(text, f"{lhs} = {integral_of(rule.rewritten, variable)}", [inner]), result
    if name == "TrigSubstitutionRule":
        inner, _ = integrate_rule(rule.substep, rule.substep.integrand, rule.theta)
        return step(
            f"Trigonometric substitution: ${v} = {tex(rule.func)}$.",
            statement,
            [inner],
        ), result
    if name == "ArctanRule":
        return step(
            "A standard integral: $\\int \\frac{du}{a^{2} + u^{2}} = \\frac{1}{a}\\arctan\\frac{u}{a}$.",
            statement,
        ), result
    if name in STANDARD:
        return step(f"A standard integral: ${STANDARD[name]}$.", statement), result
    return step("A standard integral.", statement), result


def integral_steps(target, variable, lower, upper, value):
    """Steps for ∫ target d(variable), definite when both bounds are given."""
    try:
        if sp.count_ops(target) > MAX_OPS:
            return None
        rule = mi.integral_steps(target, variable)
        if contains_unknown(rule):
            return None
        tree, antiderivative = integrate_rule(rule, target, variable)
        if not same(sp.diff(antiderivative, variable), target):
            return None
        steps = [tree]
        if lower is None:
            if not same(antiderivative, value):
                if not same(sp.diff(antiderivative - value, variable), 0):
                    return None
                steps.append(step("This differs from the result above only by a constant, which $+C$ absorbs."))
            steps.append(step("Add the constant of integration.", f"{tex(value)} + C"))
        else:
            at_upper = sp.limit(antiderivative, variable, upper, "-") if upper in (sp.oo, -sp.oo) else antiderivative.subs(variable, upper)
            at_lower = sp.limit(antiderivative, variable, lower, "+") if lower in (sp.oo, -sp.oo) else antiderivative.subs(variable, lower)
            total = sp.simplify(at_upper - at_lower)
            if total.has(sp.oo, -sp.oo, sp.zoo, sp.nan) or not same(total, value):
                return None
            F = f"\\left[{tex(antiderivative)}\\right]_{{{tex(lower)}}}^{{{tex(upper)}}}"
            steps.append(
                step(
                    "Evaluate the antiderivative at the bounds and subtract (the fundamental theorem of calculus).",
                    f"{F} = {grouped(tex(at_upper))} - {grouped(tex(at_lower))} = {tex(value)}",
                )
            )
        return steps if count(steps) <= MAX_STEPS else None
    except NoSteps:
        return None
    except (RecursionError, TypeError, ValueError, AttributeError, NotImplementedError, ZeroDivisionError):
        return None


def calculus_steps(target, value):
    """Steps for an integral or derivative written out (\\int …, \\frac{d}{dx} …) and evaluated."""
    if isinstance(target, sp.Integral) and len(target.limits) == 1:
        limit = target.limits[0]
        variable = limit[0]
        lower, upper = (limit[1], limit[2]) if len(limit) == 3 else (None, None)
        return integral_steps(target.function, variable, lower, upper, value)
    if isinstance(target, sp.Derivative):
        return derivative_steps(target.expr, [(v, int(n)) for v, n in target.variable_count], value)
    return None


# ---- matrices -------------------------------------------------------------------------------


def row(i):
    return f"R_{{{i + 1}}}"


def augmented(m, split):
    """A matrix with a bar before column `split`: [A | b], [A | I]."""
    columns = "c" * split + "|" + "c" * (m.cols - split)
    rows = " \\\\ ".join(" & ".join(tex(v) for v in m.row(i)) for i in range(m.rows))
    return f"\\left[\\begin{{array}}{{{columns}}} {rows} \\end{{array}}\\right]"


def shown_matrix(m, split=None):
    return augmented(m, split) if split else tex(m)


def row_reduce(m, split=None, limit=None):
    """Gauss–Jordan elimination, one step per pivot: (steps, reduced, pivots)."""
    m = sp.Matrix(m)
    steps = []
    pivots = []
    r = 0
    columns = limit if limit is not None else m.cols
    for c in range(columns):
        if r >= m.rows:
            break
        found = next((i for i in range(r, m.rows) if sp.simplify(m[i, c]) != 0), None)
        if found is None:
            continue
        ops = []
        if found != r:
            m.row_swap(found, r)
            ops.append(f"$ {row(r)} \\leftrightarrow {row(found)} $")
        pivot = sp.simplify(m[r, c])
        if pivot != 1:
            m[r, :] = (m[r, :] / pivot).applyfunc(sp.simplify)
            ops.append(f"$ {row(r)} \\to {grouped(tex(1 / pivot)) if (1 / pivot).is_Rational and not (1 / pivot).is_Integer else tex(1 / pivot)} \\, {row(r)} $")
        for i in range(m.rows):
            if i == r:
                continue
            factor = sp.simplify(m[i, c])
            if factor == 0:
                continue
            m[i, :] = (m[i, :] - factor * m[r, :]).applyfunc(sp.simplify)
            sign = "-" if not str(factor).startswith("-") else "+"
            amount = tex(factor if sign == "-" else -factor)
            ops.append(f"$ {row(i)} \\to {row(i)} {sign} {'' if amount == '1' else grouped(amount)}{row(r)} $")
        pivots.append(c)
        if ops:
            steps.append(
                step(
                    f"Pivot in column {c + 1}: " + ", ".join(ops) + ".",
                    shown_matrix(m, split),
                )
            )
        r += 1
    return steps, m, pivots


def rref_steps(m, reduced):
    try:
        if m.rows * m.cols > 36:
            return None
        steps, mine, _ = row_reduce(m)
        if mine != reduced or not steps:
            return None
        steps.append(step("Every pivot is $1$ with zeros above and below it: this is the reduced row echelon form."))
        return steps if count(steps) <= MAX_STEPS else None
    except Exception:
        return None


def inverse_steps(m, inverse):
    try:
        n = m.rows
        if n > 5:
            return None
        start = m.row_join(sp.eye(n))
        steps = [step("Write the matrix beside the identity matrix.", augmented(start, n))]
        reduction, result, _ = row_reduce(start, split=n, limit=n)
        steps += reduction
        if result[:, :n] != sp.eye(n) or result[:, n:] != inverse:
            return None
        steps.append(step("The left half is now the identity, so the right half is the inverse.", tex(inverse)))
        return steps if count(steps) <= MAX_STEPS else None
    except Exception:
        return None


def determinant_steps(m, value):
    try:
        if m.rows > 4:
            return None
        steps = [determinant_step(m)]
        if not same(sp.expand(m.det()), sp.expand(value)):
            return None
        return steps if count(steps) <= MAX_STEPS else None
    except Exception:
        return None


def determinant_step(m):
    n = m.rows
    name = f"\\det{tex(m)}"
    if n == 1:
        return step("A 1×1 determinant is its entry.", f"{name} = {tex(m[0, 0])}")
    if n == 2:
        a, b, c, d = m[0, 0], m[0, 1], m[1, 0], m[1, 1]
        value = sp.expand(a * d - b * c)
        return step(
            "For a 2×2 matrix, $\\det\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc$.",
            f"{name} = {grouped(tex(a))} \\cdot {grouped(tex(d))} - {grouped(tex(b))} \\cdot {grouped(tex(c))} = {tex(value)}",
        )
    # Expand along the row or column with the most zeros: fewer minors to work out.
    lines = [("row", i, list(m.row(i))) for i in range(n)] + [("column", j, list(m.col(j))) for j in range(n)]
    kind, index, entries = max(lines, key=lambda line: sum(1 for v in line[2] if v == 0))
    terms = []
    substeps = []
    total = 0
    for k, entry in enumerate(entries):
        i, j = (index, k) if kind == "row" else (k, index)
        if entry == 0:
            continue
        minor = m.minor_submatrix(i, j)
        sign = (-1) ** (i + j)
        minor_value = sp.expand(minor.det())
        total += sign * entry * minor_value
        terms.append(f"{'-' if sign < 0 else '+'} {grouped(tex(entry))} \\cdot \\det{tex(minor)}")
        substeps.append(determinant_step(minor))
    expansion = " ".join(terms).lstrip("+ ").strip() or "0"
    return step(
        f"Expand along {kind} {index + 1} (it has the most zeros): each entry times its minor, with signs $+, -, +, \\ldots$.",
        f"{name} = {expansion} = {tex(sp.expand(total))}",
        substeps,
    )


def linear_system_steps(equations, variables, solution):
    """Gaussian elimination on [A | b] for a square system with one solution."""
    try:
        n = len(variables)
        if len(equations) != n or n > 5:
            return None
        a, b = sp.linear_eq_to_matrix([eq.lhs - eq.rhs for eq in equations], variables)
        if a.det() == 0:
            return None
        start = a.row_join(b)
        steps = [
            step(
                "Write the system as an augmented matrix: the coefficients, then the right-hand sides.",
                augmented(start, n),
            )
        ]
        reduction, result, _ = row_reduce(start, split=n, limit=n)
        steps += reduction
        values = list(result[:, n])
        expected = list(solution.args[0]) if isinstance(solution, sp.FiniteSet) and len(solution.args) == 1 else None
        if expected is None or len(expected) != n or any(not same(v, e) for v, e in zip(values, expected)):
            return None
        steps.append(
            step(
                "Each row now reads one variable's value.",
                ",\\quad ".join(f"{tex(var)} = {tex(val)}" for var, val in zip(variables, values)),
            )
        )
        return steps if count(steps) <= MAX_STEPS else None
    except Exception:
        return None
