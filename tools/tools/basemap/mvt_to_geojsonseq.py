#!/usr/bin/env python3
"""
Адаптер источника: каталог векторных тайлов OSM (MVT, один уровень зума)
-> GeoJSONSeq с целыми объектами OpenStreetMap (кусочки, разрезанные по
границам тайлов, склеиваются по OSM id).

Этим скриптом собиралась текущая подложка (источник: тайлы Apache Baremaps
из репозитория ekaterinburgdev/map-tiles, данные © участники OpenStreetMap,
ODbL). Если у вас есть обычная выгрузка OSM (.osm.pbf), этот шаг не нужен:

    osmium export ekaterinburg.osm.pbf -o ekb.geojsonseq -f geojsonseq

и затем сразу build_basemap.py.

Использование:
    python3 mvt_to_geojsonseq.py <tiles_dir> <zoom> <out.geojsonseq>

Зависимости: pip install mapbox-vector-tile shapely
"""
import gzip
import json
import math
import os
import sys
from collections import defaultdict

import mapbox_vector_tile as mvt
import numpy as np
import shapely
from shapely import clip_by_rect, line_merge, unary_union
from shapely.geometry import shape, mapping, MultiLineString, LineString, Polygon, MultiPolygon, Point

# Какие теги нужны построителю подложки. Остальное выбрасываем сразу,
# чтобы не держать в памяти сотни тысяч лишних строк.
KEEP_TAGS = {
    "highway", "railway", "waterway", "natural", "landuse", "leisure", "amenity",
    "building", "aeroway", "place", "station", "name", "bridge", "tunnel", "layer",
    "service", "water", "wetland", "area", "intermittent", "subway", "covered",
    "location", "public_transport", "usage",
}
SKIP_LAYERS = {"power", "barrier", "man_made", "route", "attraction", "aerialway"}


def keep_point(p):
    return bool(p.get("place") or p.get("railway") == "station")


def main():
    tiles_dir, zoom, out_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    zdir = os.path.join(tiles_dir, str(zoom))
    pieces = defaultdict(list)   # key -> [geometry in global tile units]
    props = {}
    n_tiles = 0
    for xs in sorted(os.listdir(zdir)):
        for fname in sorted(os.listdir(os.path.join(zdir, xs))):
            x = int(xs)
            y = int(fname.split(".")[0])
            raw = open(os.path.join(zdir, xs, fname), "rb").read()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            data = mvt.decode(raw, default_options={"y_coord_down": True})
            n_tiles += 1
            for lname, layer in data.items():
                if lname in SKIP_LAYERS:
                    continue
                ext = layer.get("extent", 4096)
                for ft in layer["features"]:
                    p = ft["properties"]
                    if lname == "point" and not keep_point(p):
                        continue
                    geom = shape(ft["geometry"])
                    if geom.is_empty:
                        continue
                    # Отрезаем буфер тайла: у соседей он дублирует геометрию.
                    if geom.geom_type not in ("Point", "MultiPoint"):
                        geom = clip_by_rect(geom, 0, 0, ext, ext)
                        if geom.is_empty:
                            continue
                    else:
                        if not (0 <= geom.x < ext and 0 <= geom.y < ext):
                            continue
                    off = np.array([x * ext, y * ext], dtype=float)
                    geom = shapely.transform(geom, lambda a, off=off: a + off)
                    kind = "P" if geom.geom_type in ("Polygon", "MultiPolygon") else \
                           "L" if geom.geom_type in ("LineString", "MultiLineString") else "N"
                    key = (lname, ft.get("id"), kind)
                    pieces[key].append(geom)
                    if key not in props:
                        clean = {k2: v for k2, v in p.items() if k2 in KEEP_TAGS}
                        clean["@layer"] = lname
                        props[key] = clean
            if n_tiles % 500 == 0:
                print(f"  прочитано тайлов: {n_tiles}, объектов: {len(pieces)}", file=sys.stderr)

    world = (2 ** zoom) * 4096.0

    def to_lonlat(a):
        lon = a[:, 0] / world * 360.0 - 180.0
        lat = np.degrees(np.arctan(np.sinh(np.pi - 2.0 * np.pi * a[:, 1] / world)))
        return np.round(np.column_stack([lon, lat]), 7)

    def union_polys(parts):
        """Склейка кусков одного полигона. Кусочки после обрезки по тайлам
        иногда получаются невалидными — сначала чиним, потом объединяем,
        при сбое GEOS повторяем на сетке 0.01 единицы (~0.4 мм)."""
        parts = [shapely.make_valid(q) for q in parts]
        parts = [q for q in parts if not q.is_empty]
        polys = []
        for q in parts:
            for pp in getattr(q, "geoms", [q]):
                if pp.geom_type in ("Polygon", "MultiPolygon") and not pp.is_empty:
                    polys.append(pp)
        if not polys:
            return None
        try:
            u = unary_union(polys)
        except shapely.errors.GEOSException:
            try:
                u = unary_union(polys, grid_size=0.01)
            except shapely.errors.GEOSException:
                u = unary_union([q.buffer(0) for q in polys], grid_size=0.05)
        if u.geom_type == "GeometryCollection":
            u = unary_union([q for q in u.geoms if q.geom_type in ("Polygon", "MultiPolygon")])
        return None if u.is_empty else u

    written = 0
    with open(out_path, "w", encoding="utf-8") as out:
        for key, geoms in pieces.items():
            kind = key[2]
            if kind == "P":
                g = union_polys(geoms) if len(geoms) > 1 else shapely.make_valid(geoms[0])
                if g is None or g.is_empty:
                    continue
                if g.geom_type == "GeometryCollection":
                    g = union_polys(list(g.geoms))
                    if g is None:
                        continue
            elif kind == "L":
                lines = []
                for g in geoms:
                    for part in getattr(g, "geoms", [g]):
                        if part.geom_type == "LineString" and len(part.coords) > 1:
                            lines.append(part)
                if not lines:
                    continue
                g = lines[0] if len(lines) == 1 else line_merge(MultiLineString(lines))
            else:
                g = geoms[0]
            g = shapely.transform(g, to_lonlat)
            feat = {"type": "Feature", "id": key[1], "properties": props[key], "geometry": mapping(g)}
            out.write(json.dumps(feat, ensure_ascii=False, separators=(",", ":")) + "\n")
            written += 1
    print(f"Готово: тайлов {n_tiles}, объектов {written} -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
