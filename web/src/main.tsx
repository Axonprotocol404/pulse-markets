import "./polyfills";

// Dynamic import so the Buffer polyfill lands before any Solana code loads.
const { default: App } = await import("./App");
const { createRoot } = await import("react-dom/client");
const { StrictMode, createElement } = await import("react");
await import("./index.css");

createRoot(document.getElementById("root")!).render(
  createElement(StrictMode, null, createElement(App)),
);
