import { useState } from "react";
import { calculate } from "./calculator";
export function Calculator({ scientific }: { scientific: boolean }) {
  const [expression, setExpression] = useState(""),
    [result, setResult] = useState("");
  return (
    <details className="exam-card">
      <summary>{scientific ? "Scientific" : "Basic"} calculator</summary>
      <p className="exam-muted">{scientific ? "Trigonometric functions use radians." : ""}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (!scientific && /[a-z^!]/i.test(expression)) throw new Error("Use basic arithmetic");
            setResult(String(calculate(expression)));
          } catch (error) {
            setResult(String(error));
          }
        }}
      >
        <input
          aria-label="Calculator expression"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          placeholder="(2 + 3) / 4"
        />
        <div className="exam-keypad">
          {(scientific ? ["sin(", "cos(", "tan(", "sqrt(", "log(", "ln(", "pi", "^", "!"] : [])
            .concat([
              "7",
              "8",
              "9",
              "/",
              "4",
              "5",
              "6",
              "*",
              "1",
              "2",
              "3",
              "-",
              "0",
              ".",
              "(",
              ")",
              "+",
            ])
            .map((key) => (
              <button type="button" key={key} onClick={() => setExpression((v) => v + key)}>
                {key}
              </button>
            ))}
        </div>
        <div className="exam-actions">
          <button type="submit">Calculate</button>
          <button
            type="button"
            onClick={() => {
              setExpression("");
              setResult("");
            }}
          >
            Reset
          </button>
        </div>
        <output aria-live="polite">{result}</output>
      </form>
    </details>
  );
}
