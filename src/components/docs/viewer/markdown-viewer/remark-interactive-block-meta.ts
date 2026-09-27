// react-markdown exposes the code language to component overrides but not the
// fenced-code info string. Keep the interactive flags in the language token so
// `interactive-react preview`, `split`, and `playground` all survive parsing.
export function remarkInteractiveBlockMeta() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (node?.type === "code" && /^(interactive-html|interactive-react)$/.test(node.lang ?? "")) {
        const flags = String(node.meta ?? "")
          .toLowerCase()
          .split(/\s+/)
          .map((flag) => flag.replace(/[^a-z0-9]/g, ""))
          .filter(Boolean)
          .join("-");
        if (flags) node.lang = `${node.lang}--${flags}`;
      }
      node?.children?.forEach(walk);
    };
    walk(tree);
  };
}
