#!/usr/bin/env python3
"""
Однофайловая сборка сайта: всё — стили, скрипты, данные, подложка,
исторические планы — в одном HTML. Его можно просто скачать и открыть
двойным щелчком, ничего не распаковывая (в том числе прямо из архива).

    python3 tools/build_single.py            # из корня сайта
    -> ГИС-Екатеринбург.html

Нужен Pillow (pip install pillow) — картинки планов пережимаются,
чтобы файл был поменьше (параметры PLAN_MAX_SIDE, PLAN_QUALITY).
Требует готовый автономный комплект assets/basemap/offline
(tools/basemap/make_offline.py).
"""
import base64, io, json, os, re, sys

PLAN_MAX_SIDE = 1500
PLAN_QUALITY = 62
OUT = "ГИС-Екатеринбург.html"


def js_safe(text):
    # закрывающий тег внутри встроенного скрипта оборвал бы его
    return text.replace("</script", "<\\/script").replace("</SCRIPT", "<\\/SCRIPT")


def offline_bundle(root):
    off = os.path.join(root, "assets", "basemap", "offline")
    meta_js = open(os.path.join(off, "basemap-offline.js"), encoding="utf-8").read()
    m = re.search(r"window\.KartografOffline = \{meta: (.*)\};\s*$", meta_js, re.S)
    meta = m.group(1)
    parts = []
    for z in sorted(os.listdir(off)):
        zdir = os.path.join(off, z)
        if not os.path.isdir(zdir):
            continue
        for fn in sorted(os.listdir(zdir)):
            txt = open(os.path.join(zdir, fn), encoding="ascii").read().strip()
            mm = re.match(r'KartografOfflinePack\("([^"]+)",(.*)\);$', txt, re.S)
            parts.append(json.dumps(mm.group(1)) + ":" + mm.group(2))
    return "window.KartografOffline = {meta: " + meta + ", packs: {" + ",".join(parts) + "}};"


def plans(root):
    from PIL import Image
    d = os.path.join(root, "assets", "overlays-lite")
    out = {}
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".webp"):
            continue
        im = Image.open(os.path.join(d, fn))
        im.load()
        k = PLAN_MAX_SIDE / max(im.size)
        if k < 1:
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=PLAN_QUALITY, method=6)
        out[fn] = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return "window.KH_INLINE_ASSETS = " + json.dumps(out) + ";"


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    html = open(os.path.join(root, "index.html"), encoding="utf-8").read()

    def css(m):
        return "<style>\n" + open(os.path.join(root, m.group(1)), encoding="utf-8").read() + "\n</style>"
    html = re.sub(r'<link rel="stylesheet" href="([^"?]+)(?:\?[^"]*)?">', css, html)

    def script(m):
        return "<script>\n" + js_safe(open(os.path.join(root, m.group(1)), encoding="utf-8").read()) + "\n</script>"
    html = re.sub(r'<script src="([^"?]+)(?:\?[^"]*)?"></script>', script, html)

    inject = ("<script>\n" + js_safe(offline_bundle(root)) + "\n</script>\n"
              "<script>\n" + plans(root) + "\n</script>\n")
    # встроенные данные — до скриптов карты
    i = html.find("<script>")
    html = html[:i] + inject + html[i:]

    path = os.path.join(root, OUT)
    open(path, "w", encoding="utf-8").write(html)
    print(f"Готово: {path}, {os.path.getsize(path) / 2**20:.1f} МБ")


if __name__ == "__main__":
    main()
