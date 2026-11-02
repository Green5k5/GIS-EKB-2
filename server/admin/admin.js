import { fileKind, ignoredReason } from "./import-policy.js";
("use strict");
const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const ROOT = "/api/admin/workspace";
let csrf = "",
  data = null,
  map = null,
  estates = null,
  planLayers = [],
  plansOn = false,
  view = "map",
  selected = null,
  editing = null,
  dirty = false,
  issuesOnly = false,
  tool = null,
  drawPoints = [],
  vertices = null,
  reviewMap = null,
  reviewFeatures = null,
  reviewPlans = [],
  files = [],
  batchId = null,
  pollTimer = null,
  overlayDraft = null,
  overlayPreview = null;
let ignoredFiles = [],
  uploading = false,
  reviewResult = null,
  planSelection = new Set();
function toast(message, error = false) {
  $("toast").textContent = message;
  $("toast").className = "toast" + (error ? " error" : "");
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(
    () => ($("toast").hidden = true),
    error ? 9000 : 4500,
  );
}
async function api(route, opts = {}) {
  const headers = {
    ...(opts.body && !opts.raw ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers || {}),
  };
  if (["POST", "PATCH", "DELETE"].includes(opts.method))
    headers["X-CSRF-Token"] = csrf;
  const response = await fetch(
    route.startsWith("/api/") ? route : ROOT + route,
    { ...opts, headers },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Не удалось связаться с сервером.");
  return result;
}
const action = (fn) => async (event) => {
  const button = event?.currentTarget;
  try {
    if (button) button.disabled = true;
    await fn(event);
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (button) button.disabled = false;
    if (["uploadFilesButton", "analyzeButton"].includes(button?.id))
      renderFileQueue();
    if (button?.id === "deleteUnselectedPlans") renderReviewPlanList();
  }
};
async function confirmAction(title, text, label = "Продолжить", note = false) {
  $("dialogTitle").textContent = title;
  $("dialogText").textContent = text;
  $("dialogAccept").textContent = label;
  $("noteLabel").hidden = !note;
  $("releaseNote").value = "";
  const d = $("confirmDialog");
  d.showModal();
  return new Promise((resolve) =>
    d.addEventListener("close", () => resolve(d.returnValue === "ok"), {
      once: true,
    }),
  );
}
function canLeave() {
  if (!dirty) return true;
  if (
    !confirm("Есть несохранённые изменения. Закрыть карточку без сохранения?")
  )
    return false;
  dirty = false;
  return true;
}
function setView(name) {
  if (!canLeave()) return false;
  document.querySelector(".sidebar").classList.remove("expanded");
  $("mobileMenu").setAttribute("aria-expanded", "false");
  view = name;
  $("publishButton").hidden = name === "import";
  for (const n of ["map", "import", "layers", "history"])
    $(n + "View").hidden = n !== name;
  document
    .querySelectorAll("nav [data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $("crumb").textContent = {
    map: "Карта и усадьбы",
    import: "Загрузить данные",
    layers: "Старые карты",
    history: "История публикаций",
  }[name];
  if (name === "map") requestAnimationFrame(() => map?.invalidateSize());
  if (name === "import" && reviewMap)
    requestAnimationFrame(() => reviewMap.invalidateSize());
  return true;
}
function createMap(id) {
  return new Kartograf.Map(id, {
    center: [56.82, 60.62],
    zoom: 12,
    minZoom: 9,
    maxZoom: 20,
    theme: "light",
    basemap: {
      url: "/assets/basemap/basemap.json",
      workerUrl: "/js/kartograf/tile-worker.js",
      forceMainThread: false,
      keepAttribution: true,
    },
  });
}
function rings(g) {
  return g.type === "MultiPolygon" ? g.coordinates.flat() : g.coordinates;
}
function points(g) {
  return rings(g).flat();
}
function bounds(g) {
  const b = new Kartograf.LatLngBounds();
  points(g).forEach((p) => b.extend([p[1], p[0]]));
  return b;
}
function recordGeometry(r) {
  return data.plots.find((p) => Number(p.id) === Number(r.plotId))?.geometry;
}
function hasLocation(r) {
  return Boolean(
    recordGeometry(r) || (Number.isFinite(r.lat) && Number.isFinite(r.lng)),
  );
}
function feature(r, g) {
  return {
    id: r.id,
    rings: g ? rings(g).map((r) => r.map((p) => [p[1], p[0]])) : null,
    center: [r.lat, r.lng],
    radius: 6,
    color: "#7e975f",
    fillOpacity: 0.32,
    weight: 1.25,
    opacity: 0.9,
    data: r,
  };
}
function needsAttention(r) {
  return !hasLocation(r) || Boolean(r.issues?.length);
}
function renderAttention() {
  const panel = $("attentionPanel");
  panel.hidden = !issuesOnly;
  if (!issuesOnly) return;
  panel.innerHTML =
    '<h3>Требует внимания</h3><p class="muted small-text">Данные уже добавлены. Откройте нужную усадьбу и исправьте сведения в карточке.</p>' +
      data.records
        .filter(needsAttention)
        .map(
          (r) =>
            `<button class="attention-record" data-attention-record="${r.id}"><strong>Усадьба ${esc(r.num)}</strong><span>${esc(r.issues?.map((i) => i.message).join(" ") || "Укажите положение или нарисуйте контур на карте.")}</span><b>Открыть →</b></button>`,
        )
        .join("") +
      (data.warnings || [])
        .map(
          (w) =>
            `<div class="attention-warning"><p>${esc(w.message)}</p><button class="text-button" data-resolve-warning="${w.id}">Отметить проверенным</button></div>`,
        )
        .join("") || "<p>Все данные проверены.</p>";
}
$("attentionPanel").onclick = action(async (event) => {
  const record = event.target.closest("[data-attention-record]");
  if (record) {
    openRecord(Number(record.dataset.attentionRecord));
    return;
  }
  const warning = event.target.closest("[data-resolve-warning]");
  if (warning) {
    await api("/warnings/" + warning.dataset.resolveWarning, {
      method: "PATCH",
      body: "{}",
    });
    await refresh();
  }
});
function filtered() {
  const q = $("search").value.toLocaleLowerCase("ru").trim(),
    sid = $("settlement").value;
  return data.records.filter(
    (r) =>
      (!sid || r.settlementId === sid) &&
      (!issuesOnly || needsAttention(r)) &&
      (!q ||
        [r.num, r.surname, r.name, r.patronymic, r.street].some((v) =>
          String(v || "")
            .toLocaleLowerCase("ru")
            .includes(q),
        )),
  );
}
function renderRecords() {
  const rows = filtered();
  $("listCount").textContent = rows.length;
  $("recordList").innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            `<button class="record-item ${r.id === selected ? "active" : ""}" data-record="${r.id}"><span class="estate-number">${esc(r.num)}</span><span><strong>${esc([r.surname, r.name].filter(Boolean).join(" ") || "Владелец не указан")}</strong><small>${esc(r.street || data.settlements.find((s) => s.id === r.settlementId)?.name || "")}<br>${esc(r.soslovie || "Сведения не указаны")}</small></span>${needsAttention(r) ? '<span class="issue-dot" title="Требует проверки">!</span>' : ""}</button>`,
        )
        .join("")
    : '<div class="empty-list">' +
      (data.records.length
        ? "По вашему запросу ничего не найдено."
        : "В коллекции пока нет усадеб.<br>Загрузите первый набор файлов.") +
      "</div>";
  estates.setFeatures(
    rows.filter(hasLocation).map((r) => feature(r, recordGeometry(r))),
  );
  estates.setSelected(selected);
  $("issuesFilter").classList.toggle("active", issuesOnly);
  renderAttention();
}
function fit() {
  const b = estates.getBounds();
  if (b.isValid())
    map.fitBounds(b, { padding: [65, 65], maxZoom: 16, animate: false });
}
function renderPlans() {
  planLayers.forEach((l) => map.removeLayer(l));
  planLayers = data.overlays
    .filter((o) => o.visible)
    .map(
      (o) =>
        new Kartograf.ImageOverlay(o.fileUrl, o.bounds, {
          opacity: o.opacity,
          visible: plansOn,
          rotation: o.rotation,
          crop: o.crop,
          zIndex: 100,
        }),
    );
  planLayers.forEach((l) => map.addLayer(l));
  $("togglePlans").classList.toggle("active", plansOn);
}
function imageDownloadUrl(o) {
  return (
    ROOT +
    "/image.png?" +
    new URLSearchParams({ fileUrl: o.fileUrl, name: o.name || "План" })
  );
}
let replacementTarget = null,
  replacingImage = false;
function openImageReplacement(o, staged = false) {
  replacementTarget = { plan: o, staged };
  $("downloadCurrentImage").href = imageDownloadUrl(o);
  $("imageReplacementStatus").textContent = staged
    ? "Замена сохранится в подготовленном наборе. На сайте план обновится после добавления и публикации."
    : "После замены проверьте результат на карте и нажмите «Сохранить размещение».";
  const seen = new Set([o.fileUrl]);
  const images = [
    ...(data?.overlays || []),
    ...(reviewResult?.overlays || []),
  ].filter((p) => {
    if (seen.has(p.fileUrl)) return false;
    seen.add(p.fileUrl);
    return true;
  });
  $("imageLibrary").innerHTML = images.length
    ? images
        .map(
          (p, i) =>
            `<button class="image-choice" data-image-choice="${i}"><img src="${esc(p.fileUrl)}" alt="" loading="lazy"><span>${esc(p.name)}</span></button>`,
        )
        .join("")
    : '<p class="muted">Других изображений пока нет. Загрузите файл с компьютера.</p>';
  $("imageLibrary").onclick = action(async (e) => {
    const button = e.target.closest("[data-image-choice]");
    if (!button || replacingImage) return;
    await replacePlanImage(
      images[Number(button.dataset.imageChoice)].fileUrl,
      true,
    );
  });
  $("imageDialog").showModal();
}
async function replacePlanImage(fileUrl, copy = false) {
  const target = replacementTarget;
  if (!target || replacingImage) return;
  replacingImage = true;
  $("uploadReplacement").disabled = true;
  $("closeImageDialog").disabled = true;
  $("imageReplacementStatus").textContent = "Сохраняем изображение…";
  try {
    if (target.staged) {
      const response = await api(
        `/batches/${batchId}/plans/${target.plan.sourceFileId}/image`,
        {
          method: "PATCH",
          body: JSON.stringify({ fileUrl }),
        },
      );
      reviewResult = response.result;
      renderReviewPlanList();
      renderReviewPlanMap(target.plan.sourceFileId);
    } else {
      if (copy)
        fileUrl = (
          await api("/images/copy", {
            method: "POST",
            body: JSON.stringify({ fileUrl }),
          })
        ).fileUrl;
      overlayDraft.fileUrl = fileUrl;
      dirty = true;
      $("downloadOverlayImage").href = imageDownloadUrl(overlayDraft);
      previewOverlay();
    }
    $("imageDialog").close();
    toast(
      "Изображение заменено. Размещение сохранено." +
        (target.staged ? "" : " Нажмите «Сохранить размещение»."),
    );
  } catch (error) {
    $("imageReplacementStatus").textContent =
      "Не удалось заменить: " + error.message;
    throw error;
  } finally {
    replacingImage = false;
    $("uploadReplacement").disabled = false;
    $("closeImageDialog").disabled = false;
  }
}
$("closeImageDialog").onclick = () => $("imageDialog").close();
$("imageDialog").addEventListener("cancel", (e) => {
  if (replacingImage) e.preventDefault();
});
$("uploadReplacement").onclick = () => $("replacementInput").click();
$("replacementInput").onchange = action(async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  $("uploadReplacement").disabled = true;
  $("closeImageDialog").disabled = true;
  $("imageReplacementStatus").textContent = "Загружаем изображение…";
  try {
    const image = await api("/image", {
      method: "POST",
      body: file,
      raw: true,
    });
    await replacePlanImage(image.fileUrl);
  } finally {
    $("uploadReplacement").disabled = false;
    $("closeImageDialog").disabled = false;
  }
});
function renderLayers() {
  $("layerGrid").innerHTML = data.overlays.length
    ? data.overlays
        .map(
          (o) =>
            `<article class="layer-card"><div class="layer-thumbnail"><img src="${esc(o.fileUrl)}" alt="${esc(o.name)}" loading="lazy"></div><div class="layer-card-body"><h3>${esc(o.name)}</h3><p>${esc(data.settlements.find((s) => s.id === o.settlementId)?.name || "Общая карта")} · Прозрачность ${Math.round(o.opacity * 100)}%</p><div class="layer-buttons"><label><input data-layer-toggle="${o.id}" type="checkbox" ${o.visible ? "checked" : ""}> На сайте</label><button class="secondary" data-layer="${o.id}">Разместить и настроить ↗</button></div></div></article>`,
        )
        .join("")
    : '<div class="empty-list">Старых карт пока нет.<br>Загрузите GeoTIFF вместе с папкой или добавьте изображение.</div>';
}
function renderHistory() {
  $("releaseList").innerHTML =
    data.releases
      .map(
        (r, i) =>
          `<article class="release-card"><span class="release-icon">◷</span><div><h3>${esc(r.note || "Публикация карты")} ${i === 0 ? '<span class="badge">На сайте</span>' : ""}</h3><p>Версия №${r.id} · ${esc(new Date(r.createdAt.replace(" ", "T") + "Z").toLocaleString("ru-RU"))}</p></div><button class="secondary" data-restore="${r.id}">Восстановить</button></article>`,
      )
      .join("") ||
    '<div class="empty-list">Здесь появится первая опубликованная версия.</div>';
}
async function refresh({ fitMap = false } = {}) {
  data = await api("");
  $("recordCount").textContent = $("navCount").textContent =
    data.records.length;
  $("plotCount").textContent = data.records.filter((r) =>
    recordGeometry(r),
  ).length;
  $("issueCount").textContent =
    data.records.filter(needsAttention).length + (data.warnings?.length || 0);
  $("layerCount").textContent = $("navLayers").textContent =
    data.overlays.length;
  const sid = $("settlement").value;
  $("settlement").innerHTML =
    '<option value="">Все поселения</option>' +
    data.settlements
      .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
      .join("");
  $("settlement").value = sid;
  $("emptyMap").hidden = !!data.records.length;
  $("footerVersion").textContent = data.releases[0]
    ? "Опубликована версия №" + data.releases[0].id
    : "Ещё не опубликовано";
  $("publishState").textContent = data.hasChanges
    ? "● Есть изменения для публикации"
    : "● Всё опубликовано";
  renderRecords();
  renderPlans();
  renderLayers();
  renderHistory();
  if (fitMap) fit();
}
async function boot() {
  const session = await api("/api/admin/session");
  if (!session.authenticated) return;
  csrf =
    document.cookie
      .split("; ")
      .find((c) => c.startsWith("gis_csrf="))
      ?.split("=")[1] || "";
  $("login").hidden = true;
  $("app").hidden = false;
  if (!map) {
    map = createMap("adminMap");
    estates = new Kartograf.FeatureLayer({
      zIndex: 300,
      selectedColor: "#315d42",
    });
    map.addLayer(estates);
    estates.on("click", (e) => {
      if (!tool) openRecord(e.feature.data.id);
    });
    map.on("click", (e) => mapClick(e.latlng));
    map.on("move zoom", positionVertices);
    vertices = document.createElement("div");
    vertices.id = "vertexPane";
    $("adminMap").append(vertices);
    new ResizeObserver(() => {
      map.invalidateSize();
      positionVertices();
    }).observe($("adminMap"));
  }
  await refresh({ fitMap: true });
  await resumeImport();
}
function field(k, label, value = "", opts = {}) {
  return `<label>${label}${
    opts.options
      ? `<input name="${k}" value="${esc(value)}" list="values-${k}"><datalist id="values-${k}">${[
          ...new Set(data.records.map((r) => r[k]).filter(Boolean)),
        ]
          .sort()
          .map((v) => `<option value="${esc(v)}">`)
          .join("")}</datalist>`
      : `<input name="${k}" value="${esc(value)}" ${opts.type ? `type="${opts.type}" step="any"` : ""}>`
  }</label>`;
}
function closeInspector() {
  if (!canLeave()) return;
  selected = null;
  editing = null;
  overlayDraft = null;
  stopTool();
  if (overlayPreview) {
    map.removeLayer(overlayPreview);
    overlayPreview = null;
  }
  $("inspector").hidden = true;
  renderRecords();
  map.invalidateSize();
}
function openRecord(id) {
  if (!canLeave()) return;
  const r = id
    ? data.records.find((r) => r.id === id)
    : {
        num: "",
        settlementId: $("settlement").value || data.settlements[0]?.id,
        extra: {},
      };
  if (!r) return;
  if (id && !filtered().some((item) => item.id === id)) {
    $("search").value = "";
    $("settlement").value = "";
    issuesOnly = false;
  }
  overlayDraft = null;
  if (overlayPreview) {
    map.removeLayer(overlayPreview);
    overlayPreview = null;
  }
  stopTool();
  selected = r.id || null;
  editing = {
    ...structuredClone(r),
    geometry: recordGeometry(r) ? structuredClone(recordGeometry(r)) : null,
  };
  dirty = false;
  renderRecords();
  $("inspector").hidden = false;
  const basics =
    field("num", "Номер усадьбы", r.num) +
    `<label>Поселение<select name="settlementId">${data.settlements.map((s) => `<option value="${s.id}" ${s.id === r.settlementId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>`;
  $("inspector").innerHTML =
    `<div class="inspector-head"><div><p class="eyebrow">${r.id ? "ИСТОРИЯ МЕСТА" : "НОВАЯ ИСТОРИЯ"}</p><h2>Усадьба ${esc(r.num || "")}</h2></div><button class="close-button" id="closeInspector" aria-label="Закрыть карточку">×</button></div><form id="recordForm" class="record-form">${r.issues?.length ? `<section id="recordIssues" class="record-issues"><h3>Требует внимания</h3>${r.issues.map((i) => `<p>${esc(i.message)}</p>`).join("")}<button type="button" id="acknowledgeIssues" class="text-button">Отметить сведения проверенными</button></section>` : ""}<div class="two-fields">${basics}</div>${field("surname", "Фамилия владельца", r.surname)}<div class="two-fields">${field("name", "Имя", r.name)}${field("patronymic", "Отчество", r.patronymic)}</div>${field("street", "Улица / район", r.street, { options: true })}<div class="two-fields">${field("buildingType", "Постройка", r.buildingType, { options: true })}${field("area_sazh", "Площадь, саж²", r.area_sazh, { type: "number" })}</div>${field("soslovie", "Сословно-профессиональная группа", r.soslovie, { options: true })}<label>Положение на карте</label><p id="positionNote" class="position-note">${editing.geometry ? "Контур связан с записью." : r.lat != null ? "Указана точка на карте." : "Место пока не указано."}</p><div class="position-actions"><button type="button" class="secondary" id="pickPoint">⌖ Указать место</button><button type="button" class="secondary" id="drawPlot">⬡ Нарисовать контур</button>${editing.geometry ? '<button type="button" class="secondary" id="editPlot">Изменить вершины</button>' : ""}</div><details><summary>Семья и служба</summary><div>${field("sex", "Пол", r.sex, { options: true })}${field("familyStatus", "Семейное положение", r.familyStatus, { options: true })}${field("serviceType", "Род службы", r.serviceType, { options: true })}${field("rank", "Чин", r.rank, { options: true })}${field("position", "Должность / род занятий", r.position, { options: true })}${field("servicePlace", "Место службы", r.servicePlace, { options: true })}${field("registrationPlace", "Место приписки", r.registrationPlace, { options: true })}</div></details><details open><summary>Источники и примечания</summary><div>${field("source", "Архивный источник", r.source)}${field("scanUrl", "Ссылка на скан", r.scanUrl)}${/^https?:\/\//.test(r.scanUrl || "") ? `<a class="source-link" href="${esc(r.scanUrl)}" target="_blank" rel="noopener">Открыть скан источника ↗</a>` : ""}<label>Примечание<textarea name="notes" rows="3">${esc(r.notes)}</textarea></label></div></details>${
      Object.keys(r.extra || {}).length
        ? "<details><summary>Дополнительные сведения из таблицы</summary><div>" +
          Object.entries(r.extra)
            .map(([k, v], i) => field("extra-" + i, esc(k), v))
            .join("") +
          "</div></details>"
        : ""
    }</form><div class="form-actions"><button id="saveRecord" class="primary">Сохранить изменения</button>${r.id ? '<button id="archiveRecord" class="text-button">Убрать усадьбу в архив</button>' : ""}</div>`;
  $("closeInspector").onclick = closeInspector;
  $("recordForm").oninput = () => (dirty = true);
  if ($("acknowledgeIssues"))
    $("acknowledgeIssues").onclick = () => {
      editing.issues = [];
      dirty = true;
      $("recordIssues").innerHTML =
        "<p>Сведения отмечены проверенными. Сохраните карточку.</p>";
    };
  $("recordForm").onsubmit = (e) => {
    e.preventDefault();
    $("saveRecord").click();
  };
  $("saveRecord").onclick = action(saveEditing);
  $("pickPoint").onclick = () => startTool("point");
  $("drawPlot").onclick = () => startTool("draw");
  if ($("editPlot")) $("editPlot").onclick = () => startTool("vertices");
  if ($("archiveRecord"))
    $("archiveRecord").onclick = action(async () => {
      if (
        !(await confirmAction(
          "Убрать усадьбу?",
          "Она исчезнет из рабочей карты. На сайте изменение появится после публикации.",
          "Убрать",
        ))
      )
        return;
      await api("/records/" + r.id, { method: "DELETE" });
      dirty = false;
      closeInspector();
      await refresh();
      toast("Усадьба убрана из рабочей карты.");
    });
  requestAnimationFrame(() => {
    map.invalidateSize();
    const g = editing.geometry;
    if (g)
      map.fitBounds(bounds(g), {
        padding: [80, 80],
        maxZoom: 18,
        animate: true,
      });
    else if (r.lat != null) map.flyTo([r.lat, r.lng], 17);
  });
}
async function saveEditing() {
  if (tool === "draw") throw new Error("Сначала завершите контур.");
  const f = Object.fromEntries(new FormData($("recordForm")));
  for (const k of ["area_sazh"]) f[k] = f[k] === "" ? null : Number(f[k]);
  const extra = { ...editing.extra };
  Object.keys(extra).forEach((k, i) => {
    extra[k] = f["extra-" + i];
    delete f["extra-" + i];
  });
  const result = await api("/records" + (editing.id ? "/" + editing.id : ""), {
    method: editing.id ? "PATCH" : "POST",
    body: JSON.stringify({
      ...f,
      extra,
      geometry: editing.geometry,
      issues: editing.issues || [],
      lat: editing.lat ?? null,
      lng: editing.lng ?? null,
    }),
  });
  dirty = false;
  stopTool();
  await refresh();
  openRecord(result.id);
  toast("Изменения сохранены. Можно опубликовать карту.");
}
function hint(text, buttons = "") {
  $("mapHint").innerHTML =
    "<span>" + text + "</span><div>" + buttons + "</div>";
  $("mapHint").hidden = false;
}
function stopTool() {
  tool = null;
  drawPoints = [];
  if (vertices) vertices.innerHTML = "";
  $("mapHint").hidden = true;
  $("adminMap").classList.remove("drawing-map");
  if (estates) estates.interactive = true;
}
function startTool(mode) {
  tool = mode;
  estates.interactive = false;
  $("adminMap").classList.add("drawing-map");
  if (mode === "point")
    hint(
      "Нажмите на карту в нужном месте.",
      '<button id="cancelTool">Отмена</button>',
    );
  if (mode === "draw") {
    drawPoints = [];
    hint(
      "Отмечайте вершины участка по порядку.",
      '<button id="finishDraw">Готово</button> <button id="undoDraw">Назад</button> <button id="cancelTool">Отмена</button>',
    );
    $("finishDraw").onclick = () => {
      if (drawPoints.length < 3)
        return toast("Укажите минимум три вершины.", true);
      editing.geometry = {
        type: "Polygon",
        coordinates: [[...drawPoints, drawPoints[0]]],
      };
      dirty = true;
      stopTool();
      previewEditing();
      $("positionNote").textContent =
        "Новый контур готов. Сохраните изменения.";
    };
    $("undoDraw").onclick = () => {
      drawPoints.pop();
      drawPreview();
    };
  }
  if (mode === "vertices") {
    hint(
      "Перетаскивайте точки контура. Затем сохраните карточку.",
      '<button id="finishVertices">Готово</button>',
    );
    $("finishVertices").onclick = () => {
      stopTool();
      previewEditing();
    };
    positionVertices();
  }
  if ($("cancelTool"))
    $("cancelTool").onclick = () => {
      stopTool();
      renderRecords();
    };
}
function mapClick(ll) {
  if (tool === "point") {
    editing.lat = ll.lat;
    editing.lng = ll.lng;
    dirty = true;
    if (editing.geometry) {
      toast(
        "Для перемещения контура используйте вершины. Точка сохранена для записи.",
      );
    }
    stopTool();
    previewEditing();
    $("positionNote").textContent = "Место указано. Сохраните изменения.";
  } else if (tool === "draw") {
    drawPoints.push([ll.lng, ll.lat]);
    drawPreview();
  } else if (tool === "overlay") {
    const b = overlayDraft.bounds,
      c = map.getCenter(),
      p = Kartograf.project(ll.lat, ll.lng),
      sw = Kartograf.project(b[0][0], b[0][1]),
      ne = Kartograf.project(b[1][0], b[1][1]),
      dx = (ne.x - sw.x) / 2,
      dy = (sw.y - ne.y) / 2;
    overlayDraft.bounds = [
      Object.values(Kartograf.unproject(p.x - dx, p.y + dy)),
      Object.values(Kartograf.unproject(p.x + dx, p.y - dy)),
    ];
    dirty = true;
    stopTool();
    previewOverlay();
  }
}
function previewEditing() {
  const r = { ...editing, id: editing.id || -1 };
  estates.setFeatures([
    ...filtered()
      .filter((x) => x.id !== r.id && hasLocation(x))
      .map((x) => feature(x, recordGeometry(x))),
    ...(editing.geometry || editing.lat != null
      ? [feature(r, editing.geometry)]
      : []),
  ]);
  estates.setSelected(r.id);
}
function drawPreview() {
  const g =
    drawPoints.length > 2
      ? { type: "Polygon", coordinates: [[...drawPoints, drawPoints[0]]] }
      : null;
  if (g) {
    const r = { id: -999 };
    estates.setFeatures([
      ...filtered()
        .filter(hasLocation)
        .map((x) => feature(x, recordGeometry(x))),
      { ...feature(r, g), color: "#315d42" },
    ]);
  }
  vertices.innerHTML = "";
  drawPoints.forEach((p) => {
    const q = map.latLngToContainerPoint([p[1], p[0]]),
      dot = document.createElement("span");
    dot.className = "vertex-handle";
    dot.style.left = q.x + "px";
    dot.style.top = q.y + "px";
    vertices.append(dot);
  });
}
function positionVertices() {
  if (tool === "draw") {
    drawPreview();
    return;
  }
  if (tool !== "vertices" || !editing?.geometry) return;
  vertices.innerHTML = "";
  for (const ring of rings(editing.geometry)) {
    ring.slice(0, -1).forEach((p, i) => {
      const q = map.latLngToContainerPoint([p[1], p[0]]),
        dot = document.createElement("span");
      dot.className = "vertex-handle";
      dot.style.left = q.x + "px";
      dot.style.top = q.y + "px";
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-label", "Переместить вершину " + (i + 1));
      dot.onpointerdown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        dot.setPointerCapture(e.pointerId);
        dot.onpointermove = (ev) => {
          const rect = $("adminMap").getBoundingClientRect(),
            ll = map.containerPointToLatLng({
              x: ev.clientX - rect.left,
              y: ev.clientY - rect.top,
            });
          ring[i] = [ll.lng, ll.lat];
          if (i === 0) ring[ring.length - 1] = ring[0].slice();
          dirty = true;
          previewEditing();
          const at = map.latLngToContainerPoint([ll.lat, ll.lng]);
          dot.style.left = at.x + "px";
          dot.style.top = at.y + "px";
        };
        dot.onpointerup = () => {
          dot.onpointermove = null;
          positionVertices();
        };
      };
      vertices.append(dot);
    });
  }
}
function previewOverlay() {
  if (overlayPreview) map.removeLayer(overlayPreview);
  overlayPreview = new Kartograf.ImageOverlay(
    overlayDraft.fileUrl,
    overlayDraft.bounds,
    { ...overlayDraft, visible: true, zIndex: 200 },
  );
  map.addLayer(overlayPreview);
}
function openOverlay(o) {
  if (!setView("map")) return;
  closeInspector();
  overlayDraft = structuredClone(o);
  dirty = false;
  $("emptyMap").hidden = true;
  $("inspector").hidden = false;
  $("inspector").innerHTML =
    `<div class="inspector-head"><div><p class="eyebrow">ИСТОРИЧЕСКИЙ ПЛАН</p><h2>Размещение карты</h2></div><button id="closeInspector" class="close-button">×</button></div><form id="overlayForm" class="record-form">${field("name", "Название", o.name)}<div class="overlay-media-tools"><button type="button" id="replaceOverlayImage" class="secondary">Заменить изображение</button><a id="downloadOverlayImage" class="text-button" href="${esc(imageDownloadUrl(o))}" download>Скачать PNG</a><small>Изображение можно заменить, сохранив его место на карте.</small></div><p class="layer-preview-note">Настройте план на карте. Обрезка скрывает края, сохраняя исходное изображение.</p><button type="button" id="moveOverlay" class="secondary">⌖ Указать центр на карте</button><div class="edit-controls"><button type="button" class="secondary" id="overlaySmaller">− Уменьшить</button><button type="button" class="secondary" id="overlayLarger">＋ Увеличить</button></div><div class="overlay-sliders"><label>Поворот <output id="rotationValue">${Math.round(o.rotation || 0)}°</output><input name="rotation" type="range" min="-180" max="180" step=".1" value="${o.rotation || 0}"></label><label>Прозрачность <output id="opacityValue">${Math.round(o.opacity * 100)}%</output><input name="opacity" type="range" min="0" max="100" value="${o.opacity * 100}"></label>${["Слева", "Сверху", "Справа", "Снизу"].map((n, i) => `<label>Обрезать ${n.toLowerCase()} <output id="cropValue${i}">${Math.round((o.crop?.[i] || 0) * 100)}%</output><input name="crop${i}" type="range" min="0" max="45" value="${(o.crop?.[i] || 0) * 100}"></label>`).join("")}</div><label class="check-label"><input name="visible" type="checkbox" ${o.visible ? "checked" : ""}> Показывать на сайте</label></form><div class="form-actions"><button id="saveOverlay" class="primary">Сохранить размещение</button>${o.id ? '<button id="deleteOverlay" class="text-button">Удалить этот план</button>' : ""}</div>`;
  $("replaceOverlayImage").onclick = () => openImageReplacement(overlayDraft);
  $("closeInspector").onclick = closeInspector;
  $("overlayForm").oninput = () => {
    const f = new FormData($("overlayForm"));
    overlayDraft.name = f.get("name");
    overlayDraft.rotation = Number(f.get("rotation"));
    overlayDraft.opacity = Number(f.get("opacity")) / 100;
    overlayDraft.crop = [0, 1, 2, 3].map(
      (i) => Number(f.get("crop" + i)) / 100,
    );
    overlayDraft.visible = f.has("visible");
    dirty = true;
    $("rotationValue").textContent = overlayDraft.rotation + "°";
    $("opacityValue").textContent =
      Math.round(overlayDraft.opacity * 100) + "%";
    overlayDraft.crop.forEach(
      (v, i) => ($("cropValue" + i).textContent = Math.round(v * 100) + "%"),
    );
    previewOverlay();
  };
  $("overlayForm").onsubmit = (e) => {
    e.preventDefault();
    $("saveOverlay").click();
  };
  $("moveOverlay").onclick = () => {
    tool = "overlay";
    $("adminMap").classList.add("drawing-map");
    estates.interactive = false;
    hint(
      "Нажмите там, где должен быть центр изображения.",
      '<button id="cancelTool">Отмена</button>',
    );
    $("cancelTool").onclick = stopTool;
  };
  function scale(f) {
    const b = overlayDraft.bounds,
      a = Kartograf.project(...b[0]),
      c = Kartograf.project(...b[1]),
      cx = (a.x + c.x) / 2,
      cy = (a.y + c.y) / 2;
    overlayDraft.bounds = [
      [
        ...Object.values(
          Kartograf.unproject(cx + (a.x - cx) * f, cy + (a.y - cy) * f),
        ),
      ],
      [
        ...Object.values(
          Kartograf.unproject(cx + (c.x - cx) * f, cy + (c.y - cy) * f),
        ),
      ],
    ];
    dirty = true;
    previewOverlay();
  }
  $("overlaySmaller").onclick = () => scale(0.9);
  $("overlayLarger").onclick = () => scale(1.1);
  $("saveOverlay").onclick = action(async () => {
    await api("/overlays" + (o.id ? "/" + o.id : ""), {
      method: o.id ? "PATCH" : "POST",
      body: JSON.stringify(overlayDraft),
    });
    dirty = false;
    closeInspector();
    await refresh();
    setView("layers");
    toast("Размещение плана сохранено.");
  });
  if ($("deleteOverlay"))
    $("deleteOverlay").onclick = action(async () => {
      if (
        !(await confirmAction(
          "Удалить план?",
          "План исчезнет из рабочей карты.",
          "Удалить",
        ))
      )
        return;
      await api("/overlays/" + o.id, { method: "DELETE" });
      dirty = false;
      closeInspector();
      await refresh();
      setView("layers");
    });
  requestAnimationFrame(() => {
    map.invalidateSize();
    map.fitBounds(o.bounds, { padding: [60, 60], maxZoom: 17, animate: false });
    previewOverlay();
  });
}
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " Б";
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + " КБ";
  return bytes >= 1024 ** 3
    ? (bytes / 1024 ** 3).toFixed(2) + " ГБ"
    : (bytes / 1024 ** 2).toFixed(1) + " МБ";
}
function basename(name) {
  return name.split(/[\\/]/).pop();
}
function renderFileQueue() {
  $("fileSelection").hidden = !files.length && !ignoredFiles.length;
  const bytes = files.reduce((n, f) => n + f.size, 0),
    pending = files.filter((f) => f.file && !f.id);
  $("fileSelection").innerHTML =
    `<div class="file-queue-heading"><strong>${files.length} файлов · ${formatBytes(bytes)}</strong><span>${files.filter((f) => f.id).length} на сервере · ${pending.length} ожидают загрузки</span></div><p class="small-text muted">Добавляйте файлы порциями. Преобразование начнётся только по кнопке «Собрать карту».</p><div class="file-queue"><table><thead><tr><th>Файл</th><th>Назначение</th><th>Размер</th><th>Состояние</th><th></th></tr></thead><tbody>${files.map((f) => `<tr><td title="${esc(f.name)}">${esc(basename(f.name))}</td><td>${esc(fileKind(f.name)?.label || "Файл")}</td><td>${formatBytes(f.size)}</td><td>${esc(f.error || f.status || (f.id ? "Загружен" : "Ожидает"))}</td><td><button data-remove-file="${f.clientId || f.id}" class="text-button" ${uploading ? "disabled" : ""} aria-label="Убрать ${esc(basename(f.name))}">×</button></td></tr>`).join("")}</tbody></table></div>${ignoredFiles.length ? `<details class="ignored-files"><summary>Не используются: ${ignoredFiles.length}</summary>${ignoredFiles.map((f) => `<p><strong>${esc(basename(f.name))}</strong> — ${esc(f.reason)}</p>`).join("")}</details>` : ""}`;
  $("uploadFilesButton").disabled = uploading || !pending.length;
  $("analyzeButton").disabled = uploading || !files.length;
}
function selectFiles(input) {
  for (const file of input) {
    const name = file.webkitRelativePath || file.name;
    if (!fileKind(name)) {
      if (!ignoredFiles.some((f) => f.name === name))
        ignoredFiles.push({ name, reason: ignoredReason(name) });
      continue;
    }
    if (
      files.some(
        (f) =>
          basename(f.name).toLowerCase() === basename(name).toLowerCase() &&
          f.size === file.size,
      )
    )
      continue;
    files.push({ clientId: crypto.randomUUID(), name, size: file.size, file });
  }
  renderFileQueue();
}
async function ensureBatch() {
  if (batchId) return;
  const b = await api("/batches", {
    method: "POST",
    body: JSON.stringify({ settlementName: $("importSettlement").value }),
  });
  batchId = b.id;
  localStorage.setItem("gis-import-batch", batchId);
}
async function uploadPending() {
  uploading = true;
  renderFileQueue();
  try {
    await ensureBatch();
    const pending = files.filter((f) => f.file && !f.id);
    for (const item of pending) {
      item.error = null;
      item.status = "Загружается…";
      renderFileQueue();
      $("processingText").textContent = "Загружаем " + basename(item.name);
      try {
        const result = await api("/batches/" + batchId + "/files", {
          method: "POST",
          raw: true,
          body: item.file,
          headers: { "X-File-Name": encodeURIComponent(item.name) },
        });
        const localPending = files.filter((f) => f !== item && f.file && !f.id);
        files = [...result.files, ...localPending];
        ignoredFiles = [
          ...ignoredFiles,
          ...(result.ignored || []).filter(
            (f) => !ignoredFiles.some((x) => x.name === f.name),
          ),
        ];
      } catch (e) {
        item.status = null;
        item.error = e.message;
        throw e;
      }
    }
  } finally {
    uploading = false;
    renderFileQueue();
  }
}
async function resumeImport() {
  const saved =
    localStorage.getItem("gis-import-batch") ||
    (await api("/batches").catch(() => []))[0]?.id;
  if (!saved) return;
  try {
    const b = await api("/batches/" + saved);
    if (b.status === "applied") {
      localStorage.removeItem("gis-import-batch");
      return;
    }
    batchId = b.id;
    files = b.files;
    ignoredFiles = b.ignored || [];
    $("importSettlement").value = b.settlementName || "";
    renderFileQueue();
    setView("import");
    if (b.status === "ready") showReview(b.result);
    else if (b.status === "analyzing") {
      stage("processing");
      pollBatch();
    }
  } catch {
    localStorage.removeItem("gis-import-batch");
  }
}
async function entryFiles(entry) {
  if (entry.isFile)
    return [
      await new Promise((resolve, reject) => entry.file(resolve, reject)),
    ];
  if (entry.isDirectory) {
    const reader = entry.createReader();
    let all = [],
      part;
    do {
      part = await new Promise((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      all.push(...part);
    } while (part.length);
    const result = [];
    for (const e of all) result.push(...(await entryFiles(e)));
    return result;
  }
  return [];
}
function stage(name) {
  for (const s of ["upload", "processing", "review"])
    $(s + "Stage").hidden = s !== name;
  $("step1").classList.toggle("current", name === "upload");
  $("step2").classList.toggle(
    "current",
    name === "review" || name === "processing",
  );
  $("step3").classList.toggle("current", false);
}
async function analyze() {
  stage("processing");
  $("uploadProgress").removeAttribute("value");
  try {
    await uploadPending();
    await api("/batches/" + batchId + "/analyze", {
      method: "POST",
      body: JSON.stringify({ settlementName: $("importSettlement").value }),
    });
    pollBatch();
  } catch (e) {
    stage("upload");
    throw e;
  }
}
async function pollBatch() {
  try {
    const b = await api("/batches/" + batchId);
    $("processingText").textContent = b.progress || "Проверяем данные…";
    if (b.status === "error") throw new Error(b.error);
    if (b.status === "ready") {
      showReview(b.result);
      return;
    }
    if (b.status === "uploading") {
      files = b.files;
      renderFileQueue();
      stage("upload");
      toast(
        "Проверка была прервана. Файлы сохранены — нажмите «Собрать карту» ещё раз.",
        true,
      );
      return;
    }
    pollTimer = setTimeout(pollBatch, 900);
  } catch (e) {
    stage("upload");
    if (batchId)
      await api("/batches/" + batchId + "/reopen", { method: "POST" }).catch(
        () => {},
      );
    toast(e.message, true);
  }
}
function showReview(r) {
  stage("review");
  reviewResult = r;
  planSelection = new Set(
    r.selectedPlanIds ||
      r.overlays.filter((o) => o.included !== false).map((o) => o.sourceFileId),
  );
  renderReviewPlanList();
  $("reviewTitle").textContent =
    r.settlements.map((s) => s.name).join(", ") +
    " · " +
    r.summary.records +
    " усадьбы";
  $("joinDescription").textContent = r.joinDescription;
  $("reviewSummary").innerHTML = [
    ["Записей в таблице", r.summary.records],
    ["Усадеб с контуром", r.summary.plots],
    ["Исторических планов", r.summary.overlays],
    ["Планов выбрано", planSelection.size],
    ["Без контура", r.summary.unmatched],
  ]
    .map(
      ([k, v]) =>
        `<div class="summary-row"><span>${k}</span><strong${k === "Планов выбрано" ? ' id="selectedPlanCount"' : k === "Исторических планов" ? ' id="foundPlanCount"' : ""}>${v}</strong></div>`,
    )
    .join("");
  $("reviewWarnings").innerHTML = r.warnings.length
    ? r.warnings
        .map(
          (w) =>
            `<button class="warning-item ${w.severity === "info" ? "info" : ""}" data-warning="${esc(w.recordNum || "")}">${esc(w.message)}</button>`,
        )
        .join("")
    : '<p class="muted small-text">Всё сошлось. Все усадьбы нашли своё место.</p>';
  $("conflictOptions").hidden = !r.conflicts?.length;
  $("overwriteEdits").checked = false;
  $("replaceScope").checked = false;
  if (!reviewMap) {
    reviewMap = createMap("reviewMap");
    reviewFeatures = new Kartograf.FeatureLayer();
    reviewMap.addLayer(reviewFeatures);
    reviewFeatures.on("click", (e) =>
      toast(
        "Усадьба " +
          e.feature.data.num +
          " · " +
          [e.feature.data.surname, e.feature.data.name]
            .filter(Boolean)
            .join(" "),
      ),
    );
  }
  renderReviewPlanMap();
  const list = r.plots.map((p, i) => {
    const rec = r.records.find(
      (x) => x.settlementId + ":" + x.num === p.recordKey,
    );
    return feature({ ...rec, id: i }, p.geometry);
  });
  reviewFeatures.setFeatures(list);
  requestAnimationFrame(() => {
    reviewMap.invalidateSize();
    const b = reviewFeatures.getBounds();
    if (b.isValid())
      reviewMap.fitBounds(b, {
        padding: [35, 35],
        maxZoom: 16,
        animate: false,
      });
  });
  $("reviewWarnings").onclick = (e) => {
    const button = e.target.closest("[data-warning]");
    if (!button) return;
    const p = r.plots.find((p) => p.legacyKey === button.dataset.warning);
    if (p)
      reviewMap.fitBounds(bounds(p.geometry), {
        padding: [60, 60],
        maxZoom: 18,
      });
    else
      toast(
        "У усадьбы " +
          button.dataset.warning +
          " нет контура. Укажите место после добавления набора.",
      );
  };
}
function renderReviewPlanList() {
  if (!reviewResult) return;
  if ($("selectedPlanCount"))
    $("selectedPlanCount").textContent = planSelection.size;
  if ($("foundPlanCount"))
    $("foundPlanCount").textContent = reviewResult.overlays.length;
  $("reviewPlanList").innerHTML = reviewResult.overlays.length
    ? reviewResult.overlays
        .map(
          (o) =>
            `<article class="review-plan-card"><label><input type="checkbox" data-review-plan="${o.sourceFileId}" ${planSelection.has(o.sourceFileId) ? "checked" : ""}>Добавить в набор</label><button class="review-plan-image" data-preview-plan="${o.sourceFileId}" aria-label="Посмотреть ${esc(o.name)} на карте"><img src="${esc(o.fileUrl)}" alt="${esc(o.name)}" loading="lazy"></button><strong>${esc(o.name)}</strong><small>${o.georeferenced ? "Есть геопривязка · без обрезки" : "Размещение вручную · без обрезки"}</small><div><button class="text-button" data-preview-plan="${o.sourceFileId}">Посмотреть на карте</button><button class="text-button" data-replace-plan="${o.sourceFileId}">Заменить изображение</button><a class="text-button" href="${esc(imageDownloadUrl(o))}" download>Скачать PNG</a><button class="text-button danger-text" data-delete-plan="${o.sourceFileId}" aria-label="Удалить план ${esc(o.name)}">Удалить</button></div></article>`,
        )
        .join("")
    : '<p class="muted">В наборе нет изображений планов. Их можно добавить позже.</p>';
  $("deleteUnselectedPlans").disabled = !reviewResult.overlays.some(
    (o) => !planSelection.has(o.sourceFileId),
  );
}
function renderReviewPlanMap(isolatedId = null) {
  if (!reviewMap || !reviewResult) return;
  reviewPlans.forEach((l) => reviewMap.removeLayer(l));
  const selected = reviewResult.overlays.filter((o) =>
    isolatedId
      ? o.sourceFileId === isolatedId
      : planSelection.has(o.sourceFileId),
  );
  reviewPlans = selected.map(
    (o) =>
      new Kartograf.ImageOverlay(o.fileUrl, o.bounds, {
        opacity: isolatedId ? 0.8 : 0.5,
        rotation: o.rotation,
        crop: o.crop,
        zIndex: 100,
      }),
  );
  reviewPlans.forEach((l) => reviewMap.addLayer(l));
  if (isolatedId) {
    const plan = selected[0];
    if (plan) {
      reviewMap.fitBounds(plan.bounds, {
        padding: [30, 30],
        maxZoom: 17,
        animate: false,
      });
      $("reviewPlanNote").textContent =
        `Открыт план «${plan.name}». ${plan.placementNote || "Географическое положение прочитано из файла. Изображение показано целиком."}`;
      $("reviewPlanNote").hidden = false;
    }
  } else {
    $("reviewPlanNote").hidden = true;
    const b = reviewFeatures.getBounds();
    if (b.isValid())
      reviewMap.fitBounds(b, {
        padding: [35, 35],
        maxZoom: 16,
        animate: false,
      });
  }
}
async function deleteReviewPlans(ids) {
  let response;
  for (const id of ids)
    response = await api("/batches/" + batchId + "/plans/" + id, {
      method: "DELETE",
    });
  if (response) {
    reviewResult = response.result;
    files = response.files;
    for (const id of ids) planSelection.delete(id);
    renderReviewPlanList();
    renderReviewPlanMap();
    toast(`Удалено планов: ${ids.length}. Исходники на компьютере сохранены.`);
  }
}
$("reviewPlanList").onchange = async (event) => {
  const checkbox = event.target.closest("[data-review-plan]");
  if (!checkbox) return;
  if (checkbox.checked) planSelection.add(checkbox.dataset.reviewPlan);
  else planSelection.delete(checkbox.dataset.reviewPlan);
  renderReviewPlanList();
  renderReviewPlanMap();
  try {
    await api("/batches/" + batchId + "/selection", {
      method: "PATCH",
      body: JSON.stringify({ planIds: [...planSelection] }),
      keepalive: true,
    });
  } catch (error) {
    toast("Не удалось сохранить выбор планов: " + error.message, true);
  }
};
$("reviewPlanList").onclick = action(async (event) => {
  const replace = event.target.closest("[data-replace-plan]");
  if (replace) {
    openImageReplacement(
      reviewResult.overlays.find(
        (o) => o.sourceFileId === replace.dataset.replacePlan,
      ),
      true,
    );
    return;
  }
  const preview = event.target.closest("[data-preview-plan]");
  if (preview) {
    renderReviewPlanMap(preview.dataset.previewPlan);
    $("reviewMap").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const remove = event.target.closest("[data-delete-plan]");
  if (remove) await deleteReviewPlans([remove.dataset.deletePlan]);
});
$("showAllReviewPlans").onclick = () => renderReviewPlanMap();
$("deleteUnselectedPlans").onclick = action(async () => {
  const ids = reviewResult.overlays
    .filter((o) => !planSelection.has(o.sourceFileId))
    .map((o) => o.sourceFileId);
  if (
    ids.length &&
    (await confirmAction(
      "Удалить невыбранные планы?",
      `Будет удалено ${ids.length} загруженных изображений. Исходная папка на компьютере останется без изменений.`,
      "Удалить из набора",
    ))
  )
    await deleteReviewPlans(ids);
});
$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ key: $("key").value }),
    });
    $("key").value = "";
    await boot();
  } catch (error) {
    $("loginError").textContent =
      error.message === "INVALID_KEY"
        ? "Неверный ключ доступа."
        : error.message;
  }
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) setView(b.dataset.view);
});
$("recordList").onclick = (e) => {
  const b = e.target.closest("[data-record]");
  if (b) openRecord(Number(b.dataset.record));
};
$("search").oninput = renderRecords;
$("settlement").onchange = () => {
  renderRecords();
  fit();
};
$("issuesFilter").onclick = $("showIssues").onclick = () => {
  issuesOnly = !issuesOnly;
  setView("map");
  renderRecords();
};
$("fitMap").onclick = fit;
$("togglePlans").onclick = () => {
  plansOn = !plansOn;
  renderPlans();
};
$("newRecord").onclick = () => {
  if (!data.settlements.length) {
    toast("Сначала загрузите набор с поселением.", true);
    setView("import");
    return;
  }
  openRecord(null);
};
$("chooseFolder").onclick = (e) => {
  e.stopPropagation();
  $("folderInput").click();
};
$("chooseFiles").onclick = (e) => {
  e.stopPropagation();
  $("filesInput").click();
};
$("dropZone").onclick = (e) => {
  if (!e.target.closest("button")) $("folderInput").click();
};
$("dropZone").onkeydown = (e) => {
  if (e.key === "Enter" && e.target === $("dropZone")) $("folderInput").click();
};
$("folderInput").onchange = (e) => selectFiles(e.target.files);
$("filesInput").onchange = (e) => selectFiles(e.target.files);
$("dropZone").ondragover = (e) => {
  e.preventDefault();
  $("dropZone").classList.add("dragover");
};
$("dropZone").ondragleave = () => $("dropZone").classList.remove("dragover");
$("dropZone").ondrop = action(async (e) => {
  e.preventDefault();
  $("dropZone").classList.remove("dragover");
  const entries = [...e.dataTransfer.items]
    .map((x) => x.webkitGetAsEntry?.())
    .filter(Boolean);
  if (entries.length) {
    const selected = [];
    for (const entry of entries) selected.push(...(await entryFiles(entry)));
    selectFiles(selected);
  } else selectFiles(e.dataTransfer.files);
});
$("analyzeButton").onclick = action(analyze);
$("uploadFilesButton").onclick = action(async () => {
  await uploadPending();
  toast("Файлы загружены. Можно добавить ещё или собрать карту.");
});
$("fileSelection").onclick = action(async (event) => {
  const button = event.target.closest("[data-remove-file]");
  if (!button || uploading) return;
  const item = files.find(
    (f) => (f.clientId || f.id) === button.dataset.removeFile,
  );
  if (!item) return;
  if (item.id)
    await api("/batches/" + batchId + "/files/" + item.id, {
      method: "DELETE",
    });
  files = files.filter((f) => f !== item);
  renderFileQueue();
});
$("restartImport").onclick = action(async () => {
  clearTimeout(pollTimer);
  if (batchId) await api("/batches/" + batchId + "/reopen", { method: "POST" });
  stage("upload");
  renderFileQueue();
});
$("applyButton").onclick = action(async () => {
  const result = await api("/batches/" + batchId + "/apply", {
    method: "POST",
    body: JSON.stringify({
      mode: $("replaceScope").checked ? "replace" : "merge",
      overwrite: $("overwriteEdits").checked,
      planIds: [...planSelection],
    }),
  });
  await refresh({ fitMap: true });
  setView("map");
  stage("upload");
  files = [];
  ignoredFiles = [];
  batchId = null;
  localStorage.removeItem("gis-import-batch");
  renderFileQueue();
  $("fileSelection").hidden = true;
  $("analyzeButton").disabled = true;
  toast(
    `Добавлено: ${result.created}. Обновлено: ${result.updated}. Ручных правок сохранено: ${result.kept}.`,
  );
});
$("layerGrid").onclick = (e) => {
  const b = e.target.closest("[data-layer]");
  if (b)
    openOverlay(data.overlays.find((o) => o.id === Number(b.dataset.layer)));
};
$("layerGrid").onchange = action(async (e) => {
  const b = e.target.closest("[data-layer-toggle]");
  if (!b) return;
  await api("/overlays/" + b.dataset.layerToggle, {
    method: "PATCH",
    body: JSON.stringify({ visible: b.checked }),
  });
  await refresh();
});
$("addImage").onclick = () => $("imageInput").click();
$("imageInput").onchange = action(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  toast("Готовим изображение…");
  const image = await api("/image", { method: "POST", raw: true, body: file });
  const c = map.getCenter(),
    center = Kartograf.project(c.lat, c.lng);
  const halfWidth = (map.W * 0.3) / map.worldSize,
    halfHeight = (halfWidth * image.height) / image.width;
  const sw = Kartograf.unproject(center.x - halfWidth, center.y + halfHeight),
    ne = Kartograf.unproject(center.x + halfWidth, center.y - halfHeight);
  const b = [
    [sw.lat, sw.lng],
    [ne.lat, ne.lng],
  ];
  openOverlay({
    name: file.name.replace(/\.[^.]+$/, ""),
    fileUrl: image.fileUrl,
    bounds: b,
    opacity: 0.6,
    rotation: 0,
    crop: [0, 0, 0, 0],
    visible: true,
  });
  e.target.value = "";
});
$("publishButton").onclick = action(async () => {
  if (dirty)
    throw new Error("Сначала сохраните изменения в открытой карточке.");
  if (
    !(await confirmAction(
      "Опубликовать карту?",
      "Посетители увидят текущие усадьбы, их данные и исторические планы. Предыдущая версия останется в истории.",
      "Опубликовать",
      true,
    ))
  )
    return;
  const r = await api("/publish", {
    method: "POST",
    body: JSON.stringify({ note: $("releaseNote").value }),
  });
  await refresh();
  toast("На сайте опубликована версия №" + r.id);
});
$("resetButton").onclick = action(async () => {
  if (!canLeave()) return;
  if (
    !(await confirmAction(
      "Начать с чистой карты?",
      "Текущие усадьбы и исторические слои будут убраны с карты и сайта. Перед очисткой автоматически сохраним резервную копию. Опубликованные версии останутся в истории.",
      "Очистить карту",
    ))
  )
    return;
  await api("/reset", { method: "POST" });
  dirty = false;
  closeInspector();
  await refresh();
  setView("map");
  toast("Карта очищена. Резервная копия сохранена.");
});
$("releaseList").onclick = action(async (e) => {
  const b = e.target.closest("[data-restore]");
  if (!b) return;
  if (!canLeave()) return;
  if (
    !(await confirmAction(
      "Вернуть версию №" + b.dataset.restore + "?",
      "Рабочая карта и сайт вернутся к этой публикации. Текущие данные сохраним в резервной копии.",
      "Восстановить",
    ))
  )
    return;
  await api("/restore/" + b.dataset.restore, { method: "POST" });
  await refresh({ fitMap: true });
  toast("Версия восстановлена и опубликована.");
});
$("logout").onclick = action(async () => {
  if (!canLeave()) return;
  await api("/api/admin/logout", { method: "POST" });
  location.reload();
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && tool) {
    stopTool();
    renderRecords();
  }
});
boot().catch((e) => {
  $("loginError").textContent = e.message;
  toast(e.message, true);
});

$("mobileMenu").onclick = () => {
  const expanded = document
    .querySelector(".sidebar")
    .classList.toggle("expanded");
  $("mobileMenu").setAttribute("aria-expanded", String(expanded));
};
