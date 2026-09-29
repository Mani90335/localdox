import { useEffect, useState } from "react";
import { dataBlob, type FileData } from "@/lib/workspace/binary";

/** The mounted consumer owns the URL, never the workspace or persisted state. */
export function useBinaryUrl(data?: FileData) {
  const [state, setState] = useState<{ data: FileData; url: string }>();
  useEffect(() => {
    if (data === undefined) return;
    let blob: Blob | null;
    try {
      blob = dataBlob(data);
    } catch {
      return;
    } // Retained unreadable legacy bytes show the viewer's error state.
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setState({ data, url });
    return () => URL.revokeObjectURL(url);
  }, [data]);
  return state?.data === data ? state?.url : undefined;
}
