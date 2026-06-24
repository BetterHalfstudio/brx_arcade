import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static, fully client-side build. `base: "./"` keeps asset paths relative so
// the dist/ folder can be dropped onto any static host or opened from a subpath.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
