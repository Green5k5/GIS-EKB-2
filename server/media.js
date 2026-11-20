import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

// Only raster assets may be read or copied. Never accept arbitrary local paths.
export async function imagePath(fileUrl) {
  if (typeof fileUrl !== "string")
    throw new Error("Выберите изображение плана.");
  const relative = decodeURIComponent(fileUrl).replace(/^\//, "");
  if (
    !/^(data\/uploads|assets\/overlays-lite)\//.test(relative) ||
    !/\.(png|webp|jpe?g)$/i.test(relative) ||
    relative.split(/[\\/]/).includes("..") ||
    relative.includes("\\")
  )
    throw new Error("Недопустимый файл изображения.");
  const filename = await fs.realpath(path.resolve(relative));
  const allowed = await Promise.all(
    ["data/uploads", "assets/overlays-lite"].map(async (p) =>
      fs.realpath(path.resolve(p)).catch(() => path.resolve(p)),
    ),
  );
  if (!allowed.some((root) => filename.startsWith(root + path.sep)))
    throw new Error("Недопустимый файл изображения.");
  return filename;
}

export async function copyImage(fileUrl) {
  const source = await imagePath(fileUrl);
  const directory = path.resolve("data/uploads/images");
  await fs.mkdir(directory, { recursive: true });
  const name = crypto.randomUUID() + path.extname(source).toLowerCase();
  await fs.copyFile(source, path.join(directory, name));
  return { fileUrl: "/data/uploads/images/" + name };
}

export async function downloadImage(res, fileUrl, name = "План") {
  const source = await imagePath(fileUrl);
  // Export the full bitmap. Placement, crop and opacity remain separate metadata.
  const png = await sharp(source).png().toBuffer();
  const filename = name.replace(/[\r\n/\\]/g, "_") + ".png";
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Disposition": `attachment; filename="plan.png"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "no-store",
    "Content-Length": png.length,
  });
  res.end(png);
}
