import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import proj4 from "proj4";
import { fromFile } from "geotiff";
import sharp from "sharp";
// Release Windows file handles after raster preparation so staged plans can be deleted.
sharp.cache({ files: 0 });

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: false,
});
const array = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const clean = (x) =>
  String(x ?? "")
    .trim()
    .replace(/\s+/g, " ");
const key = (x) => clean(x).toLowerCase().replace(/ё/g, "е");
const number = (x) =>
  x == null || clean(x) === "" ? null : Number(clean(x).replace(",", "."));
export const storage = path.resolve("data/uploads");
export const settlementInfo = (name) =>
  key(name).includes("уктус")
    ? { id: "uktus", name: "Уктус", color: "#9A7AB0" }
    : key(name).includes("нижне-исет")
      ? { id: "ni", name: "Нижне-Исетск", color: "#7A9AB0" }
      : key(name).includes("екатеринбург")
        ? { id: "ekb", name: "Екатеринбург", color: "#C49A5C" }
        : null;

function fieldName(header) {
  const h = key(header);
  const exact = {
    num: "num",
    surname: "surname",
    name: "name",
    patronymic: "patronymic",
    street: "street",
    soslovie: "soslovie",
    sex: "sex",
    source: "source",
    scanurl: "scanUrl",
    area_sazh: "area_sazh",
    buildingtype: "buildingType",
    familystatus: "familyStatus",
    servicetype: "serviceType",
    rank: "rank",
    position: "position",
    serviceplace: "servicePlace",
    registrationplace: "registrationPlace",
    "порядковый номер строки в таблице": "sourceKey",
    примечание: "notes",
    пол: "sex",
    сажень: "area_sazh",
    "площадь (кв. саж.)": "area_sazh",
    источник: "source",
    скриншот: "scanUrl",
    ссылка: "scanUrl",
    ссылки: "scanUrl",
    "улица / район": "street",
    улица: "street",
    "сословно-профессиональная группа": "soslovie",
    сословие: "soslovie",
    "материал постройки": "buildingType",
    "обывательское / казенное строение": "buildingType",
    "тип постройки": "buildingType",
    "фамилия владельца": "surname",
    "имя владельца": "name",
    "отчество владельца": "patronymic",
    фамилия: "surname",
    имя: "name",
    отчество: "patronymic",
    "место приписки": "registrationPlace",
  };
  if (exact[h]) return exact[h];
  if (/^(№\s*усадьбы|номер усадьбы|номер)$/.test(h)) return "num";
  if (h.startsWith("семейное положение")) return "familyStatus";
  if (h.startsWith("принадлежность к службе")) return "serviceType";
  if (h === "чин" || h.startsWith("чин (")) return "rank";
  if (h.startsWith("должность / род занятий")) return "position";
  if (h.startsWith("место службы")) return "servicePlace";
  return null;
}

export function readWorkbook(buffer, fallback) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const records = [],
    settlements = new Map(),
    warnings = [];
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      defval: null,
      raw: true,
    });
    const hi = rows.findIndex((row) => row.some((v) => fieldName(v) === "num"));
    if (hi < 0) continue;
    const headers = rows[hi],
      settlement = settlementInfo(name) ||
        settlementInfo(fallback) || {
          id: "s-" + Buffer.from(name).toString("hex").slice(0, 24),
          name: clean(fallback || name),
          color: "#4d7866",
        };
    settlements.set(settlement.id, settlement);
    const seen = new Set();
    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.some((v) => v !== null && v !== "")) continue;
      const out = {
        settlementId: settlement.id,
        extra: {},
        sourceData: {},
        sourceRow: i + 1,
        issues: [],
      };
      headers.forEach((h, j) => {
        const v = row[j];
        if (v == null || v === "") return;
        const label = clean(h) || `Столбец ${j + 1}`;
        out.sourceData[label] = v;
        const k = fieldName(h);
        if (k) out[k] = k === "area_sazh" ? number(v) : clean(v);
        else if (h) out.extra[label] = v;
      });
      if (!out.num) {
        out.num = `Без номера · строка ${i + 1}`;
        out.issues.push({
          code: "missing_num",
          field: "num",
          message: `Строка ${i + 1}: укажите номер усадьбы.`,
        });
        warnings.push({
          severity: "warning",
          recordNum: out.num,
          message: `${name}, строка ${i + 1}: нет номера усадьбы. Строка сохранена для исправления.`,
        });
      }
      if (seen.has(out.num)) {
        const original = out.num;
        out.num = `${original} · дубликат, строка ${i + 1}`;
        out.issues.push({
          code: "duplicate_num",
          field: "num",
          message: `Номер ${original} повторяется. Уточните номер этой строки.`,
          sourceValue: original,
        });
        warnings.push({
          severity: "warning",
          recordNum: out.num,
          message: `${name}: повтор номера ${original}. Обе строки сохранены отдельно.`,
        });
      }
      seen.add(out.num);
      if (
        out.area_sazh != null &&
        (!Number.isFinite(out.area_sazh) || out.area_sazh < 0)
      ) {
        const sourceValue = Object.entries(out.sourceData).find(
          ([h]) => fieldName(h) === "area_sazh",
        )?.[1];
        const message = `Усадьба ${out.num}: площадь «${sourceValue}» требует проверки. Исходное значение сохранено.`;
        out.issues.push({
          code: "invalid_area",
          field: "area_sazh",
          message,
          sourceValue,
        });
        warnings.push({ severity: "warning", recordNum: out.num, message });
        out.area_sazh = null;
      }
      out.sourceKey = out.sourceKey || out.num;
      if (!out.sex) out.sex = "Не определено";
      records.push(out);
    }
  }
  if (!records.length)
    throw new Error("В таблице не найден столбец «№ усадьбы» с данными.");
  return { records, settlements: [...settlements.values()], warnings };
}

function dbfRows(buffer, encoding = "utf-8") {
  const count = buffer.readUInt32LE(4),
    header = buffer.readUInt16LE(8),
    size = buffer.readUInt16LE(10),
    fields = [];
  if (!size || header + count * size > buffer.length)
    throw new Error("Повреждён файл DBF.");
  let decoder;
  try {
    decoder = new TextDecoder(
      encoding.trim() === "1251" ? "windows-1251" : encoding.trim(),
    );
  } catch {
    decoder = new TextDecoder("windows-1251");
  }
  for (let p = 32; p < header - 1 && buffer[p] !== 13; p += 32) {
    fields.push({
      name: decoder.decode(buffer.subarray(p, p + 11)).split("\0")[0],
      size: buffer[p + 16],
    });
  }
  return Array.from({ length: count }, (_, i) => {
    let p = header + i * size + 1;
    const row = { __deleted: buffer[p - 1] === 42 };
    for (const f of fields) {
      row[f.name] = decoder.decode(buffer.subarray(p, p + f.size)).trim();
      p += f.size;
    }
    return row;
  });
}

function signedArea(ring) {
  return (
    ring.reduce((s, p, i) => {
      const q = ring[(i + 1) % ring.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2
  );
}
function contains(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function readShapes(
  buffer,
  attributes,
  projection,
  { tolerant = false } = {},
) {
  if (buffer.length < 100 || buffer.readInt32BE(0) !== 9994)
    throw new Error("Некорректный SHP.");
  let transform;
  try {
    transform = proj4(projection, "EPSG:4326");
  } catch {
    throw new Error("Не удалось распознать систему координат PRJ.");
  }
  const result = [];
  let p = 100,
    i = 0;
  while (p + 8 <= buffer.length) {
    const length = buffer.readInt32BE(p + 4) * 2,
      start = p + 8,
      end = start + length;
    if (end > buffer.length || length < 4) {
      if (!tolerant) throw new Error("Повреждён SHP.");
      result.push({
        row: attributes[i],
        geometry: null,
        error: "Объект SHP повреждён. Прочитанные ранее контуры сохранены.",
      });
      break;
    }
    const type = buffer.readInt32LE(start),
      row = attributes[i++];
    p = end;
    if (!row || row.__deleted || type === 0) {
      result.push({ row, geometry: null });
      continue;
    }
    try {
      if (![5, 15, 25].includes(type))
        throw new Error("Для усадеб нужен слой полигонов SHP.");
      const parts = buffer.readInt32LE(start + 36),
        points = buffer.readInt32LE(start + 40),
        base = start + 44 + 4 * parts;
      if (parts < 1 || points < 4 || base + 16 * points > end)
        throw new Error("Повреждён контур в SHP.");
      const starts = Array.from({ length: parts }, (_, j) =>
        buffer.readInt32LE(start + 44 + 4 * j),
      );
      starts.push(points);
      const rings = starts.slice(0, -1).map((a, j) =>
        Array.from({ length: starts[j + 1] - a }, (_, k) => {
          const original = [
            buffer.readDoubleLE(base + 16 * (a + k)),
            buffer.readDoubleLE(base + 16 * (a + k) + 8),
          ];
          if (!original.every(Number.isFinite))
            throw new Error(
              "Координаты контура должны быть конечными числами.",
            );
          const q = transform.forward(original);
          if (
            !q.every(Number.isFinite) ||
            Math.abs(q[0]) > 180 ||
            Math.abs(q[1]) > 90
          )
            throw new Error("Координаты контура за пределами карты.");
          return q;
        }),
      );
      const outers = rings.filter((r) => signedArea(r) < 0).map((r) => [r]),
        holes = rings.filter((r) => signedArea(r) >= 0);
      if (!outers.length) outers.push([holes.shift()]);
      for (const hole of holes) {
        const parent = outers.find((o) => contains(o[0], hole[0]));
        if (parent) parent.push(hole);
        else outers.push([hole]);
      }
      const geometry =
        outers.length === 1
          ? { type: "Polygon", coordinates: outers[0] }
          : { type: "MultiPolygon", coordinates: outers };
      validateGeometry(geometry);
      result.push({ row, geometry });
    } catch (error) {
      if (!tolerant) throw error;
      result.push({ row, geometry: null, error: error.message });
    }
  }
  if (i !== attributes.length) {
    if (!tolerant)
      throw new Error("Количество объектов в SHP и DBF не совпадает.");
    result.push({
      geometry: null,
      error: "Количество объектов в SHP и DBF не совпадает.",
    });
  }
  return result;
}
export function geometryPoints(g) {
  return g.type === "Polygon" ? g.coordinates.flat() : g.coordinates.flat(2);
}
export function geometryBounds(g) {
  const points = geometryPoints(g);
  return [
    [
      Math.min(...points.map((p) => p[1])),
      Math.min(...points.map((p) => p[0])),
    ],
    [
      Math.max(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
    ],
  ];
}
export function validateGeometry(g) {
  if (!g || !["Polygon", "MultiPolygon"].includes(g.type))
    throw new Error("Нужен контур участка.");
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  if (!Array.isArray(polys) || !polys.length) throw new Error("Контур пуст.");
  for (const poly of polys) {
    if (!Array.isArray(poly) || !poly.length) throw new Error("Контур пуст.");
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 4)
        throw new Error("Укажите минимум три вершины.");
      for (const p of ring)
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          !p.every(Number.isFinite) ||
          Math.abs(p[0]) > 180 ||
          Math.abs(p[1]) > 90
        )
          throw new Error("Некорректные координаты контура.");
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
        throw new Error("Контур не замкнут.");
    }
  }
}

async function projectMetadata(file) {
  const zipped = unzipSync(await fs.readFile(file.disk), {
    filter: (f) => /\.qgs$/i.test(f.name) && f.originalSize < 20 * 1024 * 1024,
  });
  const qgs = Object.values(zipped)[0];
  if (!qgs) throw new Error("В QGZ нет описания проекта.");
  const root = xml.parse(new TextDecoder().decode(qgs)).qgis;
  const layers = array(root?.projectlayers?.maplayer);
  const visibility = new Map();
  function walk(node) {
    for (const l of array(node?.["layer-tree-layer"]))
      visibility.set(String(l.id), l.checked === "Qt::Checked");
    for (const group of array(node?.["layer-tree-group"])) walk(group);
  }
  walk(root);
  return {
    layers,
    rasters: layers
      .filter((l) => l.type === "raster" && l.provider === "gdal")
      .map((l) => ({
        name: path.posix.basename(String(l.datasource).replace(/\\/g, "/")),
        visible: visibility.get(String(l.id)) ?? true,
      })),
  };
}

export async function prepareRaster(file, directory) {
  let tif;
  try {
    tif = await fromFile(file.disk);
    const image = await tif.getImage();
    const fd = image.fileDirectory,
      keys = image.getGeoKeys();
    const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey;
    if (!epsg || epsg === 32767)
      throw new Error("Не определена система координат изображения.");
    const bbox = image.getBoundingBox(),
      source = `EPSG:${epsg}`;
    // Existing files are north-up; arbitrary rotations need raster reprojection, never a silent bounding-box stretch.
    if (
      fd.ModelTransformation &&
      (fd.ModelTransformation[1] !== 0 || fd.ModelTransformation[4] !== 0)
    )
      throw new Error(
        "Поворот георастра требует предварительного преобразования в QGIS.",
      );
    if (![3857, 4326].includes(epsg))
      throw new Error(
        `Система EPSG:${epsg}: сначала экспортируйте георастр в EPSG:3857 или EPSG:4326.`,
      );
    const sw = proj4(source, "EPSG:4326", [bbox[0], bbox[1]]),
      ne = proj4(source, "EPSG:4326", [bbox[2], bbox[3]]);
    const name = path.basename(file.name).replace(/\.(tif|tiff)$/i, "");
    const output = path.join(directory, file.id + "-preview.webp");
    const { data, info } = await sharp(file.disk, {
      limitInputPixels: 500_000_000,
    })
      .resize({
        width: 4096,
        height: 4096,
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Keep the complete image and all its margins. Cropping is an explicit editor action.
    await sharp(data, { raw: info }).webp({ quality: 88 }).toFile(output);
    return {
      name,
      fileUrl:
        "/data/uploads/" +
        path.relative(storage, output).split(path.sep).join("/"),
      bounds: [
        [sw[1], sw[0]],
        [ne[1], ne[0]],
      ],
      opacity: 0.75,
      visible: true,
      rotation: 0,
      crop: [0, 0, 0, 0],
      sourceFile: file.name,
      sourceFileId: file.id,
      georeferenced: true,
      included: true,
    };
  } finally {
    if (tif) await tif.close();
  }
}

export async function analyzeBundle(batch, progress = () => {}) {
  const warnings = [],
    files = batch.files,
    byName = new Map(files.map((f) => [key(path.basename(f.name)), f]));
  const projects = [];
  const names = new Set();
  for (const file of files) {
    const name = key(path.basename(file.name));
    if (names.has(name))
      warnings.push({
        severity: "warning",
        message: `Несколько файлов «${path.basename(file.name)}»: проверьте комплект и соответствие контуров.`,
      });
    names.add(name);
  }
  for (const f of files.filter((f) => /\.qgz$/i.test(f.name))) {
    try {
      projects.push(await projectMetadata(f));
    } catch (e) {
      warnings.push({
        severity: "warning",
        message: `${f.name}: ${e.message}`,
      });
    }
  }
  const records = [],
    settlements = [];
  for (const f of files.filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name))) {
    progress("Читаем таблицу " + path.basename(f.name));
    let data;
    try {
      data = readWorkbook(await fs.readFile(f.disk), batch.settlementName);
    } catch (e) {
      warnings.push({
        severity: "warning",
        message: `Таблица ${f.name}: ${e.message}`,
      });
      continue;
    }
    records.push(...data.records);
    settlements.push(...data.settlements);
    warnings.push(...data.warnings);
  }
  if (
    !records.length &&
    !files.some((f) => /\.(tiff?|jpe?g|png|webp)$/i.test(f.name))
  )
    throw new Error(
      "Не удалось прочитать таблицы. Добавьте Excel/CSV с номерами усадеб или изображения планов. " +
        warnings.map((w) => w.message).join(" "),
    );
  const recordKeys = new Set();
  for (const r of records) {
    const k = r.settlementId + ":" + r.num;
    if (recordKeys.has(k)) {
      const original = r.num;
      let copy = 2;
      do {
        r.num = `${original} · повтор ${copy++}`;
      } while (recordKeys.has(r.settlementId + ":" + r.num));
      r.issues.push({
        code: "duplicate_num",
        field: "num",
        message: `Номер ${original} найден в нескольких таблицах. Проверьте повторную строку.`,
      });
      warnings.push({
        severity: "warning",
        recordNum: r.num,
        message: r.issues.at(-1).message,
      });
    }
    recordKeys.add(r.settlementId + ":" + r.num);
  }
  const plots = [],
    used = new Set();
  for (const file of files.filter((f) => /\.shp$/i.test(f.name))) {
    try {
      progress("Сопоставляем участки: " + path.basename(file.name));
      const stem = path.basename(file.name).replace(/\.shp$/i, "");
      const dbf = byName.get(key(stem + ".dbf")),
        prj = byName.get(key(stem + ".prj")),
        cpg = byName.get(key(stem + ".cpg"));
      if (!dbf || !prj)
        throw new Error(
          `Для «${stem}» нужны файлы .shp, .dbf и .prj из одного комплекта.`,
        );
      const shapeRows = dbfRows(
        await fs.readFile(dbf.disk),
        cpg ? await fs.readFile(cpg.disk, "utf8") : "windows-1251",
      );
      const shapes = readShapes(
        await fs.readFile(file.disk),
        shapeRows,
        await fs.readFile(prj.disk, "utf8"),
        { tolerant: true },
      );
      const layer = projects
        .flatMap((p) => p.layers)
        .find(
          (l) =>
            key(
              path.posix.basename(
                String(l.datasource).split("|")[0].replace(/\\/g, "/"),
              ),
            ) === key(stem + ".shp"),
        );
      const joins = array(layer?.vectorjoins?.join);
      const applicable = joins.find(
        (j) =>
          shapes.some((s) => s.row && j.targetFieldName in s.row) &&
          records.some((r) => j.joinFieldName in r.sourceData),
      );
      const field =
        applicable?.targetFieldName ||
        (shapeRows.some((r) => "LINE_NUM_1" in r) ? "LINE_NUM_1" : "id");
      const joinField = applicable?.joinFieldName;
      const sid =
        settlementInfo(stem)?.id ||
        (new Set(records.map((r) => r.settlementId)).size === 1
          ? records[0].settlementId
          : null);
      if (!sid)
        throw new Error(
          "Несколько поселений в одном наборе: загрузите папку каждого поселения отдельно.",
        );
      const index = new Map();
      for (const record of records.filter((r) => r.settlementId === sid)) {
        const value = clean(
          joinField
            ? record.sourceData[joinField]
            : field === "LINE_NUM_1"
              ? record.sourceKey
              : record.num,
        );
        if (index.has(value)) {
          index.set(value, null);
          warnings.push({
            severity: "warning",
            message: `${stem}: ключ связи «${value}» повторяется. Контур не присоединён автоматически — проверьте связь вручную.`,
          });
        } else index.set(value, record);
      }
      for (const [i, s] of shapes.entries()) {
        const match = index.get(clean(s.row?.[field]));
        if (!s.geometry) {
          warnings.push({
            severity: "warning",
            recordNum: match?.num,
            message: `${stem}, объект ${i + 1}: ${s.error || "пустой контур"}. Остальные данные загружены.`,
          });
          continue;
        }
        if (!match) {
          warnings.push({
            severity: "warning",
            message: `${stem}, объект ${i + 1}: нет строки таблицы для ключа «${s.row?.[field]}».`,
          });
          continue;
        }
        const mk = sid + ":" + match.num;
        if (used.has(mk)) {
          const existing = plots.find((p) => p.recordKey === mk);
          const a =
            existing.geometry.type === "Polygon"
              ? [existing.geometry.coordinates]
              : existing.geometry.coordinates;
          const b =
            s.geometry.type === "Polygon"
              ? [s.geometry.coordinates]
              : s.geometry.coordinates;
          existing.geometry = {
            type: "MultiPolygon",
            coordinates: [...a, ...b],
          };
          warnings.push({
            severity: "info",
            recordNum: match.num,
            message: `Усадьба ${match.num}: части участка объединены.`,
          });
        } else {
          plots.push({
            recordKey: mk,
            settlementId: sid,
            legacyKey: match.num,
            geometry: s.geometry,
          });
          used.add(mk);
        }
      }
    } catch (e) {
      warnings.push({
        severity: "warning",
        message: `Слой ${path.basename(file.name)}: ${e.message} Табличные записи сохранены, контуры можно добавить позже.`,
      });
    }
  }
  for (const r of records)
    if (!used.has(r.settlementId + ":" + r.num))
      warnings.push({
        severity: "warning",
        recordNum: r.num,
        message: `Усадьба ${r.num}: контур не найден. Вы сможете указать место на карте.`,
      });
  const overlays = [],
    projectRasters = new Map(
      projects.flatMap((p) => p.rasters).map((r) => [key(r.name), r.visible]),
    );
  const rasters = files.filter((f) =>
    /\.(tiff?|jpe?g|png|webp)$/i.test(f.name),
  );
  for (const [i, file] of rasters.entries()) {
    progress(
      `Готовим старые карты: ${i + 1} из ${rasters.length} — ${path.basename(file.name)}`,
    );
    try {
      let o;
      try {
        if (!/\.tiff?$/i.test(file.name))
          throw new Error("Изображение без геопривязки");
        o = await prepareRaster(file, batch.directory);
      } catch (error) {
        const output = path.join(batch.directory, file.id + "-preview.webp");
        await sharp(file.disk, { limitInputPixels: 500_000_000 })
          .rotate()
          .resize({
            width: 4096,
            height: 4096,
            fit: "inside",
            withoutEnlargement: true,
          })
          .ensureAlpha()
          .webp({ quality: 88 })
          .toFile(output);
        const imageInfo = await sharp(output).metadata();
        o = {
          name: path.basename(file.name).replace(/\.[^.]+$/, ""),
          fileUrl:
            "/data/uploads/" +
            path.relative(storage, output).split(path.sep).join("/"),
          bounds: [
            [56.8, 60.57],
            [56.86, 60.65],
          ],
          crop: [0, 0, 0, 0],
          opacity: 0.65,
          visible: false,
          georeferenced: false,
          sourceFile: file.name,
          sourceFileId: file.id,
          included: false,
          width: imageInfo.width,
          height: imageInfo.height,
          placementNote:
            "Нет геопривязки. Показано приблизительно; расположите изображение вручную.",
        };
      }
      if (o.georeferenced)
        o.visible = projectRasters.get(key(path.basename(file.name))) ?? true;
      o.settlementId = records[0]?.settlementId || null;
      overlays.push(o);
    } catch (e) {
      warnings.push({
        severity: "warning",
        message: `Карта «${path.basename(file.name)}» не добавлена: ${e.message}`,
      });
    }
  }
  if (!records.length && !overlays.length)
    throw new Error(
      "Не удалось прочитать данные из выбранных файлов. " +
        warnings.map((w) => w.message).join(" "),
    );
  const uniqueSettlements = [
    ...new Map(settlements.map((s) => [s.id, s])).values(),
  ];
  for (const s of uniqueSettlements) {
    const points = plots
      .filter((p) => p.settlementId === s.id)
      .flatMap((p) => geometryPoints(p.geometry));
    s.bounds = points.length
      ? [
          [
            Math.min(...points.map((p) => p[1])),
            Math.min(...points.map((p) => p[0])),
          ],
          [
            Math.max(...points.map((p) => p[1])),
            Math.max(...points.map((p) => p[0])),
          ],
        ]
      : null;
  }
  for (const o of overlays.filter((o) => !o.georeferenced)) {
    const b = uniqueSettlements.find((s) => s.bounds)?.bounds || o.bounds;
    const sw = proj4("EPSG:4326", "EPSG:3857", [b[0][1], b[0][0]]),
      ne = proj4("EPSG:4326", "EPSG:3857", [b[1][1], b[1][0]]);
    const cx = (sw[0] + ne[0]) / 2,
      cy = (sw[1] + ne[1]) / 2,
      dx = (ne[0] - sw[0]) * 0.35,
      dy = (dx * o.height) / o.width;
    const a = proj4("EPSG:3857", "EPSG:4326", [cx - dx, cy - dy]),
      z = proj4("EPSG:3857", "EPSG:4326", [cx + dx, cy + dy]);
    o.bounds = [
      [a[1], a[0]],
      [z[1], z[0]],
    ];
  }
  for (const r of records)
    for (const warning of warnings.filter(
      (w) => w.recordNum === r.num && w.severity === "warning",
    )) {
      if (
        !r.issues.some((i) => i.message === warning.message) &&
        !warning.message.includes("контур не найден")
      )
        r.issues.push({
          code: "import_warning",
          field: warning.message.includes("контур") ? "geometry" : undefined,
          message: warning.message,
        });
    }
  return {
    records,
    plots,
    overlays,
    settlements: uniqueSettlements,
    warnings,
    summary: {
      records: records.length,
      plots: plots.length,
      overlays: overlays.length,
      unmatched: records.length - used.size,
      files: files.length,
    },
    joinDescription: projects.length
      ? "Связи прочитаны из проекта QGIS; файлы найдены внутри загруженной папки."
      : "Контуры сопоставлены по номерам усадеб или ключам строк.",
  };
}
