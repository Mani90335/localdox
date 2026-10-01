// Which engine a request goes to. The basic engine (a few hundred KB, already
// warm) answers what it can; input it can't read goes to the advanced engine
// (SymPy, ~10 MB on first use, after the reader agrees). Decided from the
// text alone, before either engine loads; a basic "unsupported" answer is a
// second chance to send it on (ComputePanel).

/** LaTeX commands only the advanced engine reads. */
const ADVANCED_COMMANDS =
  /\\(?:int|iint|iiint|oint|lim|sum|prod|partial|binom|dbinom|tbinom|Gamma|det|nabla|operatorname|mathbb|mathcal|begin|sim|mid|Pr|zeta)(?![a-zA-Z])/;

/** Plain-text functions only the advanced engine knows. */
const ADVANCED_FUNCTIONS =
  /\b(?:diff|derivative|integrate|limit|det|inv|inverse|trace|tr|transpose|grad|gradient|var|variance|cov|corr|sd|std|pdf|cdf|mgf|mean|median|skewness|kurtosis|gamma|beta|erfc?|zeta|binomial|binom|choose|ncr)\s*\(/i;

export function needsAdvanced(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  // Several statements: definitions, distributions, systems, conditions.
  if (/\n|(?<!\\);/.test(text)) return true;
  if (/~|:=|\\coloneqq|^\s*(?:let|assume)\b/i.test(text)) return true;
  if (ADVANCED_COMMANDS.test(text) || ADVANCED_FUNCTIONS.test(text)) return true;
  // d/dx, d²y/dx²
  if (/\\frac\s*\{\s*(?:d|\\mathrm\{d\})(?:\s|\^|[a-zA-Z]|\})/.test(text)) return true;
  // primes, relations, lists and matrices, E[X], P(…)
  if (/'|<|>|≤|≥|≠|\\(?:le|ge|leq|geq|lt|gt|ne|neq)(?![a-zA-Z])|,|\[\s*\[/.test(text)) return true;
  if (/(?:^|[^A-Za-z\\])(?:E\s*\[|P\s*\()/.test(text)) return true;
  return false;
}
