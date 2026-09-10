import { useState } from "react";
import { useHashRoute } from "./router";
import { TopNav } from "./components/TopNav";
import { DitherTool } from "./tools/DitherTool";
import { FaceTool } from "./tools/FaceTool";

// Shell: global top nav (links the tools) + the active tool below.

// Hidden developer mode: toggled by clicking the blip (the three squares at
// the top right). Reveals tuning UI (FACE levels, prompt, style ref) that
// testers shouldn't see. Persists across reloads for whoever switched it on.
function loadDev(): boolean {
  try {
    return localStorage.getItem("brx:dev") === "1";
  } catch {
    return false;
  }
}

export default function App() {
  const route = useHashRoute();
  const [faceVersion, setFaceVersion] = useState(2);
  const [dev, setDev] = useState(loadDev);
  const toggleDev = () => {
    setDev((d) => {
      try {
        localStorage.setItem("brx:dev", d ? "0" : "1");
      } catch {
        /* private mode etc. — session-only toggle still works */
      }
      return !d;
    });
  };
  return (
    <div className="shell">
      <TopNav
        route={route}
        faceVersion={faceVersion}
        onFaceVersion={setFaceVersion}
        dev={dev}
        onToggleDev={toggleDev}
      />
      <div className="view">
        {route === "/face" ? (
          <FaceTool version={faceVersion} dev={dev} />
        ) : route === "/bg" ? (
          <DitherTool key="bg" mode="bg" />
        ) : (
          <DitherTool key="dither" />
        )}
      </div>
    </div>
  );
}
