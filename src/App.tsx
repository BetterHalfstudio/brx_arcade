import { useHashRoute } from "./router";
import { TopNav } from "./components/TopNav";
import { DitherTool } from "./tools/DitherTool";
import { FaceTool } from "./tools/FaceTool";

// Shell: global top nav (links the tools) + the active tool below.

export default function App() {
  const route = useHashRoute();
  return (
    <div className="shell">
      <TopNav route={route} />
      <div className="view">
        {route === "/face" ? <FaceTool /> : <DitherTool />}
      </div>
    </div>
  );
}
