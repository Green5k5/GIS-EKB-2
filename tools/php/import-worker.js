import { Buffer } from "buffer";
import { fromUrl } from "geotiff";
import { analyzeBundle } from "../../server/ingest-core.js";

const isTiff = (file) => /\.tiff?$/i.test(file.name);

function dimensions(width, height) {
  if (width * height > 500_000_000) throw new Error("Изображение слишком большое.");
  const scale = Math.min(1, 4096 / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

async function renderTiff(tiff) {
  const original = await tiff.getImage();
  const [width, height] = dimensions(original.getWidth(), original.getHeight());
  let image = original;
  // A smaller overview avoids decoding the full-resolution raster when one exists.
  const images = await tiff.getImageCount();
  for (let i = 1; i < images; i++) {
    const candidate = await tiff.getImage(i);
    const directory = candidate.fileDirectory;
    const isOverview = (directory.getValue("NewSubfileType") & 1) || directory.getValue("SubfileType") === 2;
    if (isOverview && candidate.getWidth() >= width && candidate.getHeight() >= height &&
      candidate.getWidth() < image.getWidth()) image = candidate;
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  const nodata = image.getGDALNoData();
  const grayscale = image.getSamplesPerPixel() === 1;
  const xScale = image.getWidth() / width;
  const yScale = image.getHeight() / height;
  const tileSize = 512;
  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      const w = Math.min(tileSize, width - x);
      const h = Math.min(tileSize, height - y);
      const window = [Math.floor(x * xScale), Math.floor(y * yScale),
        Math.ceil((x + w) * xScale), Math.ceil((y + h) * yScale)];
      const options = { window, width: w, height: h, interleave: true };
      const channels = await image.readRGB({ ...options, enableAlpha: true });
      const stride = channels.length / (w * h);
      if (stride < 3 || !Number.isInteger(stride)) throw new Error("Не удалось прочитать цветовые каналы TIFF.");
      const mask = grayscale && nodata !== null ? await image.readRasters(options) : null;
      const pixels = new Uint8ClampedArray(w * h * 4);
      const scale = channels.BYTES_PER_ELEMENT > 1 ? 255 / (2 ** image.getBitsPerSample(0) - 1) : 1;
      for (let i = 0; i < w * h; i++) {
        const source = i * stride;
        const dest = i * 4;
        pixels[dest] = channels[source] * scale;
        pixels[dest + 1] = channels[source + 1] * scale;
        pixels[dest + 2] = channels[source + 2] * scale;
        pixels[dest + 3] = mask && mask[i] === nodata ? 0 : stride >= 4 ? channels[source + 3] * scale : 255;
      }
      context.putImageData(new ImageData(pixels, w, h), x, y);
    }
  }
  return canvas;
}

async function renderImage(response) {
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const [width, height] = dimensions(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

self.onmessage = async ({ data: { batch, analysisToken, csrf } }) => {
  const endpoint = "/api/admin/workspace/batches/" + batch.id;
  const source = (file) => new URL(endpoint + "/source/" + file.id, self.location.origin).href;
  const checked = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Ошибка сервера (${response.status}).`);
    }
    return response;
  };
  const io = {
    async read(file, encoding) {
      const response = await checked(source(file));
      return encoding ? response.text() : Buffer.from(await response.arrayBuffer());
    },
    openTiff(file) {
      return fromUrl(source(file));
    },
    async preview(file, _directory, tiff) {
      const canvas = isTiff(file)
        ? await renderTiff(tiff || await io.openTiff(file))
        : await renderImage(await checked(source(file)));
      const body = await canvas.convertToBlob({ type: "image/webp", quality: 0.88 });
      const response = await checked(endpoint + "/preview/" + file.id, {
        method: "POST",
        headers: { "X-CSRF-Token": csrf, "X-GIS-Analysis": analysisToken },
        body,
      });
      return response.json();
    },
  };
  try {
    const result = await analyzeBundle(batch, (progress) => self.postMessage({ progress }), io);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
