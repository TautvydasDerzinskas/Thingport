import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
