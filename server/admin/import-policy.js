export function fileKind(name) {
  const extension = String(name).split(".").pop().toLowerCase();
  if (["xlsx", "xls", "csv"].includes(extension))
    return { kind: "table", label: "Таблица усадеб" };
  if (["shp", "dbf", "prj", "cpg", "shx"].includes(extension))
    return { kind: "shape", label: "Комплект контуров" };
  if (extension === "qgz") return { kind: "project", label: "Проект QGIS" };
  if (["tif", "tiff"].includes(extension))
    return { kind: "raster", label: "План с привязкой" };
  if (["jpg", "jpeg", "png", "webp"].includes(extension))
    return { kind: "image", label: "Изображение · размещение вручную" };
  if (extension === "zip") return { kind: "archive", label: "Архив файлов" };
  return null;
}
export function ignoredReason(name) {
  if (/\.(aux\.xml|points|vrt|shx\.xml)$/i.test(name))
    return "Служебный файл: этот загрузчик его не использует";
  if (/\.gpkg$/i.test(name))
    return "GeoPackage пока не поддерживается. Используйте комплект SHP";
  return "Этот формат загрузчик не обрабатывает";
}
