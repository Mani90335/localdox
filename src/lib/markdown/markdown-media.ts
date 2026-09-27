import { defaultUrlTransform } from "react-markdown";
import { getDocumentKind } from "./document-utils.ts";

export type MediaKind = "image" | "video" | "audio";
export interface MediaSource {
  src: string;
  type?: string;
}
export interface MediaSpec {
  kind?: MediaKind;
  poster?: string;
  sources?: MediaSource[];
}
export function mediaKind(src: string, mime = ""): MediaKind | null {
  const kind = getDocumentKind(src.split(/[?#]/)[0], mime);
  return kind === "image" || kind === "video" || kind === "audio" ? kind : null;
}
export function mediaUrlTransform(url: string) {
  return /^data:(image|video|audio)\/[a-z\d.+-]+[;,]/i.test(url) ? url : defaultUrlTransform(url);
}

interface Node {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Only media elements are interpreted. Scripts, event handlers, arbitrary HTML,
 * autoplay and embedded browsing contexts never enter the rendered document. */
export function remarkMedia() {
  return (tree: Node) => {
    const visit = (node: Node) => {
      // Markdown parses inline HTML tags as separate siblings. Join a native
      // player and its <source> children before interpreting its attributes.
      if (node.children) {
        for (let index = 0; index < node.children.length; index++) {
          const first = node.children[index];
          const opening = first.type === "html" && /^\s*<(video|audio)\b/i.exec(first.value ?? "");
          if (!opening) continue;
          const closing = new RegExp(`</${opening[1]}\\s*>`, "i");
          if (closing.test(first.value ?? "")) continue;
          let end = index + 1;
          while (end < node.children.length && ["html", "text"].includes(node.children[end].type)) {
            if (closing.test(node.children[end].value ?? "")) {
              first.value = node.children
                .slice(index, end + 1)
                .map((child) => child.value ?? "")
                .join("");
              node.children.splice(index + 1, end - index);
              break;
            }
            end++;
          }
        }
      }
      if (
        node.type === "html" &&
        typeof DOMParser !== "undefined" &&
        /^\s*<(img|video|audio)\b/i.test(node.value ?? "")
      ) {
        const doc = new DOMParser().parseFromString(node.value ?? "", "text/html");
        const elements = [...doc.body.children];
        if (elements.length === 1 && /^(IMG|VIDEO|AUDIO)$/.test(elements[0].tagName)) {
          const element = elements[0];
          const sources = [...element.querySelectorAll(":scope > source")]
            .map((source) => ({
              src: source.getAttribute("src") ?? "",
              type: source.getAttribute("type") ?? undefined,
            }))
            .filter((source) => source.src);
          const src = element.getAttribute("src") || sources[0]?.src;
          if (src) {
            const spec: MediaSpec = {
              kind:
                element.tagName === "IMG" ? "image" : (element.tagName.toLowerCase() as MediaKind),
              poster: element.getAttribute("poster") ?? undefined,
              sources: sources.length ? sources : undefined,
            };
            node.type = "image";
            node.url = src;
            node.alt = element.getAttribute("alt") || element.getAttribute("title") || spec.kind;
            node.value = undefined;
            node.data = { hProperties: { "data-media": JSON.stringify(spec) } };
          }
        }
      }
      node.children?.forEach(visit);
      // Media players and attachment previews are block content, including when
      // placed alongside text. Use a div to avoid invalid nested <p> markup.
      if (
        node.type === "paragraph" &&
        node.children?.some((child) => child.type === "image" || child.type === "imageReference")
      ) {
        node.data = {
          ...node.data,
          hName: "div",
          hProperties: { className: "markdown-media-paragraph" },
        };
      }
    };
    visit(tree);
  };
}
export function parseMediaSpec(value: unknown): MediaSpec {
  try {
    return typeof value === "string" ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
