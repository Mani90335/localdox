import { useEffect, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import {
  CUSTOM_FONT_ACCEPT,
  CUSTOM_FONT_FAMILY,
  deleteCustomFont,
  getCustomFont,
  isSupportedFontFile,
  putCustomFont,
  registerCustomFont,
  unregisterCustomFont,
} from "@/lib/fonts/custom-font";
import { isValidGoogleFamily, loadGoogleFont, unloadGoogleFont } from "@/lib/fonts/google-font";
import { Section, Group, Row, IconButton } from "./primitives";
import type { ReadingFont } from "@/lib/workspace/persistence";

/**
 * The reading face: one bundled typeface, plus whatever the reader uploads.
 *
 * The font file is held in IndexedDB rather than the prefs blob (binaries do
 * not belong in localStorage) and registered with the FontFace API under a
 * fixed family name that `[data-font="custom"]` points at.
 */
export function ReadingFontSettings({
  readingFont,
  onSetReadingFont,
  googleFont,
  onSetGoogleFont,
}: {
  readingFont: ReadingFont;
  onSetReadingFont: (font: ReadingFont) => void;
  googleFont: string | null;
  onSetGoogleFont: (family: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The family being typed, kept separate from the saved one: a half-typed
  // name must not knock the reader's working font out from under them.
  const [familyDraft, setFamilyDraft] = useState(googleFont ?? "");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const applyGoogleFamily = async () => {
    const family = familyDraft.trim();
    if (!family) return;
    setGoogleError(null);
    if (!isValidGoogleFamily(family)) {
      setGoogleError("That doesn't look like a font family name.");
      return;
    }
    setGoogleBusy(true);
    try {
      // Prove the family exists before saving it. Google answers an unknown
      // name with a 400, and a saved-but-broken family would leave the reader
      // silently on the fallback stack with no clue why.
      await loadGoogleFont(family);
      onSetGoogleFont(family);
      onSetReadingFont("google");
    } catch (error) {
      setGoogleError(
        error instanceof Error && error.message === "Could not reach Google Fonts"
          ? "Could not reach Google Fonts."
          : `No family called "${family}" on Google Fonts.`,
      );
    } finally {
      setGoogleBusy(false);
    }
  };

  const removeGoogleFamily = () => {
    unloadGoogleFont();
    onSetGoogleFont(null);
    setFamilyDraft("");
    setGoogleError(null);
    if (readingFont === "google") onSetReadingFont("hyperlegible");
  };

  useEffect(() => {
    let cancelled = false;
    void getCustomFont().then((record) => {
      if (!cancelled) setCustomName(record?.name ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFile = async (file: File) => {
    setError(null);
    if (!isSupportedFontFile(file)) {
      setError("Use a .ttf, .otf, .woff or .woff2 file.");
      return;
    }
    setBusy(true);
    try {
      // Register before storing: an unreadable file should fail here and leave
      // whatever was already working in place.
      await registerCustomFont(file);
      await putCustomFont({ name: file.name, blob: file });
      setCustomName(file.name);
      onSetReadingFont("custom");
    } catch {
      setError("That file could not be read as a font.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    await deleteCustomFont();
    unregisterCustomFont();
    setCustomName(null);
    if (readingFont === "custom") onSetReadingFont("hyperlegible");
  };

  return (
    <Section title="Reading font">
      <Group>
        <button
          onClick={() => onSetReadingFont("hyperlegible")}
          aria-pressed={readingFont === "hyperlegible"}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/40"
        >
          <span className="min-w-0">
            <span
              className="block truncate text-base text-foreground"
              style={{ fontFamily: '"Atkinson Hyperlegible", ui-sans-serif, sans-serif' }}
            >
              Atkinson Hyperlegible
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              Drawn for maximum letterform distinction
            </span>
          </span>
          {readingFont === "hyperlegible" && <Check className="h-4 w-4 shrink-0 text-primary" />}
        </button>

        {customName ? (
          <div className="flex items-center gap-2 pr-2 transition-colors hover:bg-accent/40">
            <button
              onClick={() => onSetReadingFont("custom")}
              aria-pressed={readingFont === "custom"}
              className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span
                  className="block truncate text-base text-foreground"
                  style={{ fontFamily: `"${CUSTOM_FONT_FAMILY}", ui-sans-serif, sans-serif` }}
                >
                  {customName}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  Your font
                </span>
              </span>
              {readingFont === "custom" && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
            <IconButton onClick={() => void handleRemove()} label="Remove custom font" danger>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        ) : (
          <Row
            label="Your own font"
            hint="Upload a .ttf, .otf, .woff or .woff2"
            control={
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="coarse:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
              >
                {busy ? "Loading…" : "Upload"}
              </button>
            }
          />
        )}
      </Group>

      {error && <p className="px-1 text-xs text-destructive">{error}</p>}

      {/* A family hosted by Google, named rather than uploaded. Kept below the
          upload because it is the option with a cost attached: the face is
          fetched from Google's servers at read time, which is the one place
          this reader stops being entirely local. */}
      <Group className="mt-2.5">
        {googleFont ? (
          <div className="flex items-center gap-2 pr-2 transition-colors hover:bg-accent/40">
            <button
              onClick={() => onSetReadingFont("google")}
              aria-pressed={readingFont === "google"}
              className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span
                  className="block truncate text-base text-foreground"
                  style={{ fontFamily: `"${googleFont}", ui-sans-serif, sans-serif` }}
                >
                  {googleFont}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  From Google Fonts
                </span>
              </span>
              {readingFont === "google" && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
            <IconButton onClick={removeGoogleFamily} label="Remove Google font" danger>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        ) : (
          <div className="px-4 py-3">
            <div className="text-sm text-foreground">A font from Google Fonts</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Type a family name, e.g. Lora or Source Serif 4. Fetched from Google when you read.
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <input
                value={familyDraft}
                onChange={(e) => setFamilyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void applyGoogleFamily();
                }}
                placeholder="Font family"
                aria-label="Google font family"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 coarse:min-h-11"
              />
              <button
                onClick={() => void applyGoogleFamily()}
                disabled={googleBusy || !familyDraft.trim()}
                className="coarse:min-h-11 shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
              >
                {googleBusy ? "Loading…" : "Use"}
              </button>
            </div>
          </div>
        )}
      </Group>

      {googleError && <p className="px-1 text-xs text-destructive">{googleError}</p>}

      <input
        ref={fileRef}
        type="file"
        accept={CUSTOM_FONT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
    </Section>
  );
}
