import { useState } from "react";

/** Conversion stays local; imported external images require a separate gesture. */
export function ConvertedRemoteImage({ src, alt }: { src: string; alt?: string }) {
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  if (loadedSource === src)
    return <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />;
  return (
    <span className="inline-flex items-center gap-2 rounded border border-border px-2 py-1 text-xs text-muted-foreground">
      {alt || "External image"}
      <button type="button" className="underline" onClick={() => setLoadedSource(src)}>
        Load external image
      </button>
    </span>
  );
}
