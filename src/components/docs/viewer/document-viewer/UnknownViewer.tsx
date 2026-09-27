import { ErrorState, ViewerFrame } from "./shared";
import type { Props } from "./shared";

export function UnknownViewer({
  file,
  isBookmarked,
  onToggleBookmark,
  prevFile,
  nextFile,
  onNavFile,
  onOpenPalette,
}: Props) {
  return (
    <ViewerFrame
      file={file}
      isBookmarked={isBookmarked}
      onToggleBookmark={onToggleBookmark}
      prevFile={prevFile}
      nextFile={nextFile}
      onNavFile={onNavFile}
      onOpenPalette={onOpenPalette}
    >
      <ErrorState message="This file was uploaded successfully, but this browser does not have a previewer for its format yet." />
    </ViewerFrame>
  );
}
