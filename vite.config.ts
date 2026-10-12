import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const server = `http://localhost:${process.env.PORT ?? 3000}`;
const proxied = ["/api", "/shelf", "/store", "/out", "/checkout", "/feed.csv", "/.well-known"];

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: Object.fromEntries(proxied.map((p) => [p, server])) },
});
