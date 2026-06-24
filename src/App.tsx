import { useRef } from "react";
import { useAppStore } from "./state/store";
import { Panel } from "./panel/Panel";
import { CanvasStage } from "./canvas/CanvasStage";
import type { Engine } from "./canvas/Engine";
import { downloadBlob, stampName } from "./export/download";

export default function App() {
  const store = useAppStore();
  const engineRef = useRef<Engine | null>(null);

  async function onExport() {
    const eng = engineRef.current;
    if (!eng || !store.state.layer.image) return;
    try {
      const blob = await eng.exportPNG(store.state);
      downloadBlob(blob, stampName());
    } catch (err) {
      console.error("export failed", err);
    }
  }

  return (
    <div className="app">
      <Panel store={store} onExport={onExport} />
      <CanvasStage store={store} engineRef={engineRef} />
    </div>
  );
}
