import { googleUrl } from "@/lib/markdown/document-utils";
import { ErrorState, ViewerFrame } from "./shared";
import type { GoogleProps } from "./shared";

export function GoogleViewer({
  file,
  isSlides,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: GoogleProps) {
  const url = googleUrl(file.content);
  const preview = url?.replace(/\/edit(?:\?.*)?$/, "/preview");
  return (
    <ViewerFrame
      file={file}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      {preview ? (
        <iframe
          title={`Google ${isSlides ? "Slides" : "Doc"} ${file.name}`}
          src={preview}
          className="h-[calc(100dvh-7.5rem)] w-full bg-white"
          allowFullScreen
        />
      ) : (
        <ErrorState
          message={`Add a shared Google ${isSlides ? "Slides" : "Docs"} link to this .${isSlides ? "gslides" : "gdoc"} file to preview it here.`}
        />
      )}
    </ViewerFrame>
  );
}
