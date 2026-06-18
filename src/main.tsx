import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { BootstrapPayload } from "./types";
import "./styles.css";

declare global {
  interface Window {
    __EH_BOOTSTRAP__?: BootstrapPayload;
  }
}

const bootstrap: BootstrapPayload =
  window.__EH_BOOTSTRAP__ || {
    user: {
      id: "dev-user",
      email: "dev@efficienthypothesis.local",
      name: "Efficient Hypothesis"
    },
    initialPage: "home"
  };

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App bootstrap={bootstrap} />
  </React.StrictMode>
);
