import defaults from "./site-defaults.json" with { type: "json" };

export const filterFields = ["settlement", "num", "street", "buildingType", "surname",
  "name", "patronymic", "soslovie", "familyStatus", "sex", "serviceType", "rank",
  "position", "servicePlace", "registrationPlace"];
const tableFields = [...filterFields, "owner", "area_sazh", "source", "scanUrl",
  "notes", "extra", "sourceData", "lat", "lng", "id"];
const glossaryIcons = [
  ["book", "Книга"],
  ["people", "Люди", "Сословно-профессиональные группы"],
  ["map", "Карта", "Городская среда и топонимика"],
  ["factory", "Завод", "Производство"],
  ["medal", "Медаль", "Чины"],
  ["ruler", "Линейка", "Метрология"],
  ["landmark", "Учреждение", "Учреждения"],
  ["briefcase", "Ремесло", "Занятия"],
  ["document", "Документ", "Документы"],
  ["house", "Дом"], ["pin", "Метка"], ["bridge", "Мост"],
  ["coins", "Монеты"], ["tools", "Инструменты"], ["tree", "Дерево"],
].map(([id, label, category]) => ({ id, label, category }));

function validGlossaryIcon(icon) {
  if (icon == null || icon === "" || icon === "none" || glossaryIcons.some(item => item.id === icon)) return true;
  if (typeof icon !== "string" || icon.length > 56_000 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(icon)) return false;
  const bytes = Buffer.from(icon.slice("data:image/png;base64,".length), "base64");
  return bytes.length >= 45 &&
    bytes.subarray(0, 16).equals(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")) &&
    bytes.readUInt32BE(16) === 96 && bytes.readUInt32BE(20) === 96 &&
    bytes.subarray(-12, -4).equals(Buffer.from("0000000049454e44", "hex"));
}

function initialGlossary(legacy = []) {
  const terms = new Map(defaults.glossary.map(row => [row.term, row]));
  for (const row of legacy) {
    const original = terms.get(row.term);
    terms.set(row.term, {
      ...row,
      filterKey: row.filterValue ? row.filterKey : original?.filterKey || "",
      filterValue: row.filterValue || original?.filterValue || "",
    });
  }
  return [...terms.values()];
}

export function siteConfiguration(snapshot) {
  const content = snapshot.content || {};
  return {
    glossary: content.glossary ?? initialGlossary(snapshot.glossary),
    glossaryIcons,
    filters: content.filters ?? defaults.filters,
    areaFilter: content.areaFilter ?? defaults.areaFilter,
    areaFilterTitle: content.areaFilterTitle ?? "Площадь усадьбы",
    tableFilters: content.tableFilters ?? tableFields,
    tableFields,
    texts: { ...defaults.texts, ...content.texts },
    filterFields,
  };
}

export function saveSiteContent(db, key, value) {
  db.prepare("INSERT INTO site_content(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json")
    .run(key, JSON.stringify(value));
}

export function validateSiteSection(section, value) {
  const validText = (item) => typeof item === "string" && item.length <= 12000;
  const strings = (items) => Array.isArray(items) && items.every(validText);
  const name = (item) => validText(item) && item.trim().length > 0;
  const unique = (items) => new Set(items).size === items.length;
  switch (section) {
    case "glossary":
      if (Array.isArray(value) && value.some(row => row && !validGlossaryIcon(row.icon)))
        throw new Error("Глоссарий. Выберите значок из набора или загрузите изображение через редактор.");
      if (Array.isArray(value) && value.every((row) => row &&
        name(row.term) && name(row.category) && name(row.description) && strings(row.aliases) &&
        ((!row.filterKey && !row.filterValue) || (filterFields.includes(row.filterKey) && (name(row.filterValue) || (strings(row.filterValue) && row.filterValue.length > 0 && row.filterValue.every(name)))))) &&
        unique(value.map(row => row.term.trim().toLocaleLowerCase("ru")))) return value;
      break;
    case "filters":
      if (Array.isArray(value) && value.every((row) => row && filterFields.includes(row.key) &&
        name(row.title) && ["alpha", "count"].includes(row.sort) &&
        Number.isInteger(row.limit) && row.limit >= 0 && row.limit <= 1000 &&
        typeof row.inline === "boolean" && strings(row.hiddenValues)) &&
        unique(value.map(row => row.key))) return value;
      break;
    case "areaFilter":
      if (typeof value === "boolean") return value;
      break;
    case "areaFilterTitle":
      if (name(value)) return value.trim();
      break;
    case "tableFilters":
      if (strings(value) && unique(value) && value.every(key => tableFields.includes(key))) return value;
      break;
    case "texts":
      if (value && Object.keys(defaults.texts).every(key => validText(value[key])))
        return Object.fromEntries(Object.keys(defaults.texts).map(key => [key, value[key]]));
      break;
  }
  throw new Error("Проверьте обязательные поля, настройки и отсутствие повторов.");
}
