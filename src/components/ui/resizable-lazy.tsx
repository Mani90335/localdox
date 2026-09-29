import type { ComponentProps } from "react";
import { deferredModule } from "@/lib/app/deferred-module";
import type * as Resizable from "./resizable";

/**
 * `./resizable`, downloaded the first time panes are split.
 *
 * react-resizable-panels is only needed once there are two panes to divide, so
 * it stays out of the startup download. The group renders nothing until it
 * arrives; its panels and handles only render inside it, by which time the
 * module is there.
 */
const resizable = deferredModule(() => import("./resizable"));

export function ResizablePanelGroup(props: ComponentProps<typeof Resizable.ResizablePanelGroup>) {
  const mod = resizable.useModule();
  return mod ? <mod.ResizablePanelGroup {...props} /> : null;
}

export function ResizablePanel(props: ComponentProps<typeof Resizable.ResizablePanel>) {
  const mod = resizable.useModule();
  return mod ? <mod.ResizablePanel {...props} /> : null;
}

export function ResizableHandle(props: ComponentProps<typeof Resizable.ResizableHandle>) {
  const mod = resizable.useModule();
  return mod ? <mod.ResizableHandle {...props} /> : null;
}
