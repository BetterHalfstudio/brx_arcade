import { useState } from "react";
import { useHashRoute } from "./router";
import { TopNav } from "./components/TopNav";
import { DitherTool } from "./tools/DitherTool";
import { FaceTool } from "./tools/FaceTool";

// Shell: global top nav (links the tools) + the active tool below.

export default function App() {
  const route = useHashRoute();
  const [faceVersion, setFaceVersion] = useState(2);
  return (
    <div className="shell">
      <TopNav route={route} faceVersion={faceVersion} onFaceVersion={setFaceVersion} />
      <div className="view">
        {route === "/face" ? <FaceTool version={faceVersion} /> : <DitherTool />}
      </div>
    </div>
  );
}
