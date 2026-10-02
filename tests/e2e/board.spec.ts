import { test, expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

// Boards end to end: a new board opens in the native editor, drawing and
// sticky notes save to the workspace and survive a reload, undo/redo, an
// older `.excalidraw` file opens and is written back in its own format, a
// document can embed a board, nothing is fetched from a third party, and the
// chrome works by keyboard and at phone width.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    );
  });
});

async function storedContent(page: Page, name: string) {
  return page.evaluate(
    (name) =>
      new Promise<string | undefined>((resolve, reject) => {
        const request = indexedDB.open("localdox");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("files", "readonly");
          const files = transaction.objectStore("files").getAll();
          transaction.oncomplete = () => {
            db.close();
            resolve(files.result.find((file) => file.name === name)?.content);
          };
        };
      }),
    name,
  );
}

async function storedScene(page: Page, name: string) {
  const content = await storedContent(page, name);
  return content ? JSON.parse(content) : null;
}

async function newBoard(page: Page, name = "Plan") {
  await page.goto("/");
  // Creating a board never blocks the page with a native prompt.
  page.on("dialog", (dialog) => {
    throw new Error(`Unexpected ${dialog.type()} dialog: ${dialog.message()}`);
  });
  await page.getByRole("button", { name: "New board", exact: true }).first().click();
  await expect(page.getByRole("toolbar", { name: "Board tools" })).toBeVisible();
  // Named in place, from the board's own title.
  const title = page.getByRole("textbox", { name: "Board name" });
  await expect(title).toHaveValue("Untitled board");
  await title.click();
  await title.fill(name);
  await title.press("Enter");
  await expect
    .poll(async () => (await storedContent(page, `${name}.board`)) !== undefined)
    .toBe(true);
  await page.locator(".board-stage").focus();
}

async function canvasBox(page: Page) {
  const box = await page.locator(".board-canvas--overlay").boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function drag(page: Page, from: [number, number], to: [number, number], steps = 8) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
  await page.mouse.up();
}

const mod = process.platform === "darwin" ? "Meta" : "Control";

test("a new board draws, saves, undoes and survives a reload", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && url.protocol.startsWith("http")) {
      external.push(request.url());
    }
  });

  await newBoard(page);
  await expect(page.getByText("A blank board")).toBeVisible();
  // Native chrome only: nothing from the old embedded editor is on the page.
  expect(await page.locator('[class*="excalidraw"]').count()).toBe(0);

  const box = await canvasBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: "Rectangle", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await drag(page, [cx - 220, cy - 60], [cx - 60, cy + 40]);
  await expect(page.getByText("A blank board")).toHaveCount(0);
  // The new shape is selected, and its toolbar floats above it.
  const bar = page.getByRole("toolbar", { name: "Selection" });
  await expect(bar).toBeVisible();
  const barBox = (await bar.boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThan(cy - 60);
  // Its colour panel restyles the shape.
  await bar.getByRole("button", { name: "Color" }).click();
  await page.getByRole("dialog", { name: "Color" }).getByRole("button", { name: "Blue" }).click();
  await page.keyboard.press("Escape");

  // Clicking inside an empty shape selects it, not just its outline.
  await page.mouse.click(cx + 300, cy + 200);
  await expect(bar).toHaveCount(0);
  await page.mouse.click(cx - 140, cy - 10);
  await expect(bar).toBeVisible();
  await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // A sticky note opens straight into typing.
  await page.keyboard.press("s");
  await page.mouse.click(cx + 160, cy);
  const editor = page.getByRole("textbox", { name: "Text" });
  await expect(editor).toBeFocused();
  await page.keyboard.type("Ship it");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);

  // An arrow from the rectangle to the note attaches to both.
  await page.keyboard.press("a");
  await drag(page, [cx - 140, cy - 10], [cx + 160, cy + 20]);

  await expect
    .poll(async () => (await storedScene(page, "Plan.board"))?.elements?.length ?? 0)
    .toBe(4);
  const scene = await storedScene(page, "Plan.board");
  expect(scene.type).toBe("localdox-board");
  const types = scene.elements.map((el: { type: string }) => el.type).sort();
  expect(types).toEqual(["arrow", "rectangle", "rectangle", "text"]);
  const text = scene.elements.find((el: { type: string }) => el.type === "text");
  const outline = scene.elements.find(
    (el: { type: string; strokeColor: string }) =>
      el.type === "rectangle" && el.strokeColor !== "transparent",
  );
  expect(outline.strokeColor).toBe("#1e7ae0");
  expect(text.text).toBe("Ship it");
  // Board text is set in the app's reading face, Atkinson Hyperlegible.
  expect(text.fontFamily).toBe(100);
  const arrow = scene.elements.find((el: { type: string }) => el.type === "arrow");
  expect(arrow.startBinding?.elementId).toBeTruthy();
  expect(arrow.endBinding?.elementId).toBe(text.containerId);

  // Undo removes the arrow; redo brings it back.
  await page.locator(".board-stage").focus();
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(async () => (await storedScene(page, "Plan.board"))?.elements?.length).toBe(3);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect.poll(async () => (await storedScene(page, "Plan.board"))?.elements?.length).toBe(4);

  await page.reload();
  await expect(page.getByRole("toolbar", { name: "Board tools" })).toBeVisible();
  await expect(page.getByText("A blank board")).toHaveCount(0);
  expect((await storedScene(page, "Plan.board")).elements).toHaveLength(4);

  expect(external).toEqual([]);
});

test("pen strokes keep their points, and the eraser removes them", async ({ page }) => {
  await newBoard(page, "Ink");
  const box = await canvasBox(page);
  const x = box.x + box.width / 2 - 100;
  const y = box.y + box.height / 2;
  await page.keyboard.press("p");
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(x + i * 5, y + Math.sin(i / 4) * 30);
  await page.mouse.up();
  await expect
    .poll(async () => (await storedScene(page, "Ink.board"))?.elements?.[0]?.points?.length ?? 0)
    .toBeGreaterThan(20);
  // The pen stays the pen after a stroke.
  await expect(page.getByRole("button", { name: "Pen", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("e");
  await drag(page, [x + 100, y - 60], [x + 100, y + 60], 12);
  await expect.poll(async () => (await storedScene(page, "Ink.board"))?.elements?.length).toBe(0);
});

test("an .excalidraw file opens natively and is written back in its own format", async ({
  page,
}) => {
  const scene = {
    type: "excalidraw",
    version: 2,
    source: "https://example.app",
    elements: [
      {
        id: "r1",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 160,
        height: 80,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        roughness: 1,
        boundElements: [
          { id: "a1", type: "arrow" },
          { id: "t1", type: "text" },
        ],
      },
      {
        id: "r2",
        type: "ellipse",
        x: 500,
        y: 100,
        width: 160,
        height: 80,
        boundElements: [{ id: "a1", type: "arrow" }],
      },
      {
        id: "a1",
        type: "arrow",
        x: 265,
        y: 140,
        width: 230,
        height: 0,
        points: [
          [0, 0],
          [230, 0],
        ],
        startBinding: { elementId: "r1", focus: 0, gap: 5 },
        endBinding: { elementId: "r2", focus: 0, gap: 5 },
        endArrowhead: "arrow",
      },
      {
        id: "t1",
        type: "text",
        x: 150,
        y: 128,
        width: 60,
        height: 25,
        text: "Start",
        fontSize: 20,
        fontFamily: 1,
        containerId: "r1",
        textAlign: "center",
        verticalAlign: "middle",
      },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "Flow.excalidraw",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(scene)),
    });
  await expect(page.getByRole("toolbar", { name: "Board tools" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  const stage = page.locator(".board-stage");
  await stage.focus();
  await page.keyboard.press(`${mod}+a`);
  await expect(page.getByRole("toolbar", { name: "Selection" })).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");

  await expect
    .poll(async () => (await storedScene(page, "Flow.excalidraw"))?.elements?.[0]?.x)
    .toBe(130);
  const saved = await storedScene(page, "Flow.excalidraw");
  expect(saved.type).toBe("excalidraw");
  expect(saved.source).toBe("https://example.app");
  const arrow = saved.elements.find((el: { id: string }) => el.id === "a1");
  expect(arrow.startBinding.elementId).toBe("r1");
  expect(arrow.endBinding.elementId).toBe("r2");
  expect(saved.elements.find((el: { id: string }) => el.id === "t1").text).toBe("Start");
});

test("a document embeds a board as a live, read-only figure", async ({ page }) => {
  await page.goto("/");
  const board = {
    type: "localdox-board",
    version: 1,
    elements: [
      {
        id: "r",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        backgroundColor: "#fff0b3",
      },
    ],
    files: {},
  };
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      {
        name: "Sketch.board",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(board)),
      },
      {
        name: "notes.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Notes\n\nSee the sketch.\n\n![[Sketch.board]]\n"),
      },
    ]);
  await page.getByRole("button", { name: /notes/ }).first().click();
  const figure = page.getByRole("img", { name: "Sketch.board" });
  await expect(figure).toBeVisible();
  await expect(figure.locator("canvas")).toBeVisible();
  // A figure, not an editor: no tools in the document.
  await expect(page.getByRole("toolbar", { name: "Board tools" })).toHaveCount(0);
  // The canvas actually painted the note.
  const painted = await figure.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
  });
  expect(painted).toBeGreaterThan(1000);
});

test("tools are reachable by keyboard and announced as pressed", async ({ page }) => {
  await newBoard(page, "Keys");
  const select = page.getByRole("button", { name: "Select", exact: true });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Pan", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Pan", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator(".board-stage").focus();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Board shortcuts" })).toBeVisible();
});

test("the tool rail sits at the left, reachable, and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await newBoard(page, "Phone");
  const rail = (await page.getByRole("toolbar", { name: "Board tools" }).boundingBox())!;
  expect(rail.x).toBeGreaterThanOrEqual(0);
  expect(rail.x).toBeLessThan(24);
  // Off the bottom edge: the rail starts in the top part of the screen and
  // ends well clear of the browser's and OS's bottom bars.
  expect(rail.y).toBeLessThan(740 / 4);
  expect(rail.y + rail.height).toBeLessThan(740 - 32);
  await expect(page.getByRole("toolbar", { name: "Board tools" })).toHaveAttribute(
    "aria-orientation",
    "vertical",
  );

  // The pen's options open as a slim column beside the rail, at its top,
  // leaving the drawing area clear.
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  const options = (await page.getByRole("toolbar", { name: "Tool options" }).boundingBox())!;
  expect(options.x).toBeGreaterThan(rail.x + rail.width);
  expect(options.width).toBeLessThan(80);
  // (A few pixels of slack: the column's 140 ms pop-in scales it slightly.)
  expect(Math.abs(options.y - rail.y)).toBeLessThan(8);
  expect(options.y + options.height).toBeLessThan(740 - 32);
});

test("on a short screen, secondary tools fold into More tools", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await newBoard(page, "Short");
  await expect(page.getByRole("button", { name: "Ellipse", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "More tools" }).click();
  await page.getByRole("menuitem", { name: /Ellipse/ }).click();
  await expect(page.getByRole("button", { name: "Ellipse", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const rail = (await page.getByRole("toolbar", { name: "Board tools" }).boundingBox())!;
  expect(rail.y + rail.height).toBeLessThanOrEqual(600);
});

test("text uses Atkinson Hyperlegible from the app's own font files", async ({ page }) => {
  const fontFiles: string[] = [];
  page.on("request", (request) => {
    if (/\.woff2?($|\?)/.test(request.url())) fontFiles.push(new URL(request.url()).pathname);
  });
  await newBoard(page, "Type");
  await page.keyboard.press("t");
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type("Legible");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('20px "Atkinson Hyperlegible"')))
    .toBe(true);
  // The text box used while typing is set in the same face as the canvas.
  await page.keyboard.press("Enter");
  const family = await page
    .getByRole("textbox", { name: "Text" })
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain("Atkinson Hyperlegible");
  await page.keyboard.press("Escape");
  const atkinson = fontFiles.filter((f) => /atkinson/i.test(f));
  // The board reuses the app's own font files: the regular face arrives, and
  // nothing is downloaded twice.
  expect(atkinson.some((f) => /-400-normal/.test(f))).toBe(true);
  expect(new Set(atkinson).size).toBe(atkinson.length);
});

/** A small gradient PNG, so the photo has real pixels to draw over. */
function photo(width: number, height: number) {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = (x * 255) / width;
      row[2 + x * 3] = (y * 255) / height;
      row[3 + x * 3] = 160;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("a photo can be labelled: ink, arrows and text on it, which travel with it", async ({
  page,
}) => {
  await newBoard(page, "Labels");
  await page
    .locator('input[type="file"][accept="image/*"]')
    .setInputFiles({ name: "leaf.png", mimeType: "image/png", buffer: photo(800, 500) });
  await expect
    .poll(async () => (await storedScene(page, "Labels.board"))?.elements?.length)
    .toBe(1);
  const box = await canvasBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const elements = async () =>
    (await storedScene(page, "Labels.board")).elements as {
      id: string;
      type: string;
      x: number;
      y: number;
      text?: string;
      startBinding?: unknown;
      endBinding?: unknown;
    }[];
  const of = async (type: string) => (await elements()).filter((el) => el.type === type);

  // Ink on the photo.
  await page.keyboard.press("p");
  await drag(page, [cx - 120, cy - 60], [cx - 40, cy - 20], 12);
  await expect.poll(async () => (await of("freedraw")).length).toBe(1);

  // An arrow drawn on the photo points at the spot it was drawn to: it does
  // not snap to the photo's edge.
  await page.keyboard.press("a");
  await drag(page, [cx + 120, cy - 100], [cx + 40, cy - 30]);
  await expect.poll(async () => (await of("arrow")).length).toBe(1);
  const [arrow] = await of("arrow");
  expect(arrow.startBinding ?? null).toBeNull();
  expect(arrow.endBinding ?? null).toBeNull();

  // Double-click on the photo writes a label right there.
  await page.keyboard.press("v");
  await page.mouse.dblclick(cx + 20, cy + 60);
  await expect(page.getByRole("textbox", { name: "Text" })).toBeFocused();
  await page.keyboard.type("Stem");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await of("text"))[0]?.text).toBe("Stem");

  // The eraser rubs out the ink and leaves the photo.
  await page.keyboard.press("e");
  await drag(page, [cx - 80, cy - 90], [cx - 80, cy + 10], 12);
  await expect.poll(async () => (await of("freedraw")).length).toBe(0);
  expect(await of("image")).toHaveLength(1);

  // Moving the photo carries its labels.
  await page.keyboard.press("v");
  const [before] = await of("image");
  const [label] = await of("text");
  await drag(page, [cx - 200, cy + 120], [cx - 140, cy + 160]);
  await expect.poll(async () => (await of("image"))[0].x).toBeCloseTo(before.x + 60, 0);
  expect((await of("text"))[0].x).toBeCloseTo(label.x + 60, 0);
  expect((await of("arrow"))[0].x).toBeCloseTo(arrow.x + 60, 0);

  // Locked, the photo stays put: dragging across it selects the labels.
  await page.keyboard.press(`${mod}+Shift+l`);
  await expect
    .poll(async () => (await storedScene(page, "Labels.board")).elements[0].locked)
    .toBe(true);
  const [still] = await of("image");
  await drag(page, [cx - 300, cy - 200], [cx + 300, cy + 240]);
  await expect(page.getByRole("toolbar", { name: "Selection" })).toBeVisible();
  expect((await of("image"))[0].x).toBe(still.x);

  // And a right-click is how it's unlocked.
  await page.mouse.click(box.x + box.width - 60, box.y + box.height - 60);
  await page.mouse.click(cx - 200, cy + 150, { button: "right" });
  await page.getByRole("menuitem", { name: /Unlock/ }).click();
  await expect
    .poll(async () => (await storedScene(page, "Labels.board")).elements[0].locked)
    .toBe(false);
});

test("custom colours: hex input, the colour wheel, and one undo step per drag", async ({
  page,
}) => {
  await newBoard(page, "Colors");
  const box = await canvasBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const stroke = async () =>
    (await storedScene(page, "Colors.board"))?.elements?.[0]?.strokeColor as string | undefined;

  await page.keyboard.press("r");
  await drag(page, [cx - 100, cy - 60], [cx + 100, cy + 60]);
  const bar = page.getByRole("toolbar", { name: "Selection" });
  await bar.getByRole("button", { name: "Color" }).click();
  const panel = page.getByRole("dialog", { name: "Color" });
  await panel.getByRole("button", { name: "Custom color" }).click();

  // Hex: typed with or without "#", applied on Enter.
  const hex = panel.getByRole("textbox", { name: "Hex color" });
  await hex.fill("12ab34");
  await hex.press("Enter");
  await expect.poll(stroke).toBe("#12ab34");
  await expect(panel.getByRole("button", { name: "Custom color" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Wheel: a drag previews live and lands as a single undo step.
  const wheel = panel.getByRole("slider", { name: "Color wheel" });
  const w = (await wheel.boundingBox())!;
  await page.mouse.move(w.x + w.width / 2, w.y + w.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(w.x + w.width / 2 + i * 7, w.y + w.height / 2 - i * 2);
  }
  await page.mouse.up();
  await expect.poll(stroke).not.toBe("#12ab34");
  const picked = await stroke();
  expect(picked).toMatch(/^#[0-9a-f]{6}$/);
  await expect(hex).toHaveValue(picked!.slice(1));
  // Keyboard on the wheel turns the hue.
  await wheel.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(stroke).not.toBe(picked);
  await page.keyboard.press("Escape");
  await page.locator(".board-stage").focus();
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(stroke).toBe(picked);
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(stroke).toBe("#12ab34");

  // The tool column offers the same picker, beside it; it sets the pen's ink.
  await page.keyboard.press("p");
  const options = page.getByRole("toolbar", { name: "Tool options" });
  await options.getByRole("button", { name: "Custom color" }).click();
  const penHex = options.getByRole("textbox", { name: "Hex color" });
  await penHex.fill("#e11d48");
  await penHex.press("Enter");
  await page.locator(".board-stage").focus();
  await drag(page, [cx - 200, cy + 150], [cx - 120, cy + 170], 10);
  await expect
    .poll(
      async () =>
        (await storedScene(page, "Colors.board"))?.elements?.find(
          (el: { type: string }) => el.type === "freedraw",
        )?.strokeColor,
    )
    .toBe("#e11d48");
});
