/** Small arithmetic interpreter; never executes JavaScript. Trigonometry uses radians. */
export function calculate(source: string): number {
  if (source.length > 500) throw new Error("Expression too long");
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+|[()+\-*/^!]/gi) ?? [];
  if (tokens.join("") !== source.replace(/\s/g, "")) throw new Error("Unsupported character");
  let position = 0,
    depth = 0;
  const functions: Record<string, (v: number) => number> = {
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    sqrt: Math.sqrt,
    ln: Math.log,
    log: Math.log10,
    abs: Math.abs,
    exp: Math.exp,
  };
  function primary(): number {
    if (++depth > 50) throw new Error("Expression too deep");
    const token = tokens[position++];
    let value: number;
    if (token === "(") {
      value = add();
      if (tokens[position++] !== ")") throw new Error("Expected )");
    } else if (token === "pi") value = Math.PI;
    else if (token === "e") value = Math.E;
    else if (Object.hasOwn(functions, token)) {
      if (tokens[position++] !== "(") throw new Error("Expected (");
      value = functions[token](add());
      if (tokens[position++] !== ")") throw new Error("Expected )");
    } else {
      value = Number(token);
      if (!token || !Number.isFinite(value)) throw new Error("Expected a number");
    }
    while (tokens[position] === "!") {
      position++;
      if (!Number.isInteger(value) || value < 0 || value > 170)
        throw new Error("Factorial requires an integer from 0 to 170");
      let product = 1;
      for (let i = 2; i <= value; i++) product *= i;
      value = product;
    }
    depth--;
    return value;
  }
  function power(): number {
    const value = primary();
    if (tokens[position] === "^") {
      position++;
      return value ** unary();
    }
    return value;
  }
  function unary(): number {
    if (tokens[position] === "+") {
      position++;
      return unary();
    }
    if (tokens[position] === "-") {
      position++;
      return -unary();
    }
    return power();
  }
  function multiply(): number {
    let value = unary();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const op = tokens[position++],
        right = unary();
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }
  function add(): number {
    let value = multiply();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const op = tokens[position++],
        right = multiply();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }
  const value = add();
  if (position !== tokens.length || !Number.isFinite(value))
    throw new Error("Invalid or non-finite result");
  return value;
}
