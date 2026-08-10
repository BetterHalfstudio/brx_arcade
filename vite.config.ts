import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static, fully client-side build. `base: "./"` keeps asset paths relative so
// the dist/ folder can be dropped onto any static host or opened from a subpath.
// The dev server binds PORT when the environment assigns one (harness previews).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5173 },
});
