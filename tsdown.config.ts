import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  sourcemap: true,
  fixedExtension: false,  // Use file extension .js instead of .mjs
});
