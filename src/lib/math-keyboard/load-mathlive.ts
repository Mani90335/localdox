// Lazy loader for MathLive's `<math-field>` custom element.
//
// Imported only once the reader opens the math keyboard from the editor
// toolbar, so its ~300KB (plus the KaTeX fonts it renders with) never touch
// the initial reading bundle — nobody who is only reading pays for it.
//
// The static directories have to be set before the first mathfield is
// created, so this loader is the one place that happens. Fonts are vendored
// under `public/mathlive/fonts` rather than left on MathLive's default (a
// path relative to its own CDN-hosted script), so composing an equation never
// reaches the network; keypress sounds are left off entirely.
let loading: Promise<typeof import("mathlive")> | null = null;

export function loadMathlive(): Promise<typeof import("mathlive")> {
  if (!loading) {
    loading = import("mathlive").then((mathlive) => {
      mathlive.MathfieldElement.fontsDirectory = "/mathlive/fonts";
      mathlive.MathfieldElement.soundsDirectory = null;
      return mathlive;
    });
  }
  return loading;
}

export type { MathfieldElement } from "mathlive";
