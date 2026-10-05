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
// Images next to bundled exams, served as URLs and resolved by file name.
const imageUrls = import.meta.glob<string>("../../../exams/**/*.{png,jpg,jpeg,gif,webp,svg}", {
  query: "?url",
  import: "default",
});
const basename = (path: string) => path.split("/").at(-1)!;
const folder = (path: string) => path.slice(0, path.lastIndexOf("/"));
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
      const assetUrls: Record<string, string> = {};
      for (const [image, url] of Object.entries(imageUrls))
        if (folder(image) === folder(path)) assetUrls[basename(image)] = await url();
      exams.push({
        id: rules.meta.id,
        exam,
        solutionUrl: await solutionUrls[solutionPath](),
        ...(Object.keys(assetUrls).length ? { assetUrls } : {}),
      });
    } catch (error) {
      errors.push(String(error));
    }
  return { exams, errors };
}
/**
 * `images` are matched to a paper when its text names them. `shared` images
 * (used by sealed solutions, which are never read here) go with every exam.
 */
export async function importFiles(
  files: File[],
  { images = [], shared = [] }: { images?: File[]; shared?: File[] } = {},
): Promise<ExamRecord[]> {
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
    const paperText = await paper.text();
    const exam = importExam(source, paperText, taxonomy ? await taxonomy.text() : undefined);
    const used = [...new Set([...images.filter((i) => paperText.includes(i.name)), ...shared])];
    if (result.some((e) => e.id === rules.meta.id))
      throw new Error(`Duplicate exam id ${rules.meta.id}`);
    // Store the opaque File in IndexedDB. Do not call text() before submission.
    result.push({
      id: rules.meta.id,
      exam,
      solutionFile,
      ...(used.length ? { assets: Object.fromEntries(used.map((f) => [f.name, f])) } : {}),
    });
  }
  return result;
}
