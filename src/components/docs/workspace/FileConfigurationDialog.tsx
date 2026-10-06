import { useMemo, useState } from "react";
import type { MdFile } from "@/lib/markdown/markdown-utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RulesetEditor } from "../pages/settings/RulesetEditor";
import { isRulesFile, rulesTag, rulesetTitle } from "@/services/exams/rules-tag";
import { parseXrule, xruleSchema } from "@/services/exams/xrule";
import { parseJson } from "@/services/exams/schema";
import { practiceXruleTemplate, xruleTemplate } from "@/services/exams/templates";
import { readPracticeFile } from "@/services/exams/practice";
import { clearPracticeProgress, formatPracticeTime, loadPracticeAnswers, loadPracticeTime, practiceSignature } from "@/services/exams/practice-progress";

/** A file's settings are edited here; shared rules are copied on save, never changed for other files. */
export function FileConfigurationDialog({ file, files, onSave, onClose }: {
  file: MdFile; files: MdFile[];
  onSave: (draft: string, sourceId?: string) => void;
  onClose: () => void;
}) {
  const practice = file.kind === "practice" || /\.xp$/i.test(file.name);
  const rulesets = files.filter(f => !f.deletedAt && isRulesFile(f));
  const linked = rulesets.find(f => f.name === rulesTag(file.content));
  const defaults = () => (practice ? practiceXruleTemplate : xruleTemplate)(file.name.replace(/\.[^.]+$/, ""));
  const [sourceId, setSourceId] = useState(linked?.id ?? "");
  const [draft, setDraft] = useState(linked?.content ?? defaults);
  const [reset, setReset] = useState(0);
  const checked = useMemo(() => {
    try {
      const raw = parseJson(draft, xruleSchema, "Rules");
      if (practice && !raw.practice) return { error: "Add practice controls under Advanced, or choose default settings." };
      if (!practice) parseXrule(draft);
      return { error: null, showTimes: raw.practice?.showElapsedTime ?? true };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [draft, practice]);
  const timings = useMemo(() => {
    if (!practice) return [];
    try {
      const sheet = readPracticeFile(file.content);
      const answers = loadPracticeAnswers(file.id);
      return sheet.questions.map((q, i) => {
        const sig = practiceSignature(q, sheet.solutionFor[q.id]);
        const answer = answers[q.id]?.sig === sig ? answers[q.id] : undefined;
        const ms = answer?.elapsedMs ?? loadPracticeTime(file.id, q.id, sig);
        return { number: i + 1, ms, outcome: answer?.reason === "timeout" ? "Timed out" : answer?.reason === "skipped" ? "Skipped" : answer?.outcome ?? (ms ? "In progress" : "Not started") };
      });
    } catch { return []; }
    // Reset deliberately refreshes browser-only progress while the modal stays open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, practice, reset]);
  const save = () => { if (!checked.error) onSave(draft, sourceId || undefined); };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0" onEscapeKeyDown={e => e.stopPropagation()}>
      <div className="border-b border-border px-5 py-4 pr-12">
        <DialogTitle>Configure {practice ? "practice" : "exam"}</DialogTitle>
        <DialogDescription className="mt-1 text-xs">{file.name} · Changes apply only to this file.{!practice && " Started attempts keep their original rules."}</DialogDescription>
      </div>
      <div className="min-h-0 space-y-5 overflow-y-auto p-5">
        <label className="block space-y-1.5 text-xs font-medium">Start from
          <select aria-label="Ruleset" className="min-h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={sourceId} onChange={e => { setSourceId(e.target.value); setDraft(rulesets.find(f => f.id === e.target.value)?.content ?? defaults()); }}>
            <option value="">Default settings</option>
            {rulesets.map(f => <option key={f.id} value={f.id}>{rulesetTitle(f)}</option>)}
          </select>
        </label>
        <RulesetEditor draft={draft} onChange={setDraft} name={file.name} onCancel={onClose} onSave={save} />
        {checked.error && <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">{checked.error}</p>}
        {practice && <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Session progress</summary>
          {checked.showTimes && timings.length > 0 && <table className="mt-3 w-full text-left text-xs tabular-nums">
            <thead><tr><th className="py-2">Question</th><th>Solve time</th><th>Result</th></tr></thead>
            <tbody>{timings.map(t => <tr key={t.number} className="border-t border-border"><td className="py-2">{t.number}</td><td>{formatPracticeTime(t.ms)}</td><td className="capitalize">{t.outcome}</td></tr>)}</tbody>
          </table>}
          <p className="my-3 text-xs text-muted-foreground">Solve times stay only in this browser. The timer pauses while configuring.</p>
          <button type="button" className="rounded-md border border-border px-3 py-2 text-xs" onClick={() => { if (window.confirm("Clear this file’s practice answers and solve times?")) { clearPracticeProgress(file.id); setReset(n => n + 1); } }}>Start over</button>
        </details>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <button type="button" className="rounded-md px-3 py-2 text-sm hover:bg-accent" onClick={onClose}>Cancel</button>
        <button type="button" className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40" disabled={!!checked.error} onClick={save}>Save</button>
      </div>
    </DialogContent>
  </Dialog>;
}
