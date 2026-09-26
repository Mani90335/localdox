// A typeface pulled from Google Fonts by name.
//
// The sibling to custom-font.ts: that one holds a file the reader uploaded,
// this one points at a family Google already hosts. Both end up as
// `--font-body`/`--font-heading`, chosen by `data-font` on <html>.
//
// Only the *name* is stored, in the prefs blob — there is no binary to keep.
// The face is fetched from Google's CDN at load time, which means it needs the
// network on first use and tells Google the reader asked for that family. That
// is a real departure for an otherwise local-first reader, so it is opt-in:
// nothing is requested until someone names a family.

/** The family name the CSS refers to, set from the reader's choice at runtime. */
export const GOOGLE_FONT_VAR = "--font-google-family";

const LINK_ID = "localdox-google-font";

/** Google's own limit on what a family name can contain; anything else is not
 *  a family and must not be pasted into a URL. */
const VALID_FAMILY = /^[\w][\w .+-]{0,48}$/;

export function isValidGoogleFamily(family: string): boolean {
  return VALID_FAMILY.test(family.trim());
}

/**
 * Build the stylesheet URL for a family.
 *
 * Weights are pinned to the four the app actually uses rather than the full
 * axis: a variable family served whole is several hundred kilobytes, and the
 * reading surface only ever asks for regular, medium, semibold and bold plus
 * their italics.
 */
export function googleFontUrl(family: string): string {
  const name = family.trim().replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700&display=swap`;
}

/**
 * Point the app at `family`, replacing whatever was loaded before.
 *
 * Resolves once the face is actually usable, so the caller can tell a real
 * family from a typo — Google answers an unknown name with a 400, and the
 * `<link>` fires `error`. A family that never loads must not be saved, or the
 * reader is left on a font that silently falls back forever.
 */
export function loadGoogleFont(family: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      resolve();
      return;
    }
    if (!isValidGoogleFamily(family)) {
      reject(new Error("Not a valid font family name"));
      return;
    }

    document.getElementById(LINK_ID)?.remove();
    const link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    link.href = googleFontUrl(family);
    link.onload = () => {
      // The stylesheet landing is not the same as the face being ready; ask the
      // font loader for the family itself so the caller's success really means
      // "this renders now". A browser without the API just takes the load.
      if (!("fonts" in document)) {
        resolve();
        return;
      }
      document.fonts
        .load(`400 1rem "${family}"`)
        .then((faces) => (faces.length ? resolve() : reject(new Error("Font family not found"))))
        .catch(() => reject(new Error("Font family not found")));
    };
    link.onerror = () => reject(new Error("Could not reach Google Fonts"));
    document.head.appendChild(link);

    // The family name drives the CSS var; the `[data-font="google"]` block in
    // styles.css reads it, so the stylesheet never has to know the name.
    document.documentElement.style.setProperty(GOOGLE_FONT_VAR, `"${family}"`);
  });
}

/** Drop the stylesheet and the family var. */
export function unloadGoogleFont(): void {
  if (typeof document === "undefined") return;
  document.getElementById(LINK_ID)?.remove();
  document.documentElement.style.removeProperty(GOOGLE_FONT_VAR);
}
