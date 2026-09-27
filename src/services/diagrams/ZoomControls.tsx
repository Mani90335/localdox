import { Minus, Plus } from "lucide-react";
import { Tray, TrayButton } from "./Tray";

/**
 * − / level / + for any stage driven by an `SvgViewport`.
 *
 * The middle button resets. While the explainer camera is in charge it reads
 * "Auto" rather than a percentage, because the level is the camera's and is
 * changing under it. Once the reader zooms by hand it shows their level, and
 * pressing it hands the view back.
 */
export function ZoomControls({
  zoom,
  manual,
  auto,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  manual: boolean;
  /** The camera is framing the view, so "reset" means "follow it again". */
  auto?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const following = auto && !manual;
  return (
    <Tray>
      <TrayButton onClick={onZoomOut} label="Zoom out">
        <Minus className="h-3.5 w-3.5" />
      </TrayButton>
      <TrayButton
        onClick={onReset}
        label={auto ? "Follow the explanation" : "Fit diagram"}
        title={
          following
            ? "The camera is following the explanation. Drag, scroll or pinch to look around yourself."
            : auto
              ? "Hand the view back to the camera (0)"
              : "Fit diagram (0)"
        }
      >
        <span className="text-3xs font-semibold tabular-nums">
          {following ? "Auto" : `${Math.round(zoom * 100)}%`}
        </span>
      </TrayButton>
      <TrayButton onClick={onZoomIn} label="Zoom in">
        <Plus className="h-3.5 w-3.5" />
      </TrayButton>
    </Tray>
  );
}
