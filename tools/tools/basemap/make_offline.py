#!/usr/bin/env python3
"""
Автономный комплект подложки — чтобы сайт открывался двойным щелчком
по index.html, без веб-сервера.

Браузеры не дают странице с адресом file:// читать файлы через fetch(),
но разрешают подключать <script>. Поэтому тайлы (.pbf) складываются в
JS-файлы «пачками» по 8×8 тайлов (base64). Движок сам переключается на
этот комплект, если сервера нет.

    python3 make_offline.py ../../assets/basemap

Создаёт assets/basemap/offline/:
    basemap-offline.js          — описание подложки (то же, что basemap.json)
    {z}/{px}_{py}.js            — пачки тайлов

Запускать после каждой пересборки подложки (build_basemap.py).
На боевом сервере эта папка не используется, её можно не выкладывать.
"""
import base64
import json
import os
import shutil
import sys
from collections import defaultdict

PACK_SHIFT = 3   # 2^3 = 8 тайлов по каждой оси; должно совпадать с basemap.js


def main():
    root = sys.argv[1]
    meta = json.load(open(os.path.join(root, "basemap.json"), encoding="utf-8"))
    tiles_dir = os.path.join(root, "tiles")
    out = os.path.join(root, "offline")
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)

    with open(os.path.join(out, "basemap-offline.js"), "w", encoding="utf-8") as fh:
        fh.write("/* Автономный комплект подложки: сгенерирован make_offline.py, не править вручную */\n")
        fh.write("window.KartografOffline = {meta: ")
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("};\n")

    total, packs = 0, 0
    for z in sorted(os.listdir(tiles_dir), key=int):
        groups = defaultdict(dict)
        for xs in os.listdir(os.path.join(tiles_dir, z)):
            for fn in os.listdir(os.path.join(tiles_dir, z, xs)):
                x, y = int(xs), int(fn.split(".")[0])
                data = open(os.path.join(tiles_dir, z, xs, fn), "rb").read()
                groups[(x >> PACK_SHIFT, y >> PACK_SHIFT)][f"{x}/{y}"] = base64.b64encode(data).decode("ascii")
        os.makedirs(os.path.join(out, z), exist_ok=True)
        for (px, py), tiles in groups.items():
            path = os.path.join(out, z, f"{px}_{py}.js")
            with open(path, "w", encoding="ascii") as fh:
                fh.write(f'KartografOfflinePack("{z}/{px}/{py}",')
                json.dump(tiles, fh, separators=(",", ":"))
                fh.write(");\n")
            total += os.path.getsize(path)
            packs += 1
    print(f"Готово: {packs} пачек, {total / 1e6:.1f} МБ -> {out}")


if __name__ == "__main__":
    main()
