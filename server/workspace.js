import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { imagePath, copyImage, downloadImage } from "./media.js";
import {
  batchInfo,
  persistBatch,
  loadBatch,
  receiveFile,
  removeFile,
} from "./batch-files.js";
import sharp from "sharp";
import {
  analyzeBundle,
  geometryBounds,
  validateGeometry,
  storage,
} from "./ingest.js";

const batches = new Map();
const columns = {
  num: "num",
  settlementId: "settlement_id",
  street: "street",
  buildingType: "building_type",
  surname: "surname",
  name: "name",
  patronymic: "patronymic",
  soslovie: "soslovie",
  familyStatus: "family_status",
  sex: "sex",
  serviceType: "service_type",
  rank: "rank",
  position: "position",
  servicePlace: "service_place",
  registrationPlace: "registration_place",
  area_sazh: "area_sazh",
  source: "source",
  scanUrl: "scan_url",
  lat: "lat",
  lng: "lng",
  plotId: "plot_id",
  notes: "notes",
  extra: "extra_json",
  sourceData: "source_data_json",
  sourceKey: "source_key",
  localEdit: "local_edit",
  issues: "issues_json",
};
export function initWorkspace(db) {
  const add = (table, name, type) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((x) => x.name === name)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  };
  for (const [n, t] of Object.entries({
    notes: "TEXT NOT NULL DEFAULT ''",
    extra_json: "TEXT NOT NULL DEFAULT '{}'",
    source_data_json: "TEXT NOT NULL DEFAULT '{}'",
    source_key: "TEXT NOT NULL DEFAULT ''",
    local_edit: "INTEGER NOT NULL DEFAULT 0",
  }))
    add("records", n, t);
  add("records", "issues_json", "TEXT NOT NULL DEFAULT '[]'");
  db.exec(
    "CREATE TABLE IF NOT EXISTS workspace_warnings(id INTEGER PRIMARY KEY AUTOINCREMENT,settlement_id TEXT,batch_id TEXT,message TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0)",
  );
  add("historical_overlays", "rotation", "REAL NOT NULL DEFAULT 0");
  add("historical_overlays", "crop_json", "TEXT NOT NULL DEFAULT '[0,0,0,0]'");
  fs.mkdirSync(storage, { recursive: true });
  fs.mkdirSync(path.resolve("data/backups"), { recursive: true });
}
export function toRecord(row) {
  const r = { id: row.id, status: row.status };
  for (const [k, c] of Object.entries(columns))
    r[k] = ["extra", "sourceData", "issues"].includes(k)
      ? JSON.parse(row[c] || (k === "issues" ? "[]" : "{}"))
      : row[c];
  return r;
}
function saveRecord(db, r, id, localEdit) {
  const keys = Object.keys(columns),
    values = keys.map((k) =>
      ["extra", "sourceData", "issues"].includes(k)
        ? JSON.stringify(r[k] || (k === "issues" ? [] : {}))
        : k === "localEdit"
          ? Number(localEdit)
          : (r[k] ??
            (["area_sazh", "lat", "lng", "plotId"].includes(k) ? null : "")),
    );
  if (id) {
    db.prepare(
      `UPDATE records SET ${keys.map((k) => columns[k] + "=?").join(",")},status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).run(...values, id);
    return id;
  }
  return Number(
    db
      .prepare(
        `INSERT INTO records(${keys.map((k) => columns[k]).join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
      )
      .run(...values).lastInsertRowid,
  );
}
function txn(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function backup(db) {
  const file = path.resolve(
    "data/backups",
    new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      crypto.randomBytes(3).toString("hex") +
      ".sqlite",
  );
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return path.basename(file);
}
function revision(db) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        db.prepare("SELECT * FROM records ORDER BY id").all(),
        db.prepare("SELECT * FROM plots ORDER BY id").all(),
        db.prepare("SELECT * FROM historical_overlays ORDER BY id").all(),
      ]),
    )
    .digest("hex");
}
function publish(db, snapshot, note) {
  return Number(
    db
      .prepare("INSERT INTO releases(snapshot_json,note) VALUES(?,?)")
      .run(JSON.stringify(snapshot()), note).lastInsertRowid,
  );
}
async function jsonBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 15_000_000) throw new Error("Слишком большой запрос.");
  }
  return data ? JSON.parse(data) : {};
}

export async function workspaceRoute(req, res, url, { db, json, snapshot }) {
  const prefix = "/api/admin/workspace";
  if (!url.pathname.startsWith(prefix)) return false;
  const route = url.pathname.slice(prefix.length),
    method = req.method;
  const scope = crypto
    .createHash("sha256")
    .update(
      db
        .prepare("PRAGMA database_list")
        .all()
        .find((d) => d.name === "main")?.file || "main",
    )
    .digest("hex");
  try {
    if (route === "/image.png" && method === "GET") {
      await downloadImage(
        res,
        url.searchParams.get("fileUrl"),
        url.searchParams.get("name") || "План",
      );
      return true;
    }
    if (route === "/images/copy" && method === "POST") {
      const b = await jsonBody(req);
      json(res, 201, await copyImage(b.fileUrl));
      return true;
    }
    const replacePlan = route.match(
      /^\/batches\/([a-f0-9-]+)\/plans\/([a-f0-9-]+)\/image$/,
    );
    if (replacePlan && method === "PATCH") {
      const batch = batches.get(replacePlan[1]) || loadBatch(replacePlan[1]);
      if (!batch || batch.scope !== scope || batch.status !== "ready")
        throw new Error("Откройте подготовленный набор файлов.");
      const plan = batch.result.overlays.find(
        (o) => o.sourceFileId === replacePlan[2],
      );
      if (!plan) throw new Error("План не найден.");
      const b = await jsonBody(req);
      const image = await copyImage(b.fileUrl);
      plan.fileUrl = image.fileUrl;
      batches.set(batch.id, batch);
      persistBatch(batch);
      json(res, 200, batchInfo(batch));
      return true;
    }

    if (route === "/batches" && method === "GET") {
      const directories = await fsp.readdir(storage, { withFileTypes: true }),
        saved = [];
      for (const entry of directories.filter(
        (d) => d.isDirectory() && d.name.startsWith("batch-"),
      )) {
        const id = entry.name.slice(6),
          b = batches.get(id) || loadBatch(id);
        if (b?.scope === scope && b.status !== "applied")
          saved.push({
            id: b.id,
            status: b.status,
            created: b.created,
            files: b.files.length,
            summary: b.result?.summary,
          });
      }
      json(res, 200, saved.sort((a, b) => b.created - a.created).slice(0, 10));
      return true;
    }
    if (route === "" && method === "GET") {
      const current = snapshot(),
        latest = db
          .prepare(
            "SELECT snapshot_json FROM releases ORDER BY id DESC LIMIT 1",
          )
          .get();
      json(res, 200, {
        ...current,
        hasChanges: !latest || latest.snapshot_json !== JSON.stringify(current),
        revision: revision(db),
        records: db
          .prepare("SELECT * FROM records WHERE status='active' ORDER BY id")
          .all()
          .map(toRecord),
        releases: db
          .prepare(
            "SELECT id,created_at as createdAt,note FROM releases ORDER BY id DESC LIMIT 30",
          )
          .all(),
      });
      return true;
    }
    if (route === "/batches" && method === "POST") {
      const b = await jsonBody(req),
        id = crypto.randomUUID(),
        directory = path.join(storage, "batch-" + id);
      await fsp.mkdir(directory, { recursive: true });
      const batch = {
        id,
        scope,
        directory,
        files: [],
        status: "uploading",
        settlementName: String(b.settlementName || ""),
        baseRevision: revision(db),
        created: Date.now(),
      };
      batches.set(id, batch);
      persistBatch(batch);
      json(res, 201, { id });
      return true;
    }
    const bm = route.match(
      /^\/batches\/([a-f0-9-]+)(?:\/(files|analyze|apply))?$/,
    );
    if (bm) {
      const batch = batches.get(bm[1]) || loadBatch(bm[1]);
      if (!batch) {
        json(res, 404, { error: "Загрузка не найдена. Начните заново." });
        return true;
      }
      if (batch.scope && batch.scope !== scope) {
        json(res, 404, { error: "Набор не найден в этой мастерской." });
        return true;
      }
      if (!batch.scope) {
        batch.scope = scope;
        persistBatch(batch);
      }
      batches.set(batch.id, batch);
      const action = bm[2];
      if (!action && method === "GET") {
        json(res, 200, batchInfo(batch));
        return true;
      }
      if (action === "files" && method === "POST") {
        if (batch.status !== "uploading")
          throw new Error("Сначала вернитесь к списку файлов.");
        const name = decodeURIComponent(
          String(req.headers["x-file-name"] || ""),
        );
        if (name.includes("\0") || name.length > 1000)
          throw new Error("Некорректное имя файла.");
        await receiveFile(req, batch, name);
        json(res, 201, batchInfo(batch));
        return true;
      }
      if (action === "analyze" && method === "POST") {
        if (batch.status !== "uploading" || !batch.files.length)
          throw new Error("Сначала загрузите файлы.");
        const settings = await jsonBody(req);
        batch.settlementName = String(
          settings.settlementName ?? batch.settlementName,
        );
        batch.baseRevision = revision(db);
        batch.error = null;
        batch.result = null;
        batch.status = "analyzing";
        batch.progress = "Проверяем состав папки";
        persistBatch(batch);
        analyzeBundle(batch, (p) => {
          batch.progress = p;
        })
          .then((result) => {
            batch.result = result;
            batch.status = "ready";
            batch.progress = "Готово к добавлению";
            const edited = db
              .prepare(
                "SELECT settlement_id,num FROM records WHERE status='active' AND local_edit=1",
              )
              .all();
            result.conflicts = edited.filter((e) =>
              result.records.some(
                (r) => r.settlementId === e.settlement_id && r.num === e.num,
              ),
            );
            persistBatch(batch);
          })
          .catch((e) => {
            batch.status = "error";
            batch.error = e.message;
            persistBatch(batch);
          });
        json(res, 202, { ok: true });
        return true;
      }
      if (action === "apply" && method === "POST") {
        if (batch.status !== "ready")
          throw new Error("Дождитесь проверки файлов.");
        const b = await jsonBody(req);
        if (batch.baseRevision !== revision(db)) {
          json(res, 409, {
            error:
              "Данные изменились после проверки. Загрузите набор заново, чтобы увидеть актуальные изменения.",
          });
          return true;
        }
        const backupFile = backup(db),
          data = batch.result;
        const counts = txn(db, () => {
          for (const s of data.settlements)
            db.prepare(
              "INSERT INTO settlements(id,slug,name,color,bounds_json,active) VALUES(?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,bounds_json=excluded.bounds_json,active=1",
            ).run(s.id, s.id, s.name, s.color, JSON.stringify(s.bounds));
          let created = 0,
            updated = 0,
            kept = 0;
          const incoming = new Set(
            data.records.map((r) => r.settlementId + ":" + r.num),
          );
          if (b.mode === "replace")
            for (const s of data.settlements) {
              for (const r of db
                .prepare(
                  "SELECT id,num,local_edit FROM records WHERE settlement_id=? AND status='active'",
                )
                .all(s.id))
                if (
                  !incoming.has(s.id + ":" + r.num) &&
                  (!r.local_edit || b.overwrite)
                )
                  db.prepare(
                    "UPDATE records SET status='archived' WHERE id=?",
                  ).run(r.id);
            }
          for (const r of data.records) {
            const existing = db
              .prepare(
                "SELECT * FROM records WHERE settlement_id=? AND num=? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,id LIMIT 1",
              )
              .get(r.settlementId, r.num);
            if (
              existing?.status === "active" &&
              existing.local_edit &&
              !b.overwrite
            ) {
              kept++;
              continue;
            }
            const p = data.plots.find(
              (p) => p.recordKey === r.settlementId + ":" + r.num,
            );
            if (p) {
              const bounds = geometryBounds(p.geometry),
                lat = (bounds[0][0] + bounds[1][0]) / 2,
                lng = (bounds[0][1] + bounds[1][1]) / 2;
              db.prepare(
                "INSERT INTO plots(settlement_id,legacy_key,geometry_json,focus_lat,focus_lng,status) VALUES(?,?,?,?,?,'active') ON CONFLICT(settlement_id,legacy_key) DO UPDATE SET geometry_json=excluded.geometry_json,focus_lat=excluded.focus_lat,focus_lng=excluded.focus_lng,status='active'",
              ).run(
                r.settlementId,
                r.num,
                JSON.stringify(p.geometry),
                lat,
                lng,
              );
              r.plotId = db
                .prepare(
                  "SELECT id FROM plots WHERE settlement_id=? AND legacy_key=?",
                )
                .get(r.settlementId, r.num).id;
              r.lat = lat;
              r.lng = lng;
            }
            saveRecord(db, r, existing?.id, false);
            if (existing) updated++;
            else created++;
          }
          for (const settlement of data.settlements)
            db.prepare(
              "DELETE FROM workspace_warnings WHERE settlement_id=?",
            ).run(settlement.id);
          for (const w of data.warnings.filter(
            (w) => w.severity === "warning" && !w.recordNum,
          ))
            db.prepare(
              "INSERT INTO workspace_warnings(settlement_id,batch_id,message) VALUES(?,?,?)",
            ).run(data.settlements[0]?.id || null, batch.id, w.message);
          const planIds = new Set(
            b.planIds ||
              data.overlays
                .filter((o) => o.included !== false)
                .map((o) => o.sourceFileId),
          );
          for (const o of data.overlays.filter((o) =>
            planIds.has(o.sourceFileId),
          )) {
            const ex = db
              .prepare(
                "SELECT id FROM historical_overlays WHERE settlement_id=? AND name=?",
              )
              .get(o.settlementId, o.name);
            if (ex)
              db.prepare(
                "UPDATE historical_overlays SET file_url=?,bounds_json=?,visible=?,opacity=? WHERE id=?",
              ).run(
                o.fileUrl,
                JSON.stringify(o.bounds),
                Number(o.visible),
                o.opacity,
                ex.id,
              );
            else
              db.prepare(
                "INSERT INTO historical_overlays(file_url,settlement_id,name,bounds_json,visible,opacity,sort_order) VALUES(?,?,?,?,?,?,?)",
              ).run(
                o.fileUrl,
                o.settlementId,
                o.name,
                JSON.stringify(o.bounds),
                Number(o.visible),
                o.opacity,
                data.overlays.indexOf(o),
              );
          }
          return { created, updated, kept };
        });
        batch.status = "applied";
        persistBatch(batch);
        json(res, 200, { ok: true, ...counts, backup: backupFile });
        return true;
      }
    }
    const selection = route.match(/^\/batches\/([a-f0-9-]+)\/selection$/);
    if (selection && method === "PATCH") {
      const batch = batches.get(selection[1]) || loadBatch(selection[1]);
      if (!batch || batch.scope !== scope || batch.status !== "ready")
        throw new Error("Предпросмотр недоступен.");
      const body = await jsonBody(req),
        known = new Set(batch.result.overlays.map((o) => o.sourceFileId));
      batch.result.selectedPlanIds = Array.from(
        new Set(body.planIds || []),
      ).filter((id) => known.has(id));
      persistBatch(batch);
      batches.set(batch.id, batch);
      json(res, 200, { ok: true });
      return true;
    }
    const staged = route.match(
      /^\/batches\/([a-f0-9-]+)\/(files|plans)\/([a-f0-9-]+)$/,
    );
    if (staged && method === "DELETE") {
      const batch = batches.get(staged[1]) || loadBatch(staged[1]);
      if (
        !batch ||
        batch.scope !== scope ||
        ["analyzing", "applied"].includes(batch.status)
      )
        throw new Error("Этот набор сейчас нельзя изменить.");
      if (staged[2] === "plans" && batch.status !== "ready")
        throw new Error("План ещё не готов.");
      await removeFile(batch, staged[3]);
      if (staged[2] === "plans") {
        if (batch.status !== "ready") throw new Error("План ещё не готов.");
        batch.result.overlays = batch.result.overlays.filter(
          (o) => o.sourceFileId !== staged[3],
        );
        batch.result.summary.overlays = batch.result.overlays.length;
        if (batch.result.selectedPlanIds)
          batch.result.selectedPlanIds = batch.result.selectedPlanIds.filter(
            (id) => id !== staged[3],
          );
      } else {
        batch.status = "uploading";
        batch.result = null;
        batch.error = null;
      }
      persistBatch(batch);
      batches.set(batch.id, batch);
      json(res, 200, batchInfo(batch));
      return true;
    }
    const reopen = route.match(/^\/batches\/([a-f0-9-]+)\/reopen$/);
    if (reopen && method === "POST") {
      const batch = batches.get(reopen[1]) || loadBatch(reopen[1]);
      if (
        !batch ||
        batch.scope !== scope ||
        batch.status === "analyzing" ||
        batch.status === "applied"
      )
        throw new Error("Набор сейчас недоступен.");
      batch.status = "uploading";
      batch.result = null;
      batch.error = null;
      persistBatch(batch);
      batches.set(batch.id, batch);
      json(res, 200, batchInfo(batch));
      return true;
    }
    const warning = route.match(/^\/warnings\/(\d+)$/);
    if (warning && method === "PATCH") {
      db.prepare("UPDATE workspace_warnings SET resolved=1 WHERE id=?").run(
        Number(warning[1]),
      );
      json(res, 200, { ok: true });
      return true;
    }
    const rm = route.match(/^\/records(?:\/(\d+))?$/);
    if (rm && ["POST", "PATCH", "DELETE"].includes(method)) {
      const id = Number(rm[1]) || null;
      if (method === "DELETE") {
        if (!id) throw new Error("Не выбрана усадьба.");
        db.prepare(
          "UPDATE records SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(id);
        json(res, 200, { ok: true });
        return true;
      }
      const b = await jsonBody(req),
        old = id
          ? db.prepare("SELECT * FROM records WHERE id=?").get(id)
          : null;
      if (id && !old) {
        json(res, 404, { error: "Усадьба не найдена." });
        return true;
      }
      const r = { ...(old ? toRecord(old) : {}), ...b };
      r.issues = (r.issues || []).filter((issue) => {
        if (issue.field === "geometry" && b.geometry) return false;
        if (
          issue.field &&
          Object.hasOwn(b, issue.field) &&
          old &&
          String(b[issue.field] ?? "") !==
            String(toRecord(old)[issue.field] ?? "") &&
          String(b[issue.field] ?? "").trim() !== ""
        )
          return false;
        return true;
      });
      if (
        !String(r.num || "").trim() ||
        !db.prepare("SELECT id FROM settlements WHERE id=?").get(r.settlementId)
      )
        throw new Error("Укажите номер и поселение.");
      if (
        db
          .prepare(
            "SELECT id FROM records WHERE settlement_id=? AND num=? AND status='active' AND id<>?",
          )
          .get(r.settlementId, String(r.num), id || -1)
      )
        throw new Error("Такой номер уже есть в этом поселении.");
      for (const k of ["lat", "lng", "area_sazh"]) {
        r[k] = r[k] == null || r[k] === "" ? null : Number(r[k]);
        if (r[k] != null && !Number.isFinite(r[k]))
          throw new Error("Проверьте площадь и положение на карте.");
      }
      if (
        (r.lat == null) !== (r.lng == null) ||
        (r.lat != null && (Math.abs(r.lat) > 90 || Math.abs(r.lng) > 180)) ||
        (r.area_sazh != null && r.area_sazh < 0)
      )
        throw new Error("Проверьте площадь и положение на карте.");
      const saved = txn(db, () => {
        if (b.geometry) {
          validateGeometry(b.geometry);
          const bounds = geometryBounds(b.geometry);
          r.lat = (bounds[0][0] + bounds[1][0]) / 2;
          r.lng = (bounds[0][1] + bounds[1][1]) / 2;
          if (old?.plot_id)
            db.prepare(
              "UPDATE plots SET geometry_json=?,focus_lat=?,focus_lng=? WHERE id=?",
            ).run(JSON.stringify(b.geometry), r.lat, r.lng, old.plot_id);
          else {
            const ex = db
              .prepare(
                "SELECT id FROM plots WHERE settlement_id=? AND legacy_key=?",
              )
              .get(r.settlementId, r.num);
            if (ex) {
              r.plotId = ex.id;
              db.prepare(
                "UPDATE plots SET geometry_json=?,focus_lat=?,focus_lng=?,status='active' WHERE id=?",
              ).run(JSON.stringify(b.geometry), r.lat, r.lng, ex.id);
            } else
              r.plotId = Number(
                db
                  .prepare(
                    "INSERT INTO plots(settlement_id,legacy_key,geometry_json,focus_lat,focus_lng) VALUES(?,?,?,?,?)",
                  )
                  .run(
                    r.settlementId,
                    r.num,
                    JSON.stringify(b.geometry),
                    r.lat,
                    r.lng,
                  ).lastInsertRowid,
              );
          }
        }
        return saveRecord(db, r, id, true);
      });
      json(res, 200, { id: saved });
      return true;
    }
    const om = route.match(/^\/overlays(?:\/(\d+))?$/);
    if (om && ["POST", "PATCH", "DELETE"].includes(method)) {
      const id = Number(om[1]) || null;
      if (method === "DELETE") {
        db.prepare("DELETE FROM historical_overlays WHERE id=?").run(id);
        json(res, 200, { ok: true });
        return true;
      }
      const b = await jsonBody(req),
        old = id
          ? db.prepare("SELECT * FROM historical_overlays WHERE id=?").get(id)
          : null;
      if (id && !old) throw new Error("Карта не найдена.");
      const bounds = b.bounds || (old ? JSON.parse(old.bounds_json) : null),
        crop = b.crop || (old ? JSON.parse(old.crop_json) : [0, 0, 0, 0]),
        rotation = Number(b.rotation ?? old?.rotation ?? 0),
        opacity = Number(b.opacity ?? old?.opacity ?? 0.75);
      if (
        !bounds ||
        bounds.length !== 2 ||
        bounds.some(
          (p) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            !p.every(Number.isFinite) ||
            Math.abs(p[0]) > 90 ||
            Math.abs(p[1]) > 180,
        ) ||
        bounds[0][0] >= bounds[1][0] ||
        bounds[0][1] >= bounds[1][1]
      )
        throw new Error("Некорректное размещение карты.");
      if (
        !Number.isFinite(rotation) ||
        opacity < 0 ||
        opacity > 1 ||
        !Number.isFinite(opacity) ||
        crop.length !== 4 ||
        !crop.every(Number.isFinite) ||
        crop.some((v) => v < 0 || v > 1) ||
        crop[0] + crop[2] >= 1 ||
        crop[1] + crop[3] >= 1
      )
        throw new Error("Проверьте размер, обрезку и прозрачность.");
      const name = String(b.name ?? old?.name ?? "Старая карта"),
        fileUrl = b.fileUrl || old?.file_url;
      await imagePath(fileUrl);
      const values = [
        name,
        fileUrl,
        JSON.stringify(bounds),
        opacity,
        Number(b.visible ?? Boolean(old?.visible ?? true)),
        rotation,
        JSON.stringify(crop),
      ];
      if (id)
        db.prepare(
          "UPDATE historical_overlays SET name=?,file_url=?,bounds_json=?,opacity=?,visible=?,rotation=?,crop_json=? WHERE id=?",
        ).run(...values, id);
      else {
        const out = db
          .prepare(
            "INSERT INTO historical_overlays(name,file_url,bounds_json,opacity,visible,rotation,crop_json) VALUES(?,?,?,?,?,?,?)",
          )
          .run(...values);
        json(res, 201, { id: Number(out.lastInsertRowid) });
        return true;
      }
      json(res, 200, { id });
      return true;
    }
    if (route === "/image" && method === "POST") {
      const id = crypto.randomUUID(),
        directory = path.join(storage, "images");
      await fsp.mkdir(directory, { recursive: true });
      const temp = path.join(directory, id + ".input");
      let imageInfo, format;
      try {
        await pipeline(req, fs.createWriteStream(temp));
        const metadata = await sharp(temp, {
          limitInputPixels: 150_000_000,
        }).metadata();
        if (!["png", "jpeg", "webp"].includes(metadata.format))
          throw new Error("Выберите PNG, JPG или WebP.");
        format = metadata.format === "png" ? "png" : "webp";
        let image = sharp(temp, { limitInputPixels: 150_000_000 }).rotate();
        // Keep the canvas and pixel dimensions intact for precisely registered replacements.
        image = format === "png" ? image.png() : image.webp({ quality: 95 });
        imageInfo = await image.toFile(path.join(directory, id + "." + format));
      } finally {
        await fsp.unlink(temp).catch(() => {});
      }
      json(res, 201, {
        fileUrl: "/data/uploads/images/" + id + "." + format,
        width: imageInfo.width,
        height: imageInfo.height,
        format,
      });
      return true;
    }
    if (route === "/reset" && method === "POST") {
      const file = backup(db);
      txn(db, () => {
        db.exec(
          "UPDATE records SET status='archived'; UPDATE plots SET status='archived'; DELETE FROM historical_overlays; DELETE FROM historical_features; DELETE FROM workspace_warnings;",
        );
        publish(db, snapshot, "Чистая карта перед загрузкой нового набора");
      });
      json(res, 200, { ok: true, backup: file });
      return true;
    }
    if (route === "/publish" && method === "POST") {
      const b = await jsonBody(req);
      json(res, 201, {
        id: publish(
          db,
          snapshot,
          String(b.note || "Публикация из мастерской карты"),
        ),
      });
      return true;
    }
    const restore = route.match(/^\/restore\/(\d+)$/);
    if (restore && method === "POST") {
      const release = db
        .prepare("SELECT * FROM releases WHERE id=?")
        .get(Number(restore[1]));
      if (!release) throw new Error("Версия не найдена.");
      const data = JSON.parse(release.snapshot_json),
        file = backup(db);
      txn(db, () => {
        db.exec(
          "UPDATE records SET status='archived';UPDATE plots SET status='archived';DELETE FROM historical_overlays;DELETE FROM historical_features;DELETE FROM workspace_warnings;",
        );
        for (const s of data.settlements)
          db.prepare(
            "INSERT INTO settlements(id,slug,name,color,bounds_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=1,bounds_json=excluded.bounds_json",
          ).run(
            s.id,
            s.slug || s.id,
            s.name,
            s.color,
            JSON.stringify(s.bounds),
          );
        for (const p of data.plots)
          db.prepare(
            "INSERT INTO plots(id,settlement_id,legacy_key,geometry_json,focus_lat,focus_lng) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET geometry_json=excluded.geometry_json,focus_lat=excluded.focus_lat,focus_lng=excluded.focus_lng,status='active'",
          ).run(
            p.id,
            p.settlementId,
            p.legacyKey,
            JSON.stringify(p.geometry),
            p.focusLat,
            p.focusLng,
          );
        for (const r of data.records) {
          if (!db.prepare("SELECT id FROM records WHERE id=?").get(r.id))
            db.prepare(
              "INSERT INTO records(id,num,settlement_id) VALUES(?,?,?)",
            ).run(r.id, r.num, r.settlementId);
          saveRecord(db, r, r.id, Boolean(r.localEdit));
        }
        for (const o of data.overlays || [])
          db.prepare(
            "INSERT INTO historical_overlays(file_url,settlement_id,name,bounds_json,opacity,visible,sort_order,rotation,crop_json) VALUES(?,?,?,?,?,?,?,?,?)",
          ).run(
            o.fileUrl,
            o.settlementId ?? null,
            o.name,
            JSON.stringify(o.bounds),
            o.opacity,
            Number(o.visible),
            o.sortOrder || 0,
            o.rotation || 0,
            JSON.stringify(o.crop || [0, 0, 0, 0]),
          );
        for (const f of data.historicalFeatures || [])
          db.prepare(
            "INSERT INTO historical_features(type,name,geometry_json,visible,sort_order) VALUES(?,?,?,?,?)",
          ).run(
            f.type,
            f.name,
            JSON.stringify(f.geometry),
            Number(f.visible),
            f.sortOrder || 0,
          );
        for (const warning of data.warnings || [])
          db.prepare(
            "INSERT INTO workspace_warnings(settlement_id,batch_id,message) VALUES(?,?,?)",
          ).run(warning.settlementId || null, "restore", warning.message);
        publish(db, snapshot, "Восстановлена версия №" + release.id);
      });
      json(res, 200, { ok: true, backup: file });
      return true;
    }
    json(res, 404, { error: "Действие не найдено." });
    return true;
  } catch (e) {
    console.error("Workspace:", e.message);
    if (res.headersSent) res.destroy();
    else
      json(res, 422, { error: e.message || "Не удалось выполнить действие." });
    return true;
  }
}
