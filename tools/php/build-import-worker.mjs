import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["tools/php/import-worker.js"],
  bundle: true,
  platform: "browser",
  alias: { buffer: "buffer/" },
  target: "es2022",
  minify: true,
  write: false,
});
writeFileSync("server/admin/import-worker.js.gz", gzipSync(outputFiles[0].contents, { level: 9 }));
