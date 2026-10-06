/**
 * An exam is a file. Opening `paper.xam` studies it; its rules come from the
 * `.xrule` its header names (rules-tag.ts), or, for a paper that names none,
 * one the workspace's own folders place beside or above it. This module
 * finds those rules and keeps one study plan per paper file in step with the
 * files, without ever rewriting what an attempt already used.
 */
import { readExamFile } from "./exam-setup.ts";
import { attachExamFile, createExamPlan, type StudyPlanRecord } from "./study-plan.ts";
import type { AttemptRecord } from "./storage.ts";
import { xruleTemplate } from "./templates.ts";
import { isXrule, parseXrule } from "./xrule.ts";
import { rulesTag } from "./rules-tag.ts";

interface FileLike {
  id: string;
  name: string;
  /** A paper's text, read for the ruleset its header names. */
  content?: string;
  folderId?: string | null;
  deletedAt?: number | null;
}
interface FolderLike {
  id: string;
  parentId?: string | null;
}
export type RulesLookup<F> =
  | { kind: "found"; file: F }
  /** `tagged`: the ruleset the paper names, which isn't in the workspace. */
  | { kind: "missing"; tagged?: string }
  | { kind: "ambiguous"; files: F[] };

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/**
 * Which `.xrule` governs a paper. The ruleset its header names wins, and when
 * that one is gone (binned, renamed) the paper says so rather than quietly
 * running under another. A paper that names none searches from its folder up
 * to the workspace root. At each level, `name.xrule` matching the paper wins; else a
 * level with exactly one `.xrule` applies it to every paper beneath, the way
 * an exam type does. Two or more unrelated rules files at one level stop the
 * search: guessing between them would run an exam under the wrong rules.
 */
export function rulesFileFor<F extends FileLike>(
  paper: FileLike,
  files: F[],
  folders: FolderLike[],
): RulesLookup<F> {
  const rules = files.filter((f) => !f.deletedAt && isXrule(f.name));
  const tag = paper.content === undefined ? null : rulesTag(paper.content);
  if (tag) {
    const named = rules.filter((f) => f.name === tag);
    if (named.length === 1) return { kind: "found", file: named[0] };
    return named.length ? { kind: "ambiguous", files: named } : { kind: "missing", tagged: tag };
  }
  const parents = new Map(folders.map((f) => [f.id, f.parentId ?? null]));
  const seen = new Set<string | null>();
  let level: string | null = paper.folderId ?? null;
  while (!seen.has(level)) {
    seen.add(level);
    const here = rules.filter((f) => (f.folderId ?? null) === level);
    const named = here.find((f) => stem(f.name) === stem(paper.name));
    if (named) return { kind: "found", file: named };
    if (here.length === 1) return { kind: "found", file: here[0] };
    if (here.length > 1) return { kind: "ambiguous", files: here };
    if (level === null) break;
    level = parents.get(level) ?? null;
  }
  return { kind: "missing" };
}

/** A stable, schema-safe plan id for the paper file. */
export const paperPlanId = (fileId: string) => `paper-${fileId.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;

/** Cheap change detection (FNV-1a); not a security boundary. */
export function sourceFingerprint(...parts: string[]): string {
  let hash = 0x811c9dc5;
  for (const char of parts.join("\u0000")) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface PaperSource {
  fileId: string;
  paper: { name: string; text: string };
  rules: { name: string; text: string };
  images?: Record<string, Blob>;
}
export type PaperPlanSync =
  | { kind: "current"; plan: StudyPlanRecord }
  | { kind: "built"; plan: StudyPlanRecord }
  /** The files changed after an attempt; the plan keeps what attempts used. */
  | { kind: "pinned"; plan: StudyPlanRecord };

async function build(source: PaperSource, now: number): Promise<StudyPlanRecord> {
  const setup = parseXrule(source.rules.text, source.rules.name),
    id = paperPlanId(source.fileId),
    plan = createExamPlan(setup, now, id),
    content = readExamFile(
      setup,
      plan.plan.days[0].examId,
      source.paper.text,
      source.paper.name,
      source.images,
    );
  return attachExamFile(plan, content, now);
}

/**
 * The paper's plan, rebuilt from the files when they changed and nothing
 * depends on the old version. Before the first attempt, edits apply at once.
 * After an attempt the plan is pinned, because scores and attempt limits
 * refer to that version. Throws the import error when the files can't be read.
 */
export async function syncPaperPlan(
  existing: StudyPlanRecord | undefined,
  source: PaperSource,
  attempts: AttemptRecord[],
  now = Date.now(),
): Promise<PaperPlanSync> {
  const fingerprint = sourceFingerprint(source.rules.text, source.paper.text);
  if (existing?.source?.fingerprint === fingerprint) return { kind: "current", plan: existing };
  if (existing && attempts.some((a) => a.study?.planId === existing.id))
    return { kind: "pinned", plan: existing };
  const fresh = await build(source, now);
  return {
    kind: "built",
    plan: {
      ...fresh,
      ...(existing ? { createdAt: existing.createdAt } : {}),
      source: { fileId: source.fileId, fingerprint },
    },
  };
}

/** The rules a new `paper.xrule` starts with. */
export const starterRules = (paperName: string) => xruleTemplate(stem(paperName));
