// Runs inside the sandboxed frame of an ```interactive-react block.
//
// This file is not part of the app bundle. `build/vite-interactive-runtime.ts`
// bundles it with React into one classic script, which the frame receives
// inline through `srcdoc` (see ./frame-document.ts). The frame has an opaque
// origin (sandbox without allow-same-origin), so it can't load the app's
// module chunks: those need CORS, and the app shell's own startup (service
// worker, storage) throws there. A single inline script needs neither.
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { FRAME_MESSAGE, RUN_MESSAGE, type RunMessage } from "./frame-protocol";

const post = (payload: Record<string, unknown>) => {
  window.parent.postMessage({ type: FRAME_MESSAGE, ...payload }, "*");
};

const mount = document.getElementById("root") as HTMLElement;
let root: Root | null = null;

// The body's own height: the root's scrollHeight is never less than the frame,
// so reporting it would only ever let the frame grow.
const reportHeight = () => {
  post({ event: "height", height: Math.ceil(document.body.getBoundingClientRect().height) });
};
new ResizeObserver(reportHeight).observe(document.body);

window.addEventListener("error", (event) => {
  post({
    event: "error",
    message: event.message || "The interactive component stopped unexpectedly.",
    stack: event.error?.stack,
  });
});

// Keep the execution primitive private, then remove dangerous globals before
// authored code runs. The sandbox flags and the document's CSP are the real
// boundary: no same-origin, navigation, popups, network or parent access.
const UnsafeFunction = Function;
lockDown();

window.addEventListener("message", (event: MessageEvent<RunMessage>) => {
  if (event.source !== window.parent || event.data?.type !== RUN_MESSAGE) return;
  document.body.dataset.theme = event.data.theme;
  try {
    root?.unmount();
    mount.replaceChildren();
    root = createRoot(mount);
    const Component = evaluateComponent(event.data.code);
    root.render(
      <RuntimeBoundary
        onError={(error) => post({ event: "error", message: error.message, stack: error.stack })}
      >
        <Component />
      </RuntimeBoundary>,
    );
    post({ event: "ready", id: event.data.id });
    requestAnimationFrame(reportHeight);
  } catch (error) {
    const err = toError(error);
    post({ event: "error", message: err.message, stack: err.stack });
  }
});

post({ event: "booted" });

class RuntimeBoundary extends React.Component<
  { children: React.ReactNode; onError: (error: Error) => void },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

function lockDown() {
  const deny = () => {
    throw new Error("This API is disabled inside interactive documentation blocks.");
  };
  const denyProperty = (name: string) => {
    try {
      Object.defineProperty(window, name, { configurable: true, get: deny, set: deny });
    } catch {
      // Browsers already deny several of these APIs in an opaque-origin frame.
    }
  };

  window.open = deny as typeof window.open;
  window.fetch = deny as typeof window.fetch;
  window.eval = deny as typeof window.eval;
  Object.defineProperty(window, "Function", { configurable: true, value: deny });
  [
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "caches",
    "Notification",
    "Clipboard",
    "showOpenFilePicker",
    "showSaveFilePicker",
  ].forEach(denyProperty);
  try {
    Object.defineProperty(document, "cookie", { configurable: true, get: deny, set: deny });
  } catch {
    // Non-configurable browser implementations are still opaque-origin scoped.
  }
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = deny as typeof navigator.mediaDevices.getUserMedia;
  }
  if ("geolocation" in navigator) {
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      configurable: true,
      value: deny,
    });
  }
}

function evaluateComponent(code: string): React.ComponentType {
  const module = { exports: {} as Record<string, unknown> };
  const runner = UnsafeFunction(
    "React",
    "useState",
    "useEffect",
    "useLayoutEffect",
    "useMemo",
    "useCallback",
    "useRef",
    "useReducer",
    "useContext",
    "module",
    "exports",
    `'use strict';\n${code}\nreturn module.exports.default || exports.default;`,
  );
  const component = runner(
    React,
    React.useState,
    React.useEffect,
    React.useLayoutEffect,
    React.useMemo,
    React.useCallback,
    React.useRef,
    React.useReducer,
    React.useContext,
    module,
    module.exports,
  );
  if (typeof component !== "function") {
    throw new Error("React blocks must export a default function component.");
  }
  return component as React.ComponentType;
}

function toError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}
