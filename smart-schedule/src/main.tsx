import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerGlobalErrorLogging } from "@/lib/error-logger";
import "@/styles/tokens.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

registerGlobalErrorLogging();

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
