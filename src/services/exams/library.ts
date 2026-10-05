import { importExam } from "./validation.ts";
import { parseJson, rulesetSchema, ExamImportError } from "./schema.ts";
import type { ExamRecord } from "./storage.ts";
const rulesFiles = import.meta.glob<string>("../../../exams/**/*.exam.json", {
  query: "?raw",
  import: "default",
});
const papers = import.meta.glob<string>("../../../exams/**/*.paper.md", {
  query: "?raw",
  import: "default",
});
const taxonomies = import.meta.glob<string>("../../../exams/taxonomies/*.taxonomy.json", {
  query: "?raw",
  import: "default",
});
// URL modules contain a URL only. No solution contents enter a JavaScript chunk.
const solutionUrls = import.meta.glob<string>("../../../exams/**/*.solutions.md", {
  query: "?url&no-inline",
  import: "default",
});
const basename = (path: string) => path.split("/").at(-1)!;
export async function bundledExams(): Promise<{ exams: ExamRecord[]; errors: string[] }> {
  const exams: ExamRecord[] = [],
    errors: string[] = [];
  for (const [path, read] of Object.entries(rulesFiles))
    try {
      const source = await read(),
        rules = parseJson(source, rulesetSchema, path),
        paperPath = path.replace(".exam.json", ".paper.md"),
        solutionPath = path.replace(".exam.json", ".solutions.md");
      if (!papers[paperPath] || !solutionUrls[solutionPath])
        throw new Error(`${path}: companion paper or solutions file missing`);
      const tax = rules.diagnostics.taxonomyRef
        ? Object.entries(taxonomies).find(
            ([p]) => basename(p) === basename(rules.diagnostics.taxonomyRef!),
          )?.[1]
        : undefined;
      const exam = importExam(source, await papers[paperPath](), tax ? await tax() : undefined);
      exams.push({ id: rules.meta.id, exam, solutionUrl: await solutionUrls[solutionPath]() });
    } catch (error) {
      errors.push(String(error));
    }
  return { exams, errors };
}
export async function importFiles(files: File[]): Promise<ExamRecord[]> {
  const ruleFiles = files.filter((f) => f.name.endsWith(".exam.json"));
  if (!ruleFiles.length)
    throw new ExamImportError([
      {
        severity: "error",
        location: "files",
        message:
          "Select .exam.json, matching .paper.md and .solutions.md, plus the referenced taxonomy",
      },
    ]);
  const result: ExamRecord[] = [];
  const find = (name: string) => {
    const matches = files.filter((f) => f.name === name);
    if (matches.length > 1) throw new Error(`Ambiguous filename ${name}`);
    return matches[0];
  };
  for (const file of ruleFiles) {
    const source = await file.text(),
      rules = parseJson(source, rulesetSchema, file.name),
      stem = file.name.slice(0, -".exam.json".length),
      paper = find(`${stem}.paper.md`),
      solutionFile = find(`${stem}.solutions.md`);
    if (!paper || !solutionFile)
      throw new ExamImportError([
        {
          severity: "error",
          location: file.name,
          message: `Missing ${stem}.paper.md or ${stem}.solutions.md`,
        },
      ]);
    const taxonomy = rules.diagnostics.taxonomyRef
      ? find(basename(rules.diagnostics.taxonomyRef))
      : undefined;
    const exam = importExam(
      source,
      await paper.text(),
      taxonomy ? await taxonomy.text() : undefined,
    );
    if (result.some((e) => e.id === rules.meta.id))
      throw new Error(`Duplicate exam id ${rules.meta.id}`);
    // Store the opaque File in IndexedDB. Do not call text() before submission.
    result.push({ id: rules.meta.id, exam, solutionFile });
  }
  return result;
}
