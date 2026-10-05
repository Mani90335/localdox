/**
 * One import for everything: a `.zip`, or loose files, holding any mix of
 * a study plan, exams (ruleset + paper + solutions + taxonomy), practice
 * files and images. Files are routed by name; folders inside a zip are
 * ignored, so names must be unique.
 */
import { importFiles } from "./library.ts";
import { importPracticeSet, practiceIdFromFile, type PracticeSet } from "./practice.ts";
import type { ExamRecord } from "./storage.ts";
import { humanizeId } from "./ui/display.ts";

export interface Bundle {
  exams: ExamRecord[];
  practice: PracticeSet[];
  /** Raw `*.plan.json` text, if one was included. */
  plan?: string;
}
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const MAX_ZIP_ENTRIES = 2000,
  MAX_ZIP_BYTES = 200 * 1024 * 1024;
const basename = (path: string) => path.replace(/^.*[\\/]/, "");
const mime = (name: string) =>
  name.toLowerCase().endsWith(".svg")
    ? "image/svg+xml"
    : name.toLowerCase().endsWith(".json")
      ? "application/json"
      : /\.(md|markdown)$/i.test(name)
        ? "text/markdown"
        : IMAGE.test(name)
          ? `image/${name.split(".").pop()!.toLowerCase().replace("jpg", "jpeg")}`
          : "application/octet-stream";

/** Unpack zips (lazily loading the zip library) and drop OS clutter. */
export async function expandFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      out.push(file);
      continue;
    }
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(file),
      entries = Object.values(zip.files).filter(
        (e) => !e.dir && !e.name.startsWith("__MACOSX/") && !basename(e.name).startsWith("."),
      );
    if (entries.length > MAX_ZIP_ENTRIES)
      throw new Error(`${file.name} has more than ${MAX_ZIP_ENTRIES} files.`);
    let bytes = 0;
    for (const entry of entries) {
      const data = await entry.async("arraybuffer");
      bytes += data.byteLength;
      if (bytes > MAX_ZIP_BYTES) throw new Error(`${file.name} is larger than 200 MB unpacked.`);
      const name = basename(entry.name);
      out.push(new File([data], name, { type: mime(name) }));
    }
  }
  const names = new Set<string>();
  for (const f of out) {
    if (names.has(f.name))
      throw new Error(`Two files are named ${f.name}. Every file name must be unique.`);
    names.add(f.name);
  }
  return out;
}

/** Images a text refers to by file name, e.g. `![graph](graph.png)`. */
function referencedImages(text: string, images: File[]) {
  return images.filter((img) => text.includes(img.name));
}
const toAssets = (files: File[]) =>
  files.length ? Object.fromEntries(files.map((f) => [f.name, f as Blob])) : undefined;

export async function readBundle(input: File[], now = Date.now()): Promise<Bundle> {
  const files = await expandFiles(input),
    images = files.filter((f) => IMAGE.test(f.name)),
    plans = files.filter((f) => f.name.endsWith(".plan.json")),
    practiceFiles = files.filter((f) => f.name.endsWith(".practice.md")),
    papers = files.filter((f) => f.name.endsWith(".paper.md"));
  if (plans.length > 1) throw new Error("Import one plan at a time.");
  const known = /\.(exam\.json|paper\.md|solutions\.md|taxonomy\.json|plan\.json|practice\.md)$/;
  const stray = files.filter((f) => !known.test(f.name) && !IMAGE.test(f.name));
  if (stray.length)
    throw new Error(
      `Not sure what to do with ${stray.map((f) => f.name).join(", ")}. ` +
        "Expected .plan.json, .exam.json, .paper.md, .solutions.md, .taxonomy.json, .practice.md or images.",
    );
  // Read paper and practice text once to see which images they use.
  const texts = new Map<File, string>();
  for (const f of [...papers, ...practiceFiles]) texts.set(f, await f.text());
  const claimed = new Set(
    [...texts.values()].flatMap((t) => referencedImages(t, images)).map((f) => f.name),
  );
  // Solutions stay sealed, so images they use cannot be detected; any image no
  // paper or practice file mentions travels with every exam in this import.
  const unclaimed = images.filter((f) => !claimed.has(f.name));
  const exams = files.some((f) => f.name.endsWith(".exam.json"))
    ? await importFiles(files, { images, shared: unclaimed })
    : [];
  const practice = practiceFiles.map((f) => {
    const id = practiceIdFromFile(f.name);
    return importPracticeSet(
      id,
      humanizeId(id),
      texts.get(f)!,
      now,
      toAssets(referencedImages(texts.get(f)!, images)),
    );
  });
  return { exams, practice, plan: plans[0] ? await plans[0].text() : undefined };
}
