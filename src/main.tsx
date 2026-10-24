import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";

void import("./core/exporter/export-fail-dump").then((mod) => {
  mod.installExportFailDiagnostics();
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("V5.5 host: #root missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
