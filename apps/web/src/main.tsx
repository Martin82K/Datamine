import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@datamine/design/styles.css";
import "./styles.css";
import { App } from "./App";
import { applyAppTheme, readAppTheme } from "./app-theme";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Chybí kořen aplikace #root.");
}

applyAppTheme(document.documentElement, readAppTheme(window.localStorage));

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
