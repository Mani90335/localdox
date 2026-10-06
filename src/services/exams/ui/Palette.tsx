/**
 * GATE/JEE-style question palette. Each state differs by shape and glyph as
 * well as colour, so it reads in greyscale and for colour-blind candidates.
 */
import type { Ruleset } from "../schema.ts";
import type { Question } from "../parser.ts";
import { questionState, type Session } from "../session.ts";
import type { UiProfile } from "./display.ts";

export type Status = "not_visited" | "not_answered" | "answered" | "marked" | "answered_marked";
export const STATUS_WORDS: Record<Status, string> = {
  not_visited: "not visited",
  not_answered: "not answered",
  answered: "answered",
  marked: "marked for review",
  answered_marked: "answered and marked for review",
};
const POINT_DOWN = "4,4 36,4 36,25 20,37 4,25";
const POINT_UP = "20,3 36,15 36,36 4,36 4,15";

function Shape({ status, family }: { status: Status; family: UiProfile["glyphs"] }) {
  const square = (
    <rect className="shape" x="3" y="3" width="34" height="34" rx="7" strokeWidth="1.5" />
  );
  const circle = <circle className="shape" cx="20" cy="20" r="17" strokeWidth="1.5" />;
  if (family === "pentagon") {
    if (status === "not_visited") return square;
    if (status === "not_answered")
      return <polygon className="shape" points={POINT_DOWN} strokeLinejoin="round" />;
    if (status === "answered")
      return <polygon className="shape" points={POINT_UP} strokeLinejoin="round" />;
    return circle;
  }
  if (family === "circle") {
    return status === "marked" || status === "answered_marked" ? square : circle;
  }
  return square;
}
export function Glyph({
  status,
  family,
  children,
}: {
  status: Status;
  family: UiProfile["glyphs"];
  children?: React.ReactNode;
}) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={`g-${status}`}>
      <Shape status={status} family={family} />
      {family === "square" && (status === "marked" || status === "answered_marked") && (
        // Folded corner: the "flag" for square glyphs.
        <polygon points="26,3 37,3 37,14" fill="var(--ex-surface)" opacity="0.9" />
      )}
      {status === "answered_marked" && (
        <g>
          <circle className="tick-bg" cx="31" cy="31" r="8" strokeWidth="2" />
          <path
            d="m27.5 31 2.5 2.5 4.5-5"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {children}
    </svg>
  );
}

export function QuestionPalette({
  r,
  paper,
  session,
  ids,
  currentId,
  family,
  onNavigate,
}: {
  r: Ruleset;
  paper: Question[];
  session: Session;
  ids: string[];
  currentId: string;
  family: UiProfile["glyphs"];
  onNavigate: (id: string) => void;
}) {
  const current = paper.find((q) => q.id === currentId)!;
  return (
    <div className="xr-palette" role="group" aria-label="Question palette">
      {ids.map((id) => {
        const n = session.order.indexOf(id) + 1,
          status = questionState(session, id).status as Status,
          target = paper.find((q) => q.id === id)!;
        return (
          <button
            key={id}
            type="button"
            className={`xr-cell g-${status}`}
            aria-label={`Question ${n}: ${STATUS_WORDS[status]}`}
            aria-current={id === currentId ? "true" : undefined}
            disabled={
              (!r.navigation.free && id !== currentId) ||
              session.lockedSections.includes(target.section) ||
              (r.timing.mode === "per_section" && target.section !== current.section)
            }
            onClick={() => onNavigate(id)}
          >
            <Glyph status={status} family={family} />
            <span>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PaletteLegend({
  counts,
  family,
  showMarked,
}: {
  counts: Record<Status, number>;
  family: UiProfile["glyphs"];
  showMarked: boolean;
}) {
  const rows: { status: Status; label: string; wide?: boolean }[] = [
    { status: "answered", label: "Answered" },
    { status: "not_answered", label: "Not answered" },
    { status: "not_visited", label: "Not visited" },
    ...(showMarked
      ? [
          { status: "marked" as const, label: "Marked" },
          { status: "answered_marked" as const, label: "Answered & marked", wide: true },
        ]
      : []),
  ];
  return (
    <ul className="xr-legend" aria-label="Palette legend">
      {rows.map((row) => (
        <li key={row.status} className={row.wide ? "wide" : undefined}>
          <span className="xr-glyph">
            <Glyph status={row.status} family={family} />
          </span>
          <span>
            {row.label} <strong>{counts[row.status]}</strong>
          </span>
        </li>
      ))}
    </ul>
  );
}
export function statusTally(session: Session, ids: string[]): Record<Status, number> {
  const tally: Record<Status, number> = {
    not_visited: 0,
    not_answered: 0,
    answered: 0,
    marked: 0,
    answered_marked: 0,
  };
  for (const id of ids) tally[questionState(session, id).status as Status]++;
  return tally;
}
/**
 * The TCS iON submit summary: each palette state in its own column, so the
 * columns add up to the section's questions.
 */
export function SummaryTable({
  rows,
  counted,
}: {
  rows: { name: string; counts: Record<Status, number> }[];
  /** Whether answers marked for review are graded; the column says so. */
  counted: boolean;
}) {
  const columns: { status: Status; label: string }[] = [
    { status: "answered", label: "Answered" },
    { status: "not_answered", label: "Not answered" },
    { status: "marked", label: "Marked for review" },
    {
      status: "answered_marked",
      label: counted ? "Answered & marked (counted)" : "Answered & marked (not counted)",
    },
    { status: "not_visited", label: "Not visited" },
  ];
  return (
    <div className="ex-table-wrap">
      <table className="ex-table">
        <thead>
          <tr>
            <th scope="col">Section</th>
            <th scope="col" className="num">
              Questions
            </th>
            {columns.map((c) => (
              <th scope="col" className="num" key={c.status}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">{row.name}</th>
              <td className="num">{Object.values(row.counts).reduce((sum, n) => sum + n, 0)}</td>
              {columns.map((c) => (
                <td className="num" key={c.status}>
                  {row.counts[c.status]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
