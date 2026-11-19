import { build } from "esbuild";

await build({
  entryPoints: ["src/auto.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  outfile: "dist/widget.js",
  legalComments: "none",
});
console.log("built dist/widget.js");
