import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { Unzip, UnzipInflate } from "fflate";
import { fileKind, ignoredReason } from "./admin/import-policy.js";
import { storage } from "./ingest.js";

export function persistBatch(batch) {
  const temporary = path.join(batch.directory, "manifest.tmp");
  fs.writeFileSync(temporary, JSON.stringify(batch));
  fs.renameSync(temporary, path.join(batch.directory, "manifest.json"));
}
export function loadBatch(id) {
  if (!/^[a-f0-9-]+$/.test(id)) return null;
  try {
    const b = JSON.parse(
      fs.readFileSync(
        path.join(storage, "batch-" + id, "manifest.json"),
        "utf8",
      ),
    );
    if (b.status === "analyzing") {
      b.status = "uploading";
      b.progress = "Проверка прервана. Можно запустить её снова.";
    }
    return b;
  } catch {
    return null;
  }
}
export function batchInfo(b) {
  return {
    id: b.id,
    status: b.status,
    progress: b.progress,
    error: b.error,
    files: b.files.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      ...fileKind(f.name),
    })),
    ignored: b.ignored || [],
    result: b.result,
    settlementName: b.settlementName,
    baseRevision: b.baseRevision,
  };
}
async function replaceFile(batch, file) {
  const previous = batch.files.find(
    (f) => f.name.toLowerCase() === file.name.toLowerCase(),
  );
  if (previous) {
    await removeFile(batch, previous.id);
  }
  batch.files.push(file);
}
export async function receiveFile(req, batch, name) {
  if (!fileKind(name)) throw new Error(ignoredReason(name));
  const id = crypto.randomUUID(),
    disk = path.join(batch.directory, id + path.extname(name)),
    file = { id, name, disk, size: 0 };
  try {
    await pipeline(
      req,
      new Transform({
        transform(chunk, enc, cb) {
          file.size += chunk.length;
          cb(null, chunk);
        },
      }),
      fs.createWriteStream(disk),
    );
    if (!/\.zip$/i.test(name)) {
      await replaceFile(batch, file);
      persistBatch(batch);
      return;
    }
    // Expand one entry at a time directly to disk: no aggregate/file-size cap and no archive-sized Buffer.
    const entries = [],
      open = new Set();
    let failure = null;
    const unzip = new Unzip((entry) => {
      if (!fileKind(entry.name) || entry.name.endsWith("/")) {
        if (!entry.name.endsWith("/"))
          (batch.ignored ??= []).push({
            name: entry.name,
            reason: ignoredReason(entry.name),
          });
        return;
      }
      const fid = crypto.randomUUID(),
        target = path.join(batch.directory, fid + path.extname(entry.name));
      const item = { id: fid, name: entry.name, disk: target, size: 0 },
        fd = fs.openSync(target, "w");
      open.add(fd);
      entries.push(item);
      entry.ondata = (error, bytes, final) => {
        if (error) {
          failure = error;
          return;
        }
        try {
          if (bytes?.length) {
            fs.writeFileSync(fd, bytes);
            item.size += bytes.length;
          }
          if (final) {
            fs.closeSync(fd);
            open.delete(fd);
          }
        } catch (e) {
          failure = e;
        }
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    try {
      for await (const chunk of fs.createReadStream(disk)) {
        unzip.push(chunk, false);
        if (failure) throw failure;
      }
      unzip.push(new Uint8Array(), true);
      if (failure) throw failure;
      if (open.size)
        throw new Error("Архив повреждён: не все файлы распакованы.");
    } catch (e) {
      for (const fd of open)
        try {
          fs.closeSync(fd);
        } catch {}
      open.clear();
      for (const entry of entries) await fsp.unlink(entry.disk).catch(() => {});
      throw e;
    } finally {
      for (const fd of open)
        try {
          fs.closeSync(fd);
        } catch {}
      await fsp.unlink(disk).catch(() => {});
    }
    for (const entry of entries) await replaceFile(batch, entry);
    persistBatch(batch);
  } catch (e) {
    await fsp.unlink(disk).catch(() => {});
    throw e;
  }
}
export async function removeFile(batch, id) {
  const file = batch.files.find((f) => f.id === id);
  if (!file) throw new Error("Файл не найден.");
  await fsp.unlink(file.disk).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  await fsp
    .unlink(path.join(batch.directory, id + "-preview.webp"))
    .catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  batch.files = batch.files.filter((f) => f.id !== id);
}
