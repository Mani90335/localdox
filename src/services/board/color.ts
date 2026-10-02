// Colour maths for the custom colour picker: hex parsing and HSV conversion.
//
// HSV, not HSL, because it maps directly onto the picker: hue is the angle
// around the wheel, saturation is the distance from its centre, and value is
// the brightness slider beneath it.

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

/**
 * Reads what a person types into a hex field: with or without "#", three or
 * six digits, any case. Returns the canonical "#rrggbb", or null if it isn't
 * a colour yet (so a half-typed value is simply not applied).
 */
export function parseHex(input: string): string | null {
  const digits = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(digits)) return `#${[...digits].map((d) => d + d).join("")}`;
  if (/^[0-9a-f]{6}$/.test(digits)) return `#${digits}`;
  return null;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const canonical = parseHex(hex);
  if (!canonical) return null;
  return [
    parseInt(canonical.slice(1, 3), 16),
    parseInt(canonical.slice(3, 5), 16),
    parseInt(canonical.slice(5, 7), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(...hsvToRgb(hsv));
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
