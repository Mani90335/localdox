/**
 * Browser-chrome theme colors: the `<meta name="theme-color">` the OS paints
 * the address bar / status bar with, before the app's own stylesheet (and its
 * `--background` custom property) is even parsed. A meta tag's `content` has
 * to be a literal color, so these can't reference `styles.css` directly —
 * they're kept in sync with it by hand.
 *
 * Must match `--background` in `styles.css`'s `:root` and `.dark` blocks.
 * `THEME_COLOR_DARK` is the sRGB rendering of `oklch(0.185 0.014 265)`.
 */
export const THEME_COLOR_LIGHT = "#ffffff";
export const THEME_COLOR_DARK = "#101319";
