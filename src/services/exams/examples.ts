/**
 * The example course, as the same files a learner would upload. "Try the
 * example plan" imports the plan and practice files (its exams are bundled
 * already); "Download example files" zips everything, exams included, so the
 * download is a working template for authors and for the GPT builder.
 */
const planFiles = import.meta.glob<string>("../../../plans/*.{plan.json,practice.md}", {
  query: "?raw",
  import: "default",
});
const planImages = import.meta.glob<string>("../../../plans/*.{png,jpg,jpeg,gif,webp,svg}", {
  query: "?url",
  import: "default",
});
const examText = import.meta.glob<string>(
  ["../../../exams/**/*.{exam.json,paper.md}", "../../../exams/taxonomies/*.taxonomy.json"],
  { query: "?raw", import: "default" },
);
const examUrls = import.meta.glob<string>(
  ["../../../exams/**/*.solutions.md", "../../../exams/**/*.{png,jpg,jpeg,gif,webp,svg}"],
  { query: "?url&no-inline", import: "default" },
);
const name = (path: string) => path.split("/").at(-1)!;
const asFile = (text: BlobPart, path: string) => new File([text], name(path));

/** Plan, practice files and their images. */
export async function examplePlanFiles(): Promise<File[]> {
  const files: File[] = [];
  for (const [path, load] of Object.entries(planFiles)) files.push(asFile(await load(), path));
  for (const [path, url] of Object.entries(planImages))
    files.push(asFile(await (await fetch(await url())).blob(), path));
  return files;
}

/** Everything the example plan needs, as one zip. */
export async function exampleZip(): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip(),
    plan = await examplePlanFiles(),
    source = await plan.find((f) => f.name.endsWith(".plan.json"))!.text(),
    examIds = new Set<string>(
      (JSON.parse(source) as { days: { examId: string }[] }).days.map((d) => d.examId),
    );
  for (const f of plan) zip.file(`course/${f.name}`, f);
  // Keep only the exam folders the plan uses, plus the taxonomies they need.
  const folders = new Set<string>();
  for (const [path, load] of Object.entries(examText))
    if (path.endsWith(".exam.json") && examIds.has(JSON.parse(await load()).meta.id))
      folders.add(path.slice(0, path.lastIndexOf("/")));
  const wanted = (path: string) =>
    folders.has(path.slice(0, path.lastIndexOf("/"))) || path.includes("/taxonomies/");
  for (const [path, load] of Object.entries(examText))
    if (wanted(path)) zip.file(`course/${name(path)}`, await load());
  for (const [path, url] of Object.entries(examUrls))
    if (wanted(path)) zip.file(`course/${name(path)}`, await (await fetch(await url())).blob());
  return zip.generateAsync({ type: "blob" });
}
