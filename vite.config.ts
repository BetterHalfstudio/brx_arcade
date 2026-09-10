import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static, fully client-side build. `base: "./"` keeps asset paths relative so
// the dist/ folder can be dropped onto any static host or opened from a subpath.
// The dev server binds PORT when the environment assigns one (harness previews).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        // standalone avatar kiosk — served at /avatar via a vercel rewrite
        avatar: resolve(__dirname, "avatar.html"),
      },
    },
  },
});
