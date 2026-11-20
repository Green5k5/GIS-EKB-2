import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import sharp from "sharp";
import { zipSync } from "fflate";
const port = 3100 + Math.floor(Math.random() * 500),
  base = "http://127.0.0.1:" + port,
  root = "/api/admin/workspace";
const directory = path.resolve("data/test-" + Date.now());
let cookie = "",
  csrf = "";
async function request(
  route,
  { method = "GET", body, raw = false, headers = {} } = {},
) {
  const response = await fetch(base + route, {
    method,
    headers: {
      cookie,
      Origin: base,
      "X-CSRF-Token": csrf,
      ...(!raw && body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const result = await response.json();
  return { response, result };
}
async function call(route, options) {
  const { response, result } = await request(root + route, options);
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
function table(
  rows = [
    ["1", "Иванов", 100],
    ["2a", "Петров", 150],
  ],
) {
  const b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    b,
    XLSX.utils.aoa_to_sheet([
      ["№ усадьбы", "Фамилия владельца", "Площадь (кв. саж.)"],
      ...rows,
    ]),
    "Уктус",
  );
  return XLSX.write(b, { type: "buffer", bookType: "xlsx" });
}
async function batch(bytes = table(), zip = false) {
  const b = await call("/batches", { method: "POST", body: {} });
  await call("/batches/" + b.id + "/files", {
    method: "POST",
    raw: true,
    body: bytes,
    headers: { "X-File-Name": zip ? "data.zip" : "data.xlsx" },
  });
  await call("/batches/" + b.id + "/analyze", { method: "POST" });
  for (let i = 0; i < 100; i++) {
    const status = await call("/batches/" + b.id);
    if (status.status === "error") throw new Error(status.error);
    if (status.status === "ready") return status;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Analysis timeout");
}

test("workspace: isolated end-to-end import, edits, conflicts, publication, backup and restore", async () => {
  await fs.mkdir(directory, { recursive: true });
  const server = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_KEY: "integration-test-only",
      DB_PATH: path.join(directory, "test.sqlite"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  server.stderr.on("data", (b) => (output += b));
  server.stdout.on("data", (b) => (output += b));
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/admin/session")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal((await request(root)).response.status, 401);
    const login = await request("/api/admin/login", {
      method: "POST",
      body: { key: "integration-test-only" },
    });
    cookie = login.response.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; ");
    csrf = decodeURIComponent(cookie.match(/gis_csrf=([^;]+)/)[1]);
    let prepared = await batch(zipSync({ "nested/data.xlsx": table() }), true);
    assert.equal(prepared.result.summary.records, 2);
    assert.equal(prepared.result.summary.unmatched, 2);
    await call("/batches/" + prepared.id + "/apply", {
      method: "POST",
      body: {},
    });
    let state = await call("");
    assert.equal(state.records.length, 2);
    assert.equal(state.records[1].num, "2a");
    const id = state.records[0].id;
    const shape = {
      type: "Polygon",
      coordinates: [
        [
          [60, 56],
          [60, 56.01],
          [60.01, 56.01],
          [60.01, 56],
          [60, 56],
        ],
      ],
    };
    const added = await call("/records", {
      method: "POST",
      body: {
        num: "3",
        settlementId: "uktus",
        surname: "Новая усадьба",
        geometry: shape,
      },
    });
    const withNew = await call("");
    assert.equal(withNew.records.length, 3);
    assert.ok(withNew.records.find((r) => r.id === added.id).plotId);
    await call("/records/" + added.id, { method: "DELETE" });
    assert.equal((await call("")).records.length, 2);
    const image = await call("/image", {
      method: "POST",
      raw: true,
      body: await sharp({
        create: { width: 4, height: 4, channels: 4, background: "#ffffff" },
      })
        .png()
        .toBuffer(),
    });
    const overlay = await call("/overlays", {
      method: "POST",
      body: {
        name: "Пробный план",
        fileUrl: image.fileUrl,
        bounds: [
          [56, 60],
          [56.01, 60.01],
        ],
        opacity: 0.6,
        rotation: 12,
        crop: [0.1, 0, 0, 0],
      },
    });
    assert.equal(image.width, 4);
    assert.equal(image.height, 4);
    assert.equal((await call("")).overlays[0].rotation, 12);
    await call("/overlays/" + overlay.id, {
      method: "PATCH",
      body: { rotation: 0, opacity: 0.8 },
    });
    assert.equal((await call("")).overlays[0].opacity, 0.8);
    const firstRelease = (
      await call("/publish", { method: "POST", body: { note: "Initial" } })
    ).id;
    // Replacing pixels must not alter geographic registration or published images.
    const beforeReplacement = (await call("")).overlays.find(
      (o) => o.id === overlay.id,
    );
    const transparent = await call("/image", {
      method: "POST",
      raw: true,
      body: await sharp({
        create: {
          width: 4,
          height: 4,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 0.25 },
        },
      })
        .png()
        .toBuffer(),
    });
    assert.ok(transparent.fileUrl.endsWith(".png"));
    await call("/overlays/" + overlay.id, {
      method: "PATCH",
      body: { fileUrl: transparent.fileUrl },
    });
    const afterReplacement = (await call("")).overlays.find(
      (o) => o.id === overlay.id,
    );
    assert.deepEqual(
      { ...afterReplacement, fileUrl: beforeReplacement.fileUrl },
      beforeReplacement,
    );
    assert.equal(
      (await request("/api/public/bootstrap")).result.overlays.find(
        (o) => o.id === overlay.id,
      ).fileUrl,
      image.fileUrl,
    );
    const downloaded = await fetch(
      base +
        root +
        "/image.png?" +
        new URLSearchParams({ fileUrl: transparent.fileUrl, name: "План" }),
      { headers: { cookie } },
    );
    assert.equal(downloaded.headers.get("content-type"), "image/png");
    assert.match(downloaded.headers.get("content-disposition"), /attachment/);
    const exported = await sharp(Buffer.from(await downloaded.arrayBuffer()))
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(exported.info.width, 4);
    assert.equal(exported.info.height, 4);
    assert.equal(exported.data[3], 64);
    assert.equal((await fetch(base + transparent.fileUrl)).status, 200);
    const copied = await call("/images/copy", {
      method: "POST",
      body: { fileUrl: transparent.fileUrl },
    });
    assert.notEqual(copied.fileUrl, transparent.fileUrl);
    assert.deepEqual(
      await fs.readFile(path.resolve("." + copied.fileUrl)),
      await fs.readFile(path.resolve("." + transparent.fileUrl)),
    );
    assert.equal(
      (
        await request(root + "/images/copy", {
          method: "POST",
          body: { fileUrl: "/data/uploads/../../.env" },
        })
      ).response.status,
      422,
    );
    await call("/records/" + id, {
      method: "PATCH",
      body: { surname: "Ручная правка", notes: "Сохранить" },
    });
    assert.equal(
      (await request("/api/public/bootstrap")).result.records[0].surname,
      "Иванов",
    );
    prepared = await batch();
    assert.equal(prepared.result.conflicts.length, 1);
    const applied = await call("/batches/" + prepared.id + "/apply", {
      method: "POST",
      body: {},
    });
    assert.equal(applied.kept, 1);
    assert.equal((await call("")).records[0].surname, "Ручная правка");
    prepared = await batch();
    await call("/records/" + id, {
      method: "PATCH",
      body: { notes: "Изменилось после проверки" },
    });
    assert.equal(
      (
        await request(root + "/batches/" + prepared.id + "/apply", {
          method: "POST",
          body: {},
        })
      ).response.status,
      409,
    );
    assert.equal(
      (
        await request(root + "/records/" + id, {
          method: "PATCH",
          body: {
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [1, 1],
                  [2, 2],
                ],
              ],
            },
          },
        })
      ).response.status,
      422,
    );
    const reset = await call("/reset", { method: "POST" });
    assert.ok(
      (await fs.stat(path.join("data/backups", reset.backup))).size > 0,
    );
    assert.equal(
      (await request("/api/public/bootstrap")).result.records.length,
      0,
    );
    prepared = await batch();
    await call("/batches/" + prepared.id + "/apply", {
      method: "POST",
      body: {},
    });
    state = await call("");
    assert.equal(state.records.length, 2);
    assert.equal(state.records[0].surname, "Иванов");
    await call("/restore/" + firstRelease, { method: "POST" });
    assert.equal(
      (await request("/api/public/bootstrap")).result.records.length,
      2,
    );
    const zip = zipSync({ "../../escape.xlsx": table() });
    prepared = await batch(zip, true);
    assert.equal(prepared.status, "ready");
    const partial = await batch(
      table([
        ["716", "Зырянов", "166,(6)"],
        ["717", "Сосед", 99],
      ]),
    );
    assert.equal(partial.result.records.length, 2);
    assert.equal(partial.result.records[0].issues[0].code, "invalid_area");
    await call("/batches/" + partial.id + "/apply", {
      method: "POST",
      body: {},
    });
    const suspect = (await call("")).records.find((r) => r.num === "716");
    assert.equal(suspect.area_sazh, null);
    assert.equal(suspect.sourceData["Площадь (кв. саж.)"], "166,(6)");
    assert.ok(suspect.issues.length);
    await call("/records/" + suspect.id, {
      method: "PATCH",
      body: { area_sazh: 166.6 },
    });
    assert.equal(
      (await call("")).records.find((r) => r.id === suspect.id).issues.length,
      0,
    );
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#000000" },
    })
      .png()
      .toBuffer();
    const plans = await batch(zipSync({ "a.png": png, "b.png": png }), true);
    assert.equal(plans.result.overlays.length, 2);
    assert.ok((await call("/batches")).some((b) => b.id === plans.id));
    await call("/batches/" + plans.id + "/selection", {
      method: "PATCH",
      body: { planIds: [plans.result.overlays[1].sourceFileId] },
    });
    assert.deepEqual(
      (await call("/batches/" + plans.id)).result.selectedPlanIds,
      [plans.result.overlays[1].sourceFileId],
    );
    assert.deepEqual(plans.result.overlays[0].crop, [0, 0, 0, 0]);
    const previewFile = path.resolve("." + plans.result.overlays[0].fileUrl);
    const pixels = await sharp(await fs.readFile(previewFile))
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.equal(pixels[3], 255);
    const stagedOriginal = plans.result.overlays[1];
    const replacedBatch = await call(
      `/batches/${plans.id}/plans/${stagedOriginal.sourceFileId}/image`,
      { method: "PATCH", body: { fileUrl: transparent.fileUrl } },
    );
    const stagedReplaced = replacedBatch.result.overlays[1];
    assert.deepEqual(
      { ...stagedReplaced, fileUrl: stagedOriginal.fileUrl },
      stagedOriginal,
    );
    assert.notEqual(stagedReplaced.fileUrl, transparent.fileUrl);
    assert.deepEqual(replacedBatch.result.selectedPlanIds, [
      stagedOriginal.sourceFileId,
    ]);
    const removedPlan = plans.result.overlays[0].sourceFileId;
    await call("/batches/" + plans.id + "/plans/" + removedPlan, {
      method: "DELETE",
    });
    await assert.rejects(fs.stat(previewFile));
    const remaining = (await call("/batches/" + plans.id)).result.overlays;
    assert.equal(remaining.length, 1);
    await call("/batches/" + plans.id + "/apply", {
      method: "POST",
      body: { planIds: remaining.map((o) => o.sourceFileId) },
    });
    assert.ok((await call("")).overlays.some((o) => o.name === "b"));
    assert.equal((await fetch(base + "/.env")).status, 404);
    assert.equal((await fetch(base + "/server/gis-ekb.sqlite")).status, 404);
    assert.equal(
      (await fetch(base + "/data/backups/" + reset.backup)).status,
      404,
    );
  } finally {
    server.kill();
  }
});
