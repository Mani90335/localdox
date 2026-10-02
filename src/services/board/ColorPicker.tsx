// A custom colour picker: a hue/saturation wheel, a brightness slider, a hex
// field, the screen eyedropper where the browser has one, and recent picks.
//
// Built here rather than taken from a package: the small permissive pickers
// (react-colorful) draw a square, not a wheel, and the wheel packages bring a
// family of dependencies with them. This is one canvas and a few inputs.
//
// Changes flow out through `onChange(hex, commit)`. Dragging previews with
// `commit: false` and commits once on release, so a drag is one undo step.

import { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex, hsvToRgb, parseHex, type Hsv } from "./color";
import { Icon } from "./icons";

const SIZE = 168;
const RECENTS_KEY = "localdox:board-recent-colors";
const MAX_RECENTS = 8;

function readRecents(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((c) => typeof c === "string" && parseHex(c)) : [];
  } catch {
    return [];
  }
}

function remember(hex: string) {
  try {
    const next = [hex, ...readRecents().filter((c) => c !== hex)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: recents just aren't kept.
  }
}

type EyeDropperResult = { sRGBHex: string };
type EyeDropperCtor = new () => { open(): Promise<EyeDropperResult> };
const eyeDropper = () =>
  (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper as EyeDropperCtor | undefined;

/** Paints the wheel at brightness `v`: hue around, saturation outward. */
function paintWheel(canvas: HTMLCanvasElement, v: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(SIZE * dpr);
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(px, px);
  const r = px / 2;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const [cr, cg, cb] = hsvToRgb({ h, s: Math.min(1, d / r), v });
      const i = (y * px + x) * 4;
      image.data[i] = cr;
      image.data[i + 1] = cg;
      image.data[i + 2] = cb;
      // A one-pixel soft rim instead of a jagged edge.
      image.data[i + 3] = Math.round(Math.min(1, r - d) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function ColorPicker({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (hex: string, commit: boolean) => void;
}) {
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0.2 });
  const [draft, setDraft] = useState(() => parseHex(value) ?? "");
  const [recents, setRecents] = useState(readRecents);
  const dragging = useRef(false);
  const editingHex = useRef(false);
  const hex = hsvToHex(hsv);

  // Follow the selection when it changes from outside (another swatch, undo),
  // keeping the hue when the new colour is a grey, which has none.
  useEffect(() => {
    if (dragging.current) return;
    const next = hexToHsv(value);
    if (!next || hsvToHex(next) === hsvToHex(hsv)) return;
    setHsv((current) => ({ ...next, h: next.s === 0 ? current.h : next.h }));
    if (!editingHex.current) setDraft(parseHex(value) ?? "");
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wheelRef.current) paintWheel(wheelRef.current, hsv.v);
  }, [hsv.v]);

  const apply = (next: Hsv, commit: boolean) => {
    setHsv(next);
    const out = hsvToHex(next);
    if (!editingHex.current) setDraft(out);
    onChange(out, commit);
    if (commit) {
      remember(out);
      setRecents(readRecents());
    }
  };

  const fromPointer = (e: React.PointerEvent<HTMLCanvasElement>): Hsv => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    // Picking on a black wheel would be invisible: lift brightness to full.
    return { h, s, v: hsv.v < 0.15 ? 1 : hsv.v };
  };

  const radius = SIZE / 2;
  const angle = (hsv.h * Math.PI) / 180;
  const marker = {
    left: radius + Math.cos(angle) * hsv.s * radius,
    top: radius + Math.sin(angle) * hsv.s * radius,
  };
  const pickFromScreen = eyeDropper();

  return (
    <div className="board-color-picker" role="group" aria-label={label}>
      <div className="board-color-picker__wheel" style={{ width: SIZE, height: SIZE }}>
        <canvas
          ref={wheelRef}
          className="board-color-picker__canvas"
          role="slider"
          tabIndex={0}
          aria-label="Color wheel"
          aria-roledescription="color wheel"
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={Math.round(hsv.h)}
          aria-valuetext={`${hex}, hue ${Math.round(hsv.h)}°, saturation ${Math.round(hsv.s * 100)}%. Arrow keys: left and right change hue, up and down change saturation.`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = true;
            apply(fromPointer(e), false);
          }}
          onPointerMove={(e) => {
            if (dragging.current) apply(fromPointer(e), false);
          }}
          onPointerUp={(e) => {
            if (!dragging.current) return;
            dragging.current = false;
            apply(fromPointer(e), true);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 15 : 3;
            let next: Hsv | null = null;
            if (e.key === "ArrowRight") next = { ...hsv, h: (hsv.h + step + 360) % 360 };
            if (e.key === "ArrowLeft") next = { ...hsv, h: (hsv.h - step + 360) % 360 };
            if (e.key === "ArrowUp") next = { ...hsv, s: Math.min(1, hsv.s + step / 100) };
            if (e.key === "ArrowDown") next = { ...hsv, s: Math.max(0, hsv.s - step / 100) };
            if (!next) return;
            e.preventDefault();
            e.stopPropagation();
            apply(next, true);
          }}
        />
        <span
          className="board-color-picker__marker"
          style={{ ...marker, background: hex }}
          aria-hidden="true"
        />
      </div>

      <label className="board-color-picker__row">
        <span className="board-color-picker__label">Brightness</span>
        <input
          type="range"
          className="board-color-picker__range"
          min={0}
          max={100}
          value={Math.round(hsv.v * 100)}
          aria-valuetext={`${Math.round(hsv.v * 100)}%`}
          style={
            {
              "--range-to": hsvToHex({ h: hsv.h, s: hsv.s, v: 1 }),
            } as React.CSSProperties
          }
          onChange={(e) => apply({ ...hsv, v: Number(e.target.value) / 100 }, false)}
          onPointerUp={() => apply(hsv, true)}
          onKeyUp={() => apply(hsv, true)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>

      <div className="board-color-picker__row">
        <span className="board-color-picker__preview" style={{ background: hex }} />
        <label className="board-color-picker__hex">
          <span aria-hidden="true">#</span>
          <input
            aria-label="Hex color"
            value={draft.replace(/^#/, "")}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            onFocus={(e) => {
              editingHex.current = true;
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setDraft(e.target.value);
              const parsed = parseHex(e.target.value);
              const next = parsed && hexToHsv(parsed);
              if (next) {
                setHsv(next);
                onChange(parsed, false);
              }
            }}
            onBlur={() => {
              editingHex.current = false;
              const parsed = parseHex(draft);
              if (parsed) {
                onChange(parsed, true);
                remember(parsed);
                setRecents(readRecents());
                setDraft(parsed);
              } else setDraft(hex);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(hex);
                editingHex.current = false;
              }
            }}
          />
        </label>
        {pickFromScreen && (
          <button
            type="button"
            className="board-icon-button"
            aria-label="Pick a color from the screen"
            data-tip="Pick from screen"
            onClick={async () => {
              try {
                const { sRGBHex } = await new pickFromScreen().open();
                const parsed = parseHex(sRGBHex);
                const next = parsed && hexToHsv(parsed);
                if (next) apply(next, true);
              } catch {
                // Cancelled with Escape: nothing to do.
              }
            }}
          >
            <Icon name="eyedropper" size={18} />
          </button>
        )}
      </div>

      {recents.length > 0 && (
        <div className="board-color-picker__recents" role="group" aria-label="Recent colors">
          {recents.map((color) => (
            <button
              key={color}
              type="button"
              className="board-swatch board-swatch--small"
              aria-label={color}
              aria-pressed={color === hex}
              style={{ "--swatch": color } as React.CSSProperties}
              onClick={() => {
                const next = hexToHsv(color);
                if (next) apply(next, true);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
