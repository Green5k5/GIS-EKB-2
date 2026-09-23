#!/usr/bin/env python3
"""
Сборка собственной подложки «ГИС Екатеринбург».

Вход:  GeoJSONSeq с объектами OpenStreetMap (теги OSM в properties).
       Получить можно двумя путями:
         osmium export ekaterinburg.osm.pbf -o ekb.geojsonseq -f geojsonseq
       или из каталога MVT-тайлов:  mvt_to_geojsonseq.py
Выход: <out>/tiles/{z}/{x}/{y}.pbf  — векторные тайлы Mapbox Vector Tile
       <out>/basemap.json          — метаданные и индекс существующих тайлов

    python3 build_basemap.py ekb.geojsonseq ../../assets/basemap

Зависимости: pip install shapely numpy

Схема слоёв (одинакова для всех зумов):
  landcover  (полигоны)  c = wood|scrub|grass|park|wetland|cemetery|farm|sport|
                               sand|industrial|institution|parking|apron|pedestrian
  water      (полигоны)
  waterway   (линии)     c = river|stream|drain
  building   (полигоны)
  road       (линии)     c = motorway|trunk|primary|secondary|tertiary|minor|
                               service|pedestrian|path|track|steps; b = 1 мост, -1 тоннель
  rail       (линии)     c = rail|minor|tram
  aeroway    (линии)     c = runway|taxiway
  label      (точки)     подписи вдоль линий: k = road|river; t = текст;
                          c = класс; a = угол (для подписей вдоль линий);
                          z = зум, для которого рассчитана подпись вдоль линии;
                          r = приоритет (меньше — важнее)
Точечные подписи (place|station|water|park) лежат в basemap.json → labels.
"""
import json
import math
import os
import sys
import time
from collections import defaultdict

import numpy as np
import shapely
from shapely import clip_by_rect, line_merge, simplify
from shapely.geometry import shape, Point, LineString, MultiLineString
from shapely.ops import substring
try:
    from shapely.ops import polylabel
except ImportError:  # shapely < 2.1
    polylabel = None

EXT = 4096                 # размер тайла во внутренних единицах MVT
BUFFER = 96                # запас геометрии за краем тайла (единиц EXT)
MINZ, MAXZ = 10, 15        # зумы, для которых режутся тайлы; дальше — overzoom
ANCHOR_ZOOMS_OVER = (16, 17)   # подписи улиц, рассчитанные для overzoom
WORLD = float(2 ** 16 * EXT)   # мировые единицы: пиксели z16 при extent 4096

# Мер/пиксель на широте Екатеринбурга (для порогов по площади)
LAT0 = 56.84
M_PER_WORLD = 40075016.686 * math.cos(math.radians(LAT0)) / WORLD


def px_world(z):
    """Сколько мировых единиц в одном CSS-пикселе тайла 256 px на зуме z."""
    return WORLD / (2 ** z) / 256.0


# ----------------------------------------------------------------------------
# Классификация
# ----------------------------------------------------------------------------
ROAD_CLASSES = {
    "motorway": "motorway", "motorway_link": "motorway",
    "trunk": "trunk", "trunk_link": "trunk",
    "primary": "primary", "primary_link": "primary",
    "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary", "tertiary_link": "tertiary",
    "residential": "minor", "unclassified": "minor", "living_street": "minor", "road": "minor",
    "service": "service", "pedestrian": "pedestrian",
    "footway": "path", "path": "path", "cycleway": "path", "bridleway": "path",
    "steps": "steps", "track": "track",
}
ROAD_MINZ = {"motorway": 10, "trunk": 10, "primary": 10, "secondary": 11, "tertiary": 12,
             "minor": 12, "service": 14, "pedestrian": 14, "path": 15, "steps": 15, "track": 14}
ROAD_RANK = {"motorway": 1, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4,
             "minor": 5, "pedestrian": 6, "service": 7, "track": 8, "path": 9, "steps": 9}
# с какого зума подписывать улицы данного класса
ROAD_LABEL_MINZ = {"motorway": 13, "trunk": 13, "primary": 13, "secondary": 13,
                   "tertiary": 14, "minor": 15, "pedestrian": 15}

LANDCOVER_MINZ = {"wood": 10, "wetland": 10, "park": 11, "scrub": 11, "grass": 12,
                  "cemetery": 12, "farm": 12, "sand": 12, "industrial": 12, "apron": 12,
                  "institution": 13, "sport": 14, "parking": 15, "pedestrian": 15}
# Порог площади, px² на зуме тайла: мелочь на обзорных зумах только шумит
def min_area_px(z):
    return 24.0 if z <= 11 else 8.0 if z <= 13 else 1.5 if z == 14 else 0.4

PLACE_MINZ = {"city": 10, "town": 10, "suburb": 11, "village": 11, "hamlet": 13,
              "quarter": 14, "neighbourhood": 15, "locality": 15}
PLACE_RANK = {"city": 0, "town": 1, "suburb": 2, "village": 3, "hamlet": 5,
              "quarter": 6, "neighbourhood": 8, "locality": 9}


def yes(v):
    return v not in (None, "", "no", "0", 0, False)


def classify(p, gtype):
    """-> (layer, attrs) или None"""
    lay = p.get("@layer")
    if gtype == "point":
        if p.get("place") in PLACE_MINZ and p.get("name"):
            return ("place", {"c": p["place"]})
        if p.get("railway") == "station" and p.get("name"):
            return ("station", {"c": "metro" if p.get("station") == "subway" else "rail"})
        return None

    if gtype == "polygon":
        b = p.get("building")
        if yes(b) and lay in ("building", "amenity", "man_made", "power", "leisure", None):
            return ("building", {})
        nat, lu, le, am = p.get("natural"), p.get("landuse"), p.get("leisure"), p.get("amenity")
        if nat == "water" or lu in ("reservoir", "basin") or p.get("waterway") in ("riverbank", "dock"):
            return ("water", {})
        c = None
        if nat == "wood" or lu == "forest":
            c = "wood"
        elif nat in ("scrub", "heath"):
            c = "scrub"
        elif nat == "wetland":
            c = "wetland"
        elif lu in ("grass", "meadow", "flowerbed", "greenfield", "village_green") or nat in ("grassland", "grass", "fell"):
            c = "grass"
        elif le in ("park", "garden", "common") or lu == "recreation_ground":
            c = "park"
        elif lu == "cemetery" or am == "grave_yard":
            c = "cemetery"
        elif lu in ("allotments", "farmland", "orchard", "plant_nursery", "greenhouse_horticulture"):
            c = "farm"
        elif le in ("pitch", "track", "stadium", "sports_centre", "playground"):
            c = "sport"
        elif nat in ("beach", "sand", "bare_rock", "scree", "mud"):
            c = "sand"
        elif lu in ("industrial", "railway", "garages", "construction", "quarry", "landfill",
                    "brownfield", "military") or p.get("aeroway") == "aerodrome":
            c = "industrial"
        elif am in ("school", "university", "college", "kindergarten", "hospital", "clinic") or \
                lu in ("education", "religious"):
            c = "institution"
        elif am == "parking":
            c = "parking"
        elif p.get("aeroway") in ("apron", "runway", "taxiway"):
            c = "apron"
        elif p.get("highway") == "pedestrian":
            c = "pedestrian"
        if c:
            return ("landcover", {"c": c})
        return None

    # линии
    hw = p.get("highway")
    if hw in ROAD_CLASSES and lay in ("highway", None):
        tun = p.get("tunnel")
        b = 1 if yes(p.get("bridge")) else (-1 if tun in ("yes", "culvert") else 0)
        return ("road", {"c": ROAD_CLASSES[hw], "b": b})
    rw = p.get("railway")
    if rw and lay in ("railway", None):
        if yes(p.get("tunnel")):
            return None
        if rw == "rail" and not p.get("service") and p.get("usage") not in ("industrial",):
            return ("rail", {"c": "rail", "b": 1 if yes(p.get("bridge")) else 0})
        if rw in ("rail", "narrow_gauge", "subway", "light_rail", "preserved"):
            return ("rail", {"c": "minor", "b": 0})
        if rw == "tram":
            return ("rail", {"c": "tram", "b": 0})
        return None
    ww = p.get("waterway")
    if ww and not yes(p.get("tunnel")):
        if ww in ("river", "canal"):
            return ("waterway", {"c": "river"})
        if ww == "stream":
            return ("waterway", {"c": "stream"})
        if ww in ("drain", "ditch"):
            return ("waterway", {"c": "drain"})
        return None
    ae = p.get("aeroway")
    if ae in ("runway", "taxiway"):
        return ("aeroway", {"c": ae})
    return None


WATERWAY_MINZ = {"river": 10, "stream": 13, "drain": 15}
RAIL_MINZ = {"rail": 10, "tram": 12, "minor": 13}
AEROWAY_MINZ = {"runway": 11, "taxiway": 13}


def feature_minzoom(layer, attrs):
    c = attrs.get("c")
    if layer == "road":
        return ROAD_MINZ[c]
    if layer == "rail":
        return RAIL_MINZ[c]
    if layer == "waterway":
        return WATERWAY_MINZ[c]
    if layer == "aeroway":
        return AEROWAY_MINZ[c]
    if layer == "landcover":
        return LANDCOVER_MINZ[c]
    if layer == "building":
        return 14
    if layer == "water":
        return 10
    return 99


# ----------------------------------------------------------------------------
# Проекция
# ----------------------------------------------------------------------------
def lonlat_to_world(a):
    x = (a[:, 0] + 180.0) / 360.0 * WORLD
    lat = np.radians(np.clip(a[:, 1], -85.05, 85.05))
    y = (1.0 - np.log(np.tan(lat) + 1.0 / np.cos(lat)) / math.pi) / 2.0 * WORLD
    return np.column_stack([x, y])


def world_to_lonlat(x, y):
    lon = x / WORLD * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi - 2.0 * math.pi * y / WORLD)))
    return lon, lat


# ----------------------------------------------------------------------------
# Кодировщик MVT (protobuf) — без внешних зависимостей
# ----------------------------------------------------------------------------
def _varint(n, out):
    while n > 0x7F:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def _key(field, wire, out):
    _varint((field << 3) | wire, out)


def _bytes(field, data, out):
    _key(field, 2, out)
    _varint(len(data), out)
    out.extend(data)


def _packed(field, ints, out):
    buf = bytearray()
    for v in ints:
        _varint(v, buf)
    _bytes(field, buf, out)


def _zz(n):
    return (n << 1) ^ (n >> 31)


def _cmd(cid, count):
    return (cid & 0x7) | (count << 3)


def _ring_area2(pts):
    x, y = pts[:, 0], pts[:, 1]
    return float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def _quant(coords, ox, oy, scale):
    a = np.asarray(coords, dtype=float)[:, :2]
    q = np.rint((a - (ox, oy)) * scale).astype(np.int64)
    if len(q) > 1:
        keep = np.ones(len(q), dtype=bool)
        keep[1:] = np.any(q[1:] != q[:-1], axis=1)
        q = q[keep]
    return q


def encode_geometry(geom, ox, oy, scale):
    """-> (type, [ints]) ; type 1=point 2=line 3=polygon"""
    cmds = []
    cx = cy = 0

    def emit_path(q, close):
        nonlocal cx, cy
        cmds.append(_cmd(1, 1))
        cmds.append(_zz(int(q[0, 0] - cx)))
        cmds.append(_zz(int(q[0, 1] - cy)))
        cx, cy = int(q[0, 0]), int(q[0, 1])
        n = len(q) - 1
        if n > 0:
            cmds.append(_cmd(2, n))
            d = np.diff(q, axis=0)
            for dx, dy in d:
                cmds.append(_zz(int(dx)))
                cmds.append(_zz(int(dy)))
            cx, cy = int(q[-1, 0]), int(q[-1, 1])
        if close:
            cmds.append(_cmd(7, 1))

    gt = geom.geom_type
    if gt in ("Point", "MultiPoint"):
        pts = [geom] if gt == "Point" else list(geom.geoms)
        q = np.rint((np.array([[p.x, p.y] for p in pts]) - (ox, oy)) * scale).astype(np.int64)
        cmds.append(_cmd(1, len(q)))
        for x, y in q:
            cmds.append(_zz(int(x - cx)))
            cmds.append(_zz(int(y - cy)))
            cx, cy = int(x), int(y)
        return 1, cmds
    if gt in ("LineString", "MultiLineString"):
        for part in getattr(geom, "geoms", [geom]):
            q = _quant(part.coords, ox, oy, scale)
            if len(q) >= 2:
                emit_path(q, False)
        return (2, cmds) if cmds else (0, [])
    if gt in ("Polygon", "MultiPolygon"):
        for poly in getattr(geom, "geoms", [geom]):
            rings = [(poly.exterior, True)] + [(r, False) for r in poly.interiors]
            ext_ok = False
            for ring, is_ext in rings:
                q = _quant(ring.coords, ox, oy, scale)
                if len(q) > 1 and np.all(q[0] == q[-1]):
                    q = q[:-1]
                if len(q) < 3:
                    if is_ext:
                        break
                    continue
                a2 = _ring_area2(q)
                if a2 == 0:
                    if is_ext:
                        break
                    continue
                # MVT: внешнее кольцо — положительная площадь в координатах
                # с осью Y вниз, дырки — отрицательная. Рендер заливает всё
                # одним путём с правилом nonzero, поэтому ориентация важна.
                if (a2 > 0) != is_ext:
                    q = q[::-1]
                if is_ext:
                    ext_ok = True
                elif not ext_ok:
                    continue
                emit_path(q, True)
        return (3, cmds) if cmds else (0, [])
    return 0, []


class LayerBuilder:
    def __init__(self, name):
        self.name = name
        self.keys, self.key_idx = [], {}
        self.vals, self.val_idx = [], {}
        self.features = []

    def _k(self, k):
        if k not in self.key_idx:
            self.key_idx[k] = len(self.keys)
            self.keys.append(k)
        return self.key_idx[k]

    def _v(self, v):
        key = (type(v).__name__, v)
        if key not in self.val_idx:
            self.val_idx[key] = len(self.vals)
            self.vals.append(v)
        return self.val_idx[key]

    def add(self, gtype, cmds, props):
        tags = []
        for k, v in props.items():
            if v is None or v == "":
                continue
            tags.append(self._k(k))
            tags.append(self._v(v))
        self.features.append((gtype, cmds, tags))

    def encode(self):
        out = bytearray()
        _key(15, 0, out); _varint(2, out)
        _bytes(1, self.name.encode("utf-8"), out)
        for gtype, cmds, tags in self.features:
            f = bytearray()
            if tags:
                _packed(2, tags, f)
            _key(3, 0, f); _varint(gtype, f)
            _packed(4, cmds, f)
            _bytes(2, f, out)
        for k in self.keys:
            _bytes(3, k.encode("utf-8"), out)
        for v in self.vals:
            vb = bytearray()
            if isinstance(v, bool):
                _key(7, 0, vb); _varint(1 if v else 0, vb)
            elif isinstance(v, int):
                _key(6, 0, vb); _varint(((v << 1) ^ (v >> 63)) & 0xFFFFFFFFFFFFFFFF, vb)
            elif isinstance(v, float):
                _key(3, 1, vb); vb.extend(np.float64(v).tobytes())
            else:
                _bytes(1, str(v).encode("utf-8"), vb)
            _bytes(4, vb, out)
        _key(5, 0, out); _varint(EXT, out)
        return bytes(out)


LAYER_ORDER = ["landcover", "water", "waterway", "building", "road", "rail", "aeroway", "label"]


def encode_tile(layers):
    out = bytearray()
    for name in LAYER_ORDER:
        lb = layers.get(name)
        if lb and lb.features:
            _bytes(3, lb.encode(), out)
    return bytes(out)


# ----------------------------------------------------------------------------
# Подписи вдоль линий
# ----------------------------------------------------------------------------
CHAR_W = 0.6    # средняя ширина кириллического символа, доля кегля


def road_font(c, z):
    base = {"motorway": 12.5, "trunk": 12.5, "primary": 12, "secondary": 12,
            "tertiary": 11.5, "minor": 11, "pedestrian": 11, "river": 12.5}.get(c, 11)
    return base + (1 if z >= 17 else 0)


def line_anchors(line_px, text, fs, spacing):
    """Ищет почти прямые участки, где подпись помещается целиком.
    line_px — LineString в пикселях зума. -> [(x, y, angle_deg, avail_len)]"""
    tl = len(text) * CHAR_W * fs + 10.0
    L = line_px.length
    if L < tl + 8:
        return []
    res = []
    d = tl / 2 + 4
    step = max(6.0, tl / 6)
    while d <= L - tl / 2 - 4:
        seg = substring(line_px, d - tl / 2, d + tl / 2)
        c = np.asarray(seg.coords)
        if len(c) >= 2:
            chord = c[-1] - c[0]
            cl = float(np.hypot(*chord))
            if cl >= tl * 0.94:
                rel = c - c[0]
                dev = np.abs(rel[:, 0] * chord[1] - rel[:, 1] * chord[0]) / cl
                if float(dev.max()) <= 2.2:
                    ang = math.degrees(math.atan2(chord[1], chord[0]))
                    if ang > 90:
                        ang -= 180
                    elif ang < -90:
                        ang += 180
                    mid = line_px.interpolate(d)
                    res.append((mid.x, mid.y, round(ang, 1), round(cl, 1)))
                    d += spacing + tl
                    continue
        d += step
    return res


# ----------------------------------------------------------------------------
# Основной процесс
# ----------------------------------------------------------------------------
def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    t0 = time.time()
    feats = []                        # (layer, attrs, geom_world, minz)
    labels = []                       # (x, y, props, minz, maxz)   точки подписей
    named_lines = defaultdict(list)   # (kind, name) -> [(geom_world, class)]
    bbox = [1e30, 1e30, -1e30, -1e30]

    with open(src, encoding="utf-8") as fh:
        for line in fh:
            f = json.loads(line)
            g = f.get("geometry")
            if not g:
                continue
            p = f.get("properties") or {}
            gt = g["type"]
            gkind = "point" if gt in ("Point", "MultiPoint") else \
                    "line" if gt in ("LineString", "MultiLineString") else \
                    "polygon" if gt in ("Polygon", "MultiPolygon") else None
            if not gkind:
                continue
            cls = classify(p, gkind)
            # подписи площадных объектов: пруды, парки, леса
            name = p.get("name")
            geom = shape(g)
            if geom.is_empty:
                continue
            geom = shapely.transform(geom, lonlat_to_world)
            if not cls:
                continue
            layer, attrs = cls
            if layer in ("place", "station"):
                pt = geom if geom.geom_type == "Point" else geom.centroid
                c = attrs["c"]
                if layer == "place":
                    props = {"k": "place", "c": c, "t": name, "r": PLACE_RANK[c]}
                    labels.append((pt.x, pt.y, props, PLACE_MINZ[c]))
                else:
                    props = {"k": "station", "c": c, "t": name, "r": 4 if c == "metro" else 5}
                    labels.append((pt.x, pt.y, props, 13))
                continue
            b = geom.bounds
            bbox = [min(bbox[0], b[0]), min(bbox[1], b[1]), max(bbox[2], b[2]), max(bbox[3], b[3])]
            feats.append((layer, attrs, geom, feature_minzoom(layer, attrs)))
            if name:
                if layer == "road" and attrs["c"] in ROAD_LABEL_MINZ and attrs["b"] >= 0:
                    named_lines[("road", name)].append((geom, attrs["c"]))
                elif layer == "waterway" and attrs["c"] in ("river", "stream"):
                    named_lines[("river", name)].append((geom, attrs["c"]))
                elif layer in ("water",) or (layer == "landcover" and attrs["c"] in ("park", "wood", "cemetery")):
                    area_m2 = geom.area * M_PER_WORLD ** 2
                    kind = "water" if layer == "water" else "park"
                    thr = 1400.0 if kind == "water" else 2600.0
                    minz = None
                    for z in range(11, 19):
                        if area_m2 / ((px_world(z) * M_PER_WORLD) ** 2) >= thr:
                            minz = z
                            break
                    if minz is None:
                        continue
                    if kind == "park":
                        minz = max(minz, 13)
                    try:
                        pg = max(getattr(geom, "geoms", [geom]), key=lambda q: q.area)
                        pt = polylabel(pg, tolerance=px_world(minz) * 2) if polylabel else pg.representative_point()
                    except Exception:
                        pt = geom.representative_point()
                    r = 3 if kind == "water" and area_m2 > 1e6 else 7
                    props = {"k": kind, "c": attrs.get("c", "water"), "t": name, "r": r}
                    labels.append((pt.x, pt.y, props, minz))
    print(f"прочитано: {len(feats)} объектов, {len(labels)} точечных подписей, "
          f"{len(named_lines)} линейных имён за {time.time()-t0:.0f} с", file=sys.stderr)

    # Границы покрытия — по объектам
    minlon, maxlat = world_to_lonlat(bbox[0], bbox[1])
    maxlon, minlat = world_to_lonlat(bbox[2], bbox[3])

    # --- подписи вдоль линий -------------------------------------------------
    line_labels = []   # (x, y, props, tile_zoom)
    t1 = time.time()
    for (kind, name), items in named_lines.items():
        best = min(items, key=lambda it: ROAD_RANK.get(it[1], 3))[1]
        parts = []
        for g, _ in items:
            parts.extend(getattr(g, "geoms", [g]))
        merged = line_merge(MultiLineString(parts)) if len(parts) > 1 else parts[0]
        lines = list(getattr(merged, "geoms", [merged]))
        minz = ROAD_LABEL_MINZ.get(best, 12) if kind == "road" else (12 if best == "river" else 14)
        for z in list(range(minz, MAXZ + 1)) + [z for z in ANCHOR_ZOOMS_OVER if z >= minz]:
            s = 1.0 / px_world(z)
            fs = road_font(best if kind == "road" else "river", z)
            spacing = 260.0 if kind == "road" else 420.0
            for ln in lines:
                if ln.length * s < len(name) * CHAR_W * fs + 18:
                    continue
                lp = shapely.transform(ln, lambda a, s=s: a * s)
                for (x, y, ang, avail) in line_anchors(lp, name, fs, spacing):
                    props = {"k": kind, "c": best, "t": name, "a": ang, "z": z,
                             "r": (10 + ROAD_RANK.get(best, 5)) if kind == "road" else 6}
                    line_labels.append((x / s, y / s, props, min(z, MAXZ)))
    print(f"подписи вдоль линий: {len(line_labels)} за {time.time()-t1:.0f} с", file=sys.stderr)

    # --- резка тайлов ----------------------------------------------------------
    tiles_dir = os.path.join(out_dir, "tiles")
    index = {}
    total_bytes = 0
    for z in range(MINZ, MAXZ + 1):
        tz = time.time()
        tile_w = WORLD / (2 ** z)
        scale = EXT / tile_w
        buf_w = BUFFER / scale
        tol = px_world(z) * (0.08 if z == MAXZ else 0.35)
        amin = min_area_px(z) * px_world(z) ** 2
        tiles = defaultdict(dict)   # (x,y) -> {layer: LayerBuilder}

        def put(tx, ty, layer, gtype, cmds, props):
            lbs = tiles[(tx, ty)]
            if layer not in lbs:
                lbs[layer] = LayerBuilder(layer)
            lbs[layer].add(gtype, cmds, props)

        for layer, attrs, geom, minz in feats:
            if z < minz:
                continue
            if layer in ("landcover", "water", "building") and geom.area < amin:
                continue
            if layer in ("road", "rail", "waterway", "aeroway") and z < 13 and geom.length < px_world(z) * 3:
                continue
            g = simplify(geom, tol, preserve_topology=layer != "building")
            if g.is_empty:
                continue
            b = g.bounds
            x0, x1 = int((b[0] - buf_w) // tile_w), int((b[2] + buf_w) // tile_w)
            y0, y1 = int((b[1] - buf_w) // tile_w), int((b[3] + buf_w) // tile_w)
            props = {k: v for k, v in attrs.items() if not (k == "b" and v == 0)}
            for tx in range(x0, x1 + 1):
                for ty in range(y0, y1 + 1):
                    ox, oy = tx * tile_w, ty * tile_w
                    if x0 == x1 and y0 == y1:
                        cg = g
                    else:
                        cg = clip_by_rect(g, ox - buf_w, oy - buf_w, ox + tile_w + buf_w, oy + tile_w + buf_w)
                        if cg.is_empty:
                            continue
                        if cg.geom_type == "GeometryCollection":
                            want = ("Polygon", "MultiPolygon") if layer in ("landcover", "water", "building") \
                                else ("LineString", "MultiLineString")
                            parts = [q for q in cg.geoms if q.geom_type in want]
                            if not parts:
                                continue
                            cg = shapely.union_all(parts) if len(parts) > 1 else parts[0]
                    gtype, cmds = encode_geometry(cg, ox, oy, scale)
                    if gtype:
                        put(tx, ty, layer, gtype, cmds, props)

        # Точечные подписи (районы, посёлки, водоёмы, парки, станции) в тайлы
        # не кладём: их немного, они уходят целиком в basemap.json и не
        # зависят от подгрузки тайлов — не мигают и не пропадают.
        for x, y, props, tzoom in line_labels:
            if tzoom != z:
                continue
            tx, ty = int(x // tile_w), int(y // tile_w)
            ox, oy = tx * tile_w, ty * tile_w
            gtype, cmds = encode_geometry(Point(x, y), ox, oy, scale)
            put(tx, ty, "label", gtype, cmds, props)

        zi = defaultdict(list)
        zbytes = 0
        for (tx, ty), lbs in tiles.items():
            data = encode_tile(lbs)
            if not data:
                continue
            d = os.path.join(tiles_dir, str(z), str(tx))
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, f"{ty}.pbf"), "wb") as fh:
                fh.write(data)
            zi[tx].append(ty)
            zbytes += len(data)
        total_bytes += zbytes
        # компактный индекс: x -> отсортированные диапазоны y [[y0,y1],...]
        zidx = {}
        for tx, ys in zi.items():
            ys.sort()
            ranges = []
            for y in ys:
                if ranges and y == ranges[-1][1] + 1:
                    ranges[-1][1] = y
                else:
                    ranges.append([y, y])
            zidx[str(tx)] = ranges
        index[str(z)] = zidx
        n = sum(len(v) for v in zi.values())
        print(f"z{z}: тайлов {n}, {zbytes/1e6:.1f} МБ, {time.time()-tz:.0f} с", file=sys.stderr)

    meta = {
        "name": "ГИС Екатеринбург — собственная подложка",
        "format": "mvt",
        "extent": EXT,
        "minzoom": MINZ,
        "maxzoom": MAXZ,
        "bounds": [round(minlon, 5), round(minlat, 5), round(maxlon, 5), round(maxlat, 5)],
        "attribution": "© участники OpenStreetMap",
        "attribution_url": "https://www.openstreetmap.org/copyright",
        "built": time.strftime("%Y-%m-%d"),
        "tiles": "tiles/{z}/{x}/{y}.pbf",
        "index": index,
        # [долгота, широта, вид, класс, текст, приоритет, минимальный зум]
        "labels": [
            [round(world_to_lonlat(x, y)[0], 6), round(world_to_lonlat(x, y)[1], 6),
             p["k"], p.get("c", ""), p["t"], p["r"], mz]
            for x, y, p, mz in sorted(labels, key=lambda it: (it[2]["r"], it[3]))
        ],
    }
    with open(os.path.join(out_dir, "basemap.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"Готово: {total_bytes/1e6:.1f} МБ за {time.time()-t0:.0f} с", file=sys.stderr)


if __name__ == "__main__":
    main()
