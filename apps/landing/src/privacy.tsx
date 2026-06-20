import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/hanken-grotesk";
import "./styles.css";
import PrivacyApp from "./PrivacyApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivacyApp />
  </StrictMode>,
);
