// The documents loaded into an interactive block's sandboxed frame.
//
// Both are delivered through `srcdoc`, so a frame needs no network request and
// no route in the app. The frame has an opaque origin (sandbox="allow-scripts"
// without allow-same-origin), and each document carries its own CSP: no
// network at all (`connect-src`, `img-src` and friends exclude http), so an
// example can't send what it sees anywhere, even through an image URL.
import { FRAME_MESSAGE } from "./frame-protocol";

type Theme = "light" | "dark";

// No min-height on html/body: the frame is sized to the body's height, and a
// body that fills the frame would report the frame's own height back, growing
// it a pixel per round up to the cap. The body's background still fills the
// frame (it propagates to the canvas).
const BASE_CSS =
  "html,body{margin:0}*{box-sizing:border-box}" +
  "body{padding:18px;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
  "overflow-x:hidden;color-scheme:light;background:#fff;color:#172033}" +
  "body[data-theme=dark]{color-scheme:dark;background:#151b2b;color:#edf2ff}" +
  "button,input,select,textarea{font:inherit}button{cursor:pointer}";

function frameCsp(script: string) {
  return (
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; " +
    `script-src ${script}; connect-src 'none'; font-src data:; media-src data: blob:`
  );
}

/**
 * An ```interactive-react frame: React and the runtime inline, then it waits
 * for compiled code from the reader. `'unsafe-eval'` is what runs the compiled
 * component (the runtime keeps a private reference to Function and removes the
 * global before any authored code runs).
 */
export function reactFrameDocument(runtime: string, theme: Theme) {
  return `<!doctype html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${frameCsp("'unsafe-inline' 'unsafe-eval'")}" />
<style>${BASE_CSS}</style>
</head><body data-theme="${theme}"><div id="root"></div>
<script>${inlineScript(runtime)}</script>
</body></html>`;
}

/** An ```interactive-html frame: the author's markup, with a small guard script. */
export function htmlFrameDocument(source: string, theme: Theme) {
  return `<!doctype html><html><head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${frameCsp("'unsafe-inline'")}" />
    <style>${BASE_CSS}</style>
  </head><body data-theme="${theme}">
    <script>
      (() => {
        const deny=()=>{throw new Error('This API is disabled inside interactive documentation blocks.')};
        window.open=deny; window.fetch=deny; window.eval=deny; window.Function=deny;
        ['localStorage','sessionStorage','indexedDB','caches','Notification','Clipboard','showOpenFilePicker','showSaveFilePicker'].forEach((name)=>{try{Object.defineProperty(window,name,{configurable:true,get:deny,set:deny})}catch{}});
        try{Object.defineProperty(document,'cookie',{configurable:true,get:deny,set:deny})}catch{}
        if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=deny;
        if(navigator.geolocation) navigator.geolocation.getCurrentPosition=deny;
        new ResizeObserver(()=>parent.postMessage({type:'${FRAME_MESSAGE}',event:'height',height:Math.ceil(document.body.getBoundingClientRect().height)},'*')).observe(document.body);
        addEventListener('error',(event)=>parent.postMessage({type:'${FRAME_MESSAGE}',event:'error',message:event.message,stack:event.error&&event.error.stack},'*'));
        parent.postMessage({type:'${FRAME_MESSAGE}',event:'booted'},'*');
      })();
    </script>
    ${source}</body></html>`;
}

/**
 * Script text is safe inside <script> once nothing in it can close the
 * element. In JavaScript, `<\/` means the same as `</` inside strings,
 * templates and regular expressions, the only places it can occur. (After a
 * `<!--` the HTML parser could still skip the closing tag; the runtime's build
 * refuses output containing one.)
 */
export function inlineScript(code: string) {
  return code.replace(/<\/(script)/gi, "<\\/$1");
}
