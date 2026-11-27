import fs from "node:fs/promises";
import path from "node:path";
import { fromFile } from "geotiff";
import sharp from "sharp";
import { analyzeBundle as analyze, prepareRaster as prepare } from "./ingest-core.js";

export { geometryBounds, geometryPoints, readShapes, readWorkbook, settlementInfo, validateGeometry } from "./ingest-core.js";
export const storage = path.resolve("data/uploads");

// Release Windows file handles after raster preparation so staged plans can be deleted.
sharp.cache({ files: 0 });

const io = {
  read(file, encoding) {
    return fs.readFile(file.disk, encoding);
  },
  openTiff(file) {
    return fromFile(file.disk);
  },
  async preview(file, directory, georeferenced) {
    const output = path.join(directory, file.id + "-preview.webp");
    const preview = sharp(file.disk, { limitInputPixels: 500_000_000 });
    if (!georeferenced) preview.rotate();
    const { width, height } = await preview
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .webp({ quality: 88 })
      .toFile(output);
    return {
      fileUrl: "/data/uploads/" + path.relative(storage, output).split(path.sep).join("/"),
      width,
      height,
    };
  },
};

export function prepareRaster(file, directory) {
  return prepare(file, directory, io);
}

export function analyzeBundle(batch, progress = () => {}) {
  return analyze(batch, progress, io);
}
