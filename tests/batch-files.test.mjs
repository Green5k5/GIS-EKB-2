import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { zipSync } from "fflate";
import {
  receiveFile,
  persistBatch,
  loadBatch,
  batchInfo,
  removeFile,
} from "../server/batch-files.js";
import { storage } from "../server/ingest.js";
import { fileKind } from "../server/admin/import-policy.js";

test("files accumulate, unsupported ZIP entries are ignored, metadata survives restart, deletions remove blobs", async () => {
  const id = crypto.randomUUID(),
    directory = path.join(storage, "batch-" + id);
  await fs.mkdir(directory, { recursive: true });
  const b = { id, directory, status: "uploading", files: [] };
  persistBatch(b);
  await receiveFile(Readable.from([Buffer.from("first")]), b, "first.csv");
  await receiveFile(
    Readable.from([
      zipSync({
        "folder/second.csv": Buffer.from("second"),
        "folder/notes.docx": Buffer.from("unused"),
        "folder/image.png.aux.xml": Buffer.from("unused"),
      }),
    ]),
    b,
    "files.zip",
  );
  assert.equal(b.files.length, 2);
  assert.equal(b.ignored.length, 2);
  const reloaded = loadBatch(id);
  assert.equal(reloaded.files.length, 2);
  assert.equal(batchInfo(reloaded).files[0].kind, "table");
  assert.equal(await fs.readFile(reloaded.files[1].disk, "utf8"), "second");
  const removed = reloaded.files[0];
  await removeFile(reloaded, removed.id);
  persistBatch(reloaded);
  assert.equal(loadBatch(id).files.length, 1);
  await assert.rejects(fs.stat(removed.disk));
  await assert.rejects(
    receiveFile(
      Readable.from([Buffer.from("not used")]),
      reloaded,
      "unhandled.gpkg",
    ),
    /не поддерживается/,
  );
  assert.equal(fileKind("notes.jpg.aux.xml"), null);
  assert.equal(fileKind("plan.jpg").kind, "image");
});
