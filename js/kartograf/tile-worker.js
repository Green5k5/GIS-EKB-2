/* =====================================================================
   Картограф — фоновый поток: загрузка, декодирование и отрисовка тайлов.
   Основной поток получает готовые ImageBitmap и только компонует их,
   поэтому перемещение и масштаб карты остаются плавными.
   ===================================================================== */
/* global importScripts, KartografMVT, KartografRender */
"use strict";

importScripts("mvt.js?v=20260912", "render.js?v=20260925");

const DATA_CACHE_MAX = 96;
const dataCache = new Map();      // url -> Promise<prepared|null>
let canvas = null, ctx = null;

function capable() {
  try {
    if (typeof OffscreenCanvas === "undefined" || typeof Path2D === "undefined") return false;
    const c = new OffscreenCanvas(4, 4);
    const x = c.getContext("2d");
    return Boolean(x && typeof c.transferToImageBitmap === "function");
  } catch (e) {
    return false;
  }
}

function getData(url) {
  let p = dataCache.get(url);
  if (p) {
    dataCache.delete(url);
    dataCache.set(url, p);               // LRU: освежаем
    return p;
  }
  p = fetch(url).then(r => {
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.arrayBuffer();
  }).then(buf => buf ? KartografRender.prepare(KartografMVT.decode(buf)) : null);
  p.catch(() => dataCache.delete(url));
  dataCache.set(url, p);
  while (dataCache.size > DATA_CACHE_MAX) dataCache.delete(dataCache.keys().next().value);
  return p;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "init") {
    self.postMessage({ type: "ready", ok: capable() });
    return;
  }
  if (m.type === "labels") {
    try {
      const data = await getData(m.url);
      self.postMessage({ type: "labels", key: m.key, labels: data ? data.labels : [] });
    } catch (err) {
      self.postMessage({ type: "labels", key: m.key, labels: null, error: String(err) });
    }
    return;
  }
  if (m.type === "render") {
    try {
      const data = await getData(m.url);
      if (!data) {
        self.postMessage({ type: "tile", id: m.id, empty: true });
        return;
      }
      if (!canvas || canvas.width !== m.size) {
        canvas = new OffscreenCanvas(m.size, m.size);
        ctx = canvas.getContext("2d");
      }
      KartografRender.renderTile(ctx, data, m);
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ type: "tile", id: m.id, bitmap }, [bitmap]);
    } catch (err) {
      self.postMessage({ type: "tile", id: m.id, error: String(err) });
    }
  }
};
