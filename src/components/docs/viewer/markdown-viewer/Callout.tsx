import {
  Info,
  AlertTriangle,
  Lightbulb,
  AlertOctagon,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { extractText } from "./extract-text";

/**
 * The seven GitHub admonition types, collapsed onto four visual tones. Seven
 * distinct colours would be seven things to learn; the reader only ever needs
 * to know how loudly a box is speaking, so the tones are graded by urgency —
 * `info` for context, `success` for advice, `warn` for care, `danger` for
 * consequences — and the label carries the exact word. Tone is applied by
 * `data-tone` in `styles.css` rather than by utility classes, so the callout
 * is themed from the same tokens as the rest of the reader.
 */
const CALLOUT_MAP: Record<string, { icon: LucideIcon; label: string; tone: string }> = {
  NOTE: { icon: StickyNote, label: "Note", tone: "info" },
  INFO: { icon: Info, label: "Info", tone: "info" },
  TIP: { icon: Lightbulb, label: "Tip", tone: "success" },
  WARNING: { icon: AlertTriangle, label: "Warning", tone: "warn" },
  CAUTION: { icon: AlertTriangle, label: "Caution", tone: "warn" },
  DANGER: { icon: AlertOctagon, label: "Danger", tone: "danger" },
  IMPORTANT: { icon: AlertOctagon, label: "Important", tone: "danger" },
};

const CALLOUT_RE = /^\s*\[!(NOTE|INFO|TIP|WARNING|CAUTION|DANGER|IMPORTANT)\]\s*(.*)/is;

export function Callout({ children, ...rest }: any) {
  const kids = Array.isArray(children) ? [...children] : [children];
  let type: string | null = null;

  // The marker is on the blockquote's first *element* child. react-markdown
  // keeps the newlines between block children as plain strings, so the first
  // entry in this array is almost always "\n" rather than the paragraph — the
  // scan used to look at that string, find no `props` on it, and give up
  // immediately, which is why no callout in any document ever rendered and
  // every one of them showed its raw `[!NOTE]` marker to the reader.
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (typeof c === "string" && !c.trim()) continue;
    if (!c?.props) break;
    const m = CALLOUT_RE.exec(extractText(c.props.children));
    if (!m) break;
    type = m[1].toUpperCase();
    // Drop the marker, keeping whatever followed it on the same line.
    const remainder = m[2];
    kids[i] = remainder ? { ...c, props: { ...c.props, children: remainder } } : null;
    break;
  }

  if (!type) {
    return <blockquote {...rest}>{children}</blockquote>;
  }

  const cfg = CALLOUT_MAP[type];
  const Icon = cfg.icon;
  return (
    <aside className="docs-callout" data-tone={cfg.tone} role="note">
      <span className="docs-callout-mark" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <div className="docs-callout-body">
        <p className="docs-callout-label">{cfg.label}</p>
        {kids.filter(Boolean)}
      </div>
    </aside>
  );
}
