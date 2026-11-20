import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  readWorkbook,
  readShapes,
  validateGeometry,
} from "../server/ingest.js";

function workbook(rows, name = "Уктус") {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}
const headers = [
  "№ Усадьбы",
  "Фамилия владельца",
  "Площадь (кв. саж.)",
  "Примечание ",
  "Источник",
  "Чин (для жен и вдов - чин супруга)",
  "Фамилия супруга (если указано)",
];
test("import preserves textual estate identifiers, sources, notes, and extra columns", () => {
  const result = readWorkbook(
    workbook([
      headers,
      ["747a", "Иванов", "180,5", "Заметка", "Архив", "Советник", "Петров"],
    ]),
  );
  assert.equal(result.records[0].num, "747a");
  assert.equal(result.records[0].area_sazh, 180.5);
  assert.equal(result.records[0].source, "Архив");
  assert.equal(result.records[0].notes, "Заметка");
  assert.equal(result.records[0].rank, "Советник");
  assert.equal(
    result.records[0].extra["Фамилия супруга (если указано)"],
    "Петров",
  );
  assert.equal(result.records[0].settlementId, "uktus");
  assert.equal(result.records[0].sex, "Не определено");
});
test("source row join key is distinct from estate number", () => {
  const r = readWorkbook(
    workbook(
      [
        ["№ усадьбы", "Порядковый номер строки в таблице"],
        ["747a", 748],
      ],
      "Екатеринбург",
    ),
  ).records[0];
  assert.equal(r.num, "747a");
  assert.equal(r.sourceKey, "748");
});
test("row errors preserve all rows, source values, and actionable warnings", () => {
  const result = readWorkbook(
    workbook([
      headers,
      [1, "a", 12],
      [1, "b", 13],
      [716, "Зырянов", "166,(6)"],
      [null, "Без номера", 50],
    ]),
  );
  assert.equal(result.records.length, 4);
  assert.equal(result.records[0].num, "1");
  assert.match(result.records[1].num, /дубликат/);
  assert.equal(result.records[2].num, "716");
  assert.equal(result.records[2].area_sazh, null);
  assert.equal(result.records[2].sourceData["Площадь (кв. саж.)"], "166,(6)");
  assert.equal(result.records[2].issues[0].field, "area_sazh");
  assert.equal(result.records[3].issues[0].field, "num");
  assert.equal(result.warnings.length, 3);
});
test("unrelated sheets are skipped and numeric zero remains zero", () => {
  const result = readWorkbook(workbook([headers, [1, "a", 0]]));
  assert.equal(result.records[0].area_sazh, 0);
  assert.throws(
    () => readWorkbook(workbook([["Заметки"], ["Текст"]])),
    /не найден/,
  );
});
test("geometry validation supports holes and multiple parts, rejects open rings", () => {
  const ring = [
    [60, 56],
    [60, 57],
    [61, 57],
    [60, 56],
  ];
  validateGeometry({ type: "Polygon", coordinates: [ring] });
  validateGeometry({ type: "MultiPolygon", coordinates: [[ring], [ring]] });
  assert.throws(
    () =>
      validateGeometry({ type: "Polygon", coordinates: [ring.slice(0, -1)] }),
    /вершин/,
  );
  assert.throws(
    () =>
      validateGeometry({
        type: "Polygon",
        coordinates: [
          [
            [60, 56],
            [60, 57],
            [61, 57],
            [61, 56],
          ],
        ],
      }),
    /замкнут/,
  );
  assert.throws(
    () =>
      validateGeometry({
        type: "Polygon",
        coordinates: [
          [
            [260, 56],
            [60, 57],
            [61, 57],
            [260, 56],
          ],
        ],
      }),
    /координаты/,
  );
});
test("corrupt SHP is rejected", () =>
  assert.throws(() => readShapes(Buffer.alloc(20), [], ""), /SHP/));

test("a damaged shape does not discard valid contours before or after it", () => {
  const ring = [
    [60, 56],
    [60, 57],
    [61, 57],
    [61, 56],
    [60, 56],
  ];
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  const records = [
    ring,
    ring.map((p, i) => (i === 2 ? [NaN, 57] : p)),
    ring,
  ].map((r, i) => {
    const content = Buffer.alloc(48 + r.length * 16);
    content.writeInt32LE(5, 0);
    content.writeInt32LE(1, 36);
    content.writeInt32LE(r.length, 40);
    content.writeInt32LE(0, 44);
    r.forEach((p, j) => {
      content.writeDoubleLE(p[0], 48 + j * 16);
      content.writeDoubleLE(p[1], 56 + j * 16);
    });
    const meta = Buffer.alloc(8);
    meta.writeInt32BE(i + 1, 0);
    meta.writeInt32BE(content.length / 2, 4);
    return Buffer.concat([meta, content]);
  });
  const buffer = Buffer.concat([header, ...records]),
    attributes = [{ id: "1" }, { id: "2" }, { id: "3" }];
  assert.throws(
    () => readShapes(buffer, attributes, "EPSG:4326"),
    /Координаты/,
  );
  const result = readShapes(buffer, attributes, "EPSG:4326", {
    tolerant: true,
  });
  assert.ok(result[0].geometry);
  assert.equal(result[1].geometry, null);
  assert.ok(result[1].error);
  assert.ok(result[2].geometry);
});
