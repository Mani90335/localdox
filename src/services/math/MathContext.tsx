// Document-wide math state, shared with every equation in the tree.
//
// Passed on context rather than through props for the same reason the viewer's
// saved-items context exists: equations are rendered deep inside markdown by
// react-markdown's component map, and threading state through that map would
// rebuild every renderer — and therefore re-render the whole document — every
// time any of this changed.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  buildEquationRegistry,
  EMPTY_EQUATION_REGISTRY,
  type EquationRegistry,
} from "./equation-registry";
import { DEFAULT_MATH_PREFERENCES, type MathPreferences } from "./types";

export interface MathContextValue {
  registry: EquationRegistry;
  preferences: MathPreferences;
  /**
   * Jump to an equation by label — what a clicked `\eqref` does.
   *
   * Supplied by the viewer, which is the only thing that knows how to reach an
   * equation that is in a different section of a paginated document.
   */
  navigateToEquation?: (label: string) => void;
}

const MathContext = createContext<MathContextValue>({
  registry: EMPTY_EQUATION_REGISTRY,
  preferences: DEFAULT_MATH_PREFERENCES,
});

export function useMathContext(): MathContextValue {
  return useContext(MathContext);
}

/**
 * Builds the registry for one document and publishes it.
 *
 * The registry is numbered from `source`, so it must be the *whole* document's
 * markdown even when only one section is on screen — otherwise equation 12
 * renumbers itself to 1 the moment the reader pages to its section. In
 * paginated mode the viewer passes the full document text here while rendering
 * a single chunk, which is exactly what keeps numbering stable.
 */
export function MathProvider({
  source,
  preferences = DEFAULT_MATH_PREFERENCES,
  navigateToEquation,
  children,
}: {
  source: string;
  preferences?: MathPreferences;
  navigateToEquation?: (label: string) => void;
  children: ReactNode;
}) {
  const registry = useMemo(
    () => buildEquationRegistry(source, { numbering: preferences.numberEquations }),
    [source, preferences.numberEquations],
  );

  const value = useMemo<MathContextValue>(
    () => ({ registry, preferences, navigateToEquation }),
    [registry, preferences, navigateToEquation],
  );

  return <MathContext.Provider value={value}>{children}</MathContext.Provider>;
}
