import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AvatarApp } from "./AvatarApp";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AvatarApp />
  </StrictMode>
);
