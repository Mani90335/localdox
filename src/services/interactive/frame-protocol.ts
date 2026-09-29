// Messages between an interactive block and its sandboxed preview frame.

/** Frame → reader: `booted`, `ready`, `height` and `error` events. */
export const FRAME_MESSAGE = "docucraft:interactive";

/** Reader → frame: mount this compiled component. */
export const RUN_MESSAGE = "docucraft:interactive-run";

export type RunMessage = {
  type: typeof RUN_MESSAGE;
  id: string;
  code: string;
  theme: "light" | "dark";
};
