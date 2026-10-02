# Math input (Compute)

Compute's input is a math field: fractions, powers and roots are written as
they look, from the keyboard or from a keypad embedded under the field. A
**Text** mode keeps the plain-text and LaTeX input (several lines, templates,
`[[1, 2], [3, 4]]`) for what a math field writes badly. Computing itself is
math-compute.md; this is how the question gets written.

## The problem

Compute used to take only text: `1/2 + 1/3`, `\int_0^1 x^2 dx`. That is fast for
someone who knows LaTeX and a wall for everyone else. `\frac{}{}`, `\sqrt[3]{}`
and `\lim_{x\to0}` have to be remembered, and a typo shows up only in the
"Reads as" preview below. On a phone it's worse: the symbols are three keyboard
layers deep. The old fix was a dialog with MathLive's own keyboard. It opened
over the panel, hid the result, and took a round trip for every expression.

## Mental model

A scientific calculator. You see the expression as it will be printed, the keys
under it put structures in (a fraction with two empty boxes, a root with one),
and the caret moves from box to box. **Enter** computes. The button beside the
field names what Enter does: **Evaluate**, or **Solve** once there is an `=`.
The other operations sit in a row underneath.

## Architecture

```
ComputePanel (input state, jobs, results)
 └─ ComputeComposer          mode switch · keypad toggle · primary action
     ├─ MathField            MathLive <math-field>, LaTeX in and out
     ├─ <textarea>           Text mode (unchanged contract, id compute-input)
     └─ MathKeypad           tabs of keys + ← → ⌫, drawn with <math-span>
            keys: math-keys.ts (data only; tests/compute-keys.test.ts)
compute-input.ts             mode/keypad preferences, text → math (asMath)
```

- **One value.** The panel holds one string, LaTeX in Math mode and whatever
  was typed in Text mode. Both engines read LaTeX, so switching Math → Text
  shows the field's LaTeX unchanged. Text → Math converts statement by
  statement with `prepareInput` (`sqrt(8)` → `\sqrt8`, lines → `;`). When a
  part can't be read (a distribution line such as `X ~ N(0, 1)`), the input
  stays Text and a toast says so, rather than turning into a row of letters.
- **Our keypad, MathLive's field.** MathLive (MIT, already the editor's
  equation dialog) does the hard part, structural editing. Its built-in
  keyboard is a page-wide singleton fixed to `<body>`, shared with that dialog
  and styled through its own variables. So the keypad is ours: React, app
  tokens, embedded in the panel's flow. It drives the field through MathLive's
  `insert` (templates with `#0`/`#?`/`#@` boxes), `typedText` (single
  characters, so shortcuts such as `pi` → π still apply) and commands
  (`moveToNextChar`, `addRowAfter`…). Key faces are MathLive's `<math-span>`,
  so a key looks like what it inserts.
- **Touch.** MathLive marks its input `inputmode=none`, so a phone never
  raises the system keyboard for it. The keypad is therefore complete:
  digits, letters (with Shift), arrows, delete. Focusing the field on a coarse
  pointer opens the keypad. Hold ⌫ or an arrow to repeat it.
- **Focus stays in the field.** Each key cancels its `pointerdown`, so taps
  don't steal the caret. A key pressed from the keyboard (Enter or Space on a
  focused key) keeps focus on the keypad, where arrow keys move between keys.

## Decisions that prevent wrong answers

- **Typing linearly means what it says.** MathLive keeps the caret in a
  denominator, exponent or root until an arrow key moves it out, so typing
  `1/2+1/3` gave 1/(2+⅓): it computed 3/7, not 5/6. `leaveSimpleBranch`
  (MathField.tsx) steps out first when `+ − = < > , ;` is typed at the end of
  a _simple_ part (digits, letters, `.`, a leading minus). `2^10+1`, `e^-x+1`
  and `sqrt2+1` read as meant, and parentheses still give `1/(2+x)`. It reads
  MathLive's internal model, which has no public API for this, inside a
  `try`. If MathLive changes, typing falls back to MathLive's own behaviour.
  `smartSuperscript` is off for the same reason: it left a power after one
  digit, so `2^10` became 2¹·0.
- **Empty boxes block computing.** The basic engine reads `\placeholder{}`
  as nothing (`□ + 1` is 1). `start()` refuses any job whose input still has
  a box: it selects the first box, and the line under the card says to fill
  it.
- **Enter carries the field's value.** MathLive reports `input` a moment
  after a keystroke, so a fast Enter used to run on the previous value. Enter
  hands the field's current LaTeX straight to the job (`onRun(latest)`).
- **`:=` writes `\coloneqq`.** MathLive's shortcut wrote `\coloneq`, which the
  advanced engine reads as an assignment it rejects. The keypad's Define key
  writes `\coloneqq` too.
- **What the field writes, the engine reads.** A math field writes every `[`
  as `\left[` and every `(` after `d/dx` as `\left(`. Two parser readings
  broke on that and are fixed in `preprocessLatex` (math-compute-advanced.md):
  `E\left[X\right]` was read as E alone (then a bridge crash), and
  `d/dx\left(x^2\right)+4` as d/dx of the whole sum (2x). Routing also sends
  `E\left[` and `P\left(` to the advanced engine. The keypad's E[□] key
  relies on both.

## Cost

Opening Compute now loads MathLive (215 KiB gzip) alongside the engine
worker: 519 KiB for a first result, up from 292 (optional-bundle-budgets.md).
Startup is unchanged. MathLive is precached by the offline shell, and if it
can't load, the composer falls back to Text with a note and tries again on the
next switch to Math (`loadMathlive` forgets a failed load).

## Preferences

Per device, in `localStorage`: `localdox:compute-input` (`math` | `text`,
default math) and `localdox:compute-keypad` (`open` | `closed`, default open).
A template from Advanced switches to Text for that session without changing
the preference.

## Debugging

- Wrong structure from typing: `mf.getValue("latex-unstyled")` in the console
  shows what the field holds. Compare it with how `leaveSimpleBranch` should
  have treated the caret's parent (`parentBranch`: `below`, `superscript`,
  `subscript`, or `body` of a `surd`).
- "Mathfield not mounted": `menuItems` and `inlineShortcuts` need the element
  in the document; set them after `appendChild`.
- In e2e, wait for `document.activeElement` to be the `MATH-FIELD` before
  typing. MathLive focuses its input about 60 ms after a click, and Tab
  between boxes briefly moves focus, so prefer the keypad's → key in tests.
- Tests: tests/compute-keys.test.ts (every template key is readable by its
  engine; text → math), tests/e2e/compute.spec.ts ("math input…"), and the
  `compute` journey in tests/e2e/bundle-journeys.spec.ts.

## Known limits

- Multi-line input (definitions on their own lines) is Text only. In Math,
  statements are separated with `;` (Define and `;` keys).
