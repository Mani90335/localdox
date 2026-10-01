import {
  memo,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import ReactMarkdown, { type Components, type Options, type UrlTransform } from "react-markdown";
import rehypeSlug from "rehype-slug";
import {
  rehypeSegmentSlug,
  splitMarkdownSegments,
  type MarkdownSegments,
} from "@/lib/markdown/markdown-segments";
import {
  rehypeSourceAddress,
  renderSourceMap,
  type RenderSourceMap,
} from "@/lib/markdown/source-address";

/**
 * Where the rendered source sits in the file, so rendered blocks can carry
 * their file spans (see source-address.ts). `rendered` must be the exact
 * string rendered, and `base` the offset in `file` its first line came from.
 */
export interface SourceAddressing {
  file: string;
  rendered: string;
  base: number;
}

type PluggableList = NonNullable<Options["rehypePlugins"]>;

/** Source characters rendered with the first paint: comfortably a screenful. */
const FIRST_SCREEN = 8_000;
/** Each later step aims to render and commit within this many milliseconds… */
const STEP_MS = 16;
/** …measured from the steps before it, within these bounds (source characters). */
const STEP_MIN = 2_000;
const STEP_MAX = 48_000;

interface Props {
  source: string;
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
  components: Components;
  urlTransform: UrlTransform;
  /**
   * Called with the source once all of it is in the DOM, and with `null` when
   * this unmounts. Anything that reads the rendered document as a whole
   * (highlight anchoring, scrolling to a heading or a search hit) waits for it.
   */
  onRendered?: (source: string | null) => void;
  /** Stamp rendered blocks with their file spans. */
  addressing?: SourceAddressing;
}

/**
 * react-markdown, a bounded amount at a time.
 *
 * A long document is split into segments (see `markdown-segments.ts`). The
 * first screenful renders with the first paint; the rest is mounted in later
 * tasks, each sized from how long the previous one took, so no single task
 * parses and commits the whole document. Every segment stays mounted once it
 * is, so the finished DOM is the same as a single render's: browser find,
 * selection, copying, printing and text offsets all see the whole document.
 *
 * Short documents render in one piece, exactly as before.
 *
 * Changes to the source or to the plugins are rendered as a transition: React
 * renders segments between yields, and the old content stays on screen until
 * the new one is ready.
 */
export function ProgressiveMarkdown({
  source,
  remarkPlugins,
  rehypePlugins,
  components,
  urlTransform,
  onRendered,
  addressing,
}: Props) {
  const renderedSource = useDeferredValue(source);
  const deferredRehype = useDeferredValue(rehypePlugins);
  // Only when it describes the source actually being rendered: the source is
  // deferred, and a map for the next one would stamp the previous one wrongly.
  const deferredAddressing = useDeferredValue(addressing);
  const sourceMap = useMemo(
    () =>
      deferredAddressing && deferredAddressing.rendered === renderedSource
        ? renderSourceMap(deferredAddressing.file, renderedSource, deferredAddressing.base)
        : null,
    [deferredAddressing, renderedSource],
  );
  const wholeRehype = useMemo<PluggableList>(
    () =>
      sourceMap
        ? [...deferredRehype, [rehypeSourceAddress, { toFile: sourceMap.toFile }]]
        : deferredRehype,
    [deferredRehype, sourceMap],
  );
  const segments = useMemo(() => splitMarkdownSegments(renderedSource), [renderedSource]);
  const count = segments.sources.length;

  const [mounted, setMounted] = useState(() => extend(segments.sizes, 0, FIRST_SCREEN));
  const shown = Math.min(mounted, count);
  const complete = shown >= count;

  // Characters per step, adapted to the device and the document's content.
  const budget = useRef(FIRST_SCREEN);
  useEffect(() => {
    if (complete) return;
    const timer = setTimeout(() => {
      const next = extend(segments.sizes, shown, budget.current);
      const started = performance.now();
      // Rendered synchronously inside this task so the time it takes is known.
      flushSync(() => setMounted(next));
      const elapsed = performance.now() - started;
      let added = 0;
      for (let i = shown; i < next; i++) added += segments.sizes[i];
      if (elapsed > 0) {
        const fits = (added / elapsed) * STEP_MS;
        budget.current = Math.min(STEP_MAX, Math.max(STEP_MIN, (budget.current + fits) / 2));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [complete, shown, segments]);

  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  useLayoutEffect(() => {
    if (complete) onRenderedRef.current?.(renderedSource);
  }, [complete, renderedSource]);
  useLayoutEffect(() => () => onRenderedRef.current?.(null), []);

  if (count === 1) {
    return (
      <WholeDocument
        urlTransform={urlTransform}
        remarkPlugins={remarkPlugins}
        rehypePlugins={wholeRehype}
        components={components}
      >
        {renderedSource}
      </WholeDocument>
    );
  }
  return segments.sources
    .slice(0, shown)
    .map((_, index) => (
      <Segment
        key={index}
        segments={segments}
        index={index}
        remarkPlugins={remarkPlugins}
        rehypePlugins={deferredRehype}
        sourceMap={sourceMap}
        components={components}
        urlTransform={urlTransform}
      />
    ));
}

/** Segments from `from` on whose sizes add up to `budget` (at least one). */
function extend(sizes: number[], from: number, budget: number): number {
  let end = from;
  let total = 0;
  do total += sizes[end++] ?? 0;
  while (end < sizes.length && total + sizes[end] <= budget);
  return end;
}

/** Parsing is skipped whenever these props are unchanged. */
const WholeDocument = memo(ReactMarkdown);

const Segment = memo(function Segment({
  segments,
  index,
  rehypePlugins,
  sourceMap,
  ...rest
}: {
  segments: MarkdownSegments;
  index: number;
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
  sourceMap: RenderSourceMap | null;
  components: Components;
  urlTransform: UrlTransform;
}) {
  // rehype-slug de-duplicates ids within one tree; the segment slugger does it
  // across the document.
  const plugins = useMemo<PluggableList>(() => {
    const list: PluggableList = [
      [rehypeSegmentSlug, { segments, index }],
      ...rehypePlugins.filter((plugin) => plugin !== rehypeSlug),
    ];
    if (sourceMap) {
      // Offsets in this segment's source, past the definitions copied to its
      // front, are offsets from where the segment starts in the document.
      const start = segments.starts[index];
      const toFile = (offset: number) =>
        sourceMap.toFile(start + Math.max(0, offset - segments.prefix));
      list.push([rehypeSourceAddress, { toFile }]);
    }
    return list;
  }, [segments, index, rehypePlugins, sourceMap]);
  return (
    <>
      <ReactMarkdown rehypePlugins={plugins} {...rest}>
        {segments.sources[index]}
      </ReactMarkdown>
      {/* A single render puts a newline text node between blocks; this is the
          one the cut removed. Text offsets (highlights, saved passages) count
          it, so they match either way. */}
      {index < segments.sources.length - 1 ? "\n" : null}
    </>
  );
});
