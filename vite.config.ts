import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [svelte(), tailwindcss()],
  build: { outDir: "../../dist", emptyOutDir: true },
});
