// Онлайн-таблица
let tableOffset = 0;
let tableStep = 99999;
let currentCity = "";

// Загрузка всех строк таблицы
function loadAllRowsForFilter() {
  if (tableOffset >= allData.length) return;
  const tbody = document.getElementById("dsTableBody");
  if (!tbody) return;
  const end = allData.length;
  for (let i = tableOffset; i < end; i++) {
    const d = allData[i];
    const fn = [d.surname, d.name].filter(Boolean).join(" ") || "—";
    const tr = document.createElement("tr");
    tr.style.background = i % 2 === 0 ? "var(--white)" : "var(--bg)";
    tr.dataset.city = d.settlement || "";
    const displayNum = Math.round(parseFloat(d.num));
    tr.innerHTML = `
      <td>${esc(displayNum)}</td>
      <td>${esc(d.street)}</td>
      <td>${esc(d.buildingType)}</td>
      <td>${esc(fn)}</td>
      <td>${esc(d.soslovie || "—")}</td>
      <td>${esc(d.rank || "—")}</td>
      <td style="color:var(--accent)">${d.area_sazh ? d.area_sazh + " саж." : "—"}</td>
      <td>${esc(formatArchiveSource(d.source) || "—")}</td>
    `;
    tbody.appendChild(tr);
  }
  tableOffset = end;
  const info = document.getElementById("dsTableInfo");
  if (info) info.textContent = `Всего: ${allData.length} записей`;
}

// Фильтрация таблицы по городу
function filterTableByCity(city, event) {
  currentCity = city;
  document.querySelectorAll(".ds-tab").forEach(t => t.classList.remove("active"));
  if (event && event.target) event.target.classList.add("active");
  loadAllRowsForFilter();
  filterTable();
  if (city && typeof flyToSettlement === 'function') flyToSettlement(city);
}

// Фильтрация таблицы по тексту
function filterTable() {
  const q = document.getElementById("dsFilter")?.value.toLowerCase() || "";
  const rows = document.getElementById("dsTableBody")?.getElementsByTagName("tr") || [];
  let shown = 0;
  for (let i = 0; i < rows.length; i++) {
    const text = rows[i].textContent.toLowerCase();
    const cityMatch = !currentCity || rows[i].dataset.city === currentCity;
    const textMatch = !q || text.indexOf(q) !== -1;
    rows[i].style.display = (cityMatch && textMatch) ? "" : "none";
    if (cityMatch && textMatch) shown++;
  }
  const info = document.getElementById("dsTableInfo");
  if (info) info.textContent = `Найдено: ${shown} из ${allData.length}`;
}

// Инициализация таблицы
function initTable() {
  loadAllRowsForFilter();
  const filterInput = document.getElementById("dsFilter");
  if (filterInput) {
    filterInput.addEventListener("focus", loadAllRowsForFilter);
    filterInput.addEventListener("input", filterTable);
  }
}

let mapTableOpen = false;

function mapTableRowHtml(d) {
  const owner = [d.surname, d.name].filter(Boolean).join(" ") || "-";
  const area = d.area_sazh ? d.area_sazh + " саж." : "-";
  return `<tr tabindex="0" data-id="${esc(d.id)}">
    <td>${esc(d.settlement)}</td>
    <td>${esc(formatNum(d.num))}</td>
    <td>${esc(d.street)}</td>
    <td>${esc(d.buildingType)}</td>
    <td>${esc(owner)}</td>
    <td>${esc(d.soslovie || "-")}</td>
    <td>${esc(d.rank || "-")}</td>
    <td style="color:var(--accent)">${esc(area)}</td>
    <td>${esc(formatArchiveSource(d.source) || "-")}</td>
  </tr>`;
}

function renderMapTable(filtered) {
  if (!mapTableOpen) return;
  document.getElementById("mapTableBody").innerHTML = filtered.map(mapTableRowHtml).join("");
  document.getElementById("mapTableCount").textContent =
    `Показано: ${filtered.length.toLocaleString("ru-RU")} из ${allData.length.toLocaleString("ru-RU")}`;
}

function setMapTable(open) {
  mapTableOpen = open;
  document.getElementById("mapTablePanel").hidden = !open;
  document.getElementById("mapTableOpen").hidden = open;
  if (open) renderMapTable(getFiltered());
  if (window.map) window.map.invalidateSize();
}

function showMapTableRow(row) {
  if (!row) return;
  focusOnItem(Number(row.dataset.id));
}

function initMapTable() {
  document.getElementById("mapTableOpen").addEventListener("click", () => setMapTable(true));
  document.getElementById("mapTableClose").addEventListener("click", () => setMapTable(false));
  const body = document.getElementById("mapTableBody");
  body.addEventListener("click", e => showMapTableRow(e.target.closest("tr")));
  body.addEventListener("keydown", e => {
    if (e.key === "Enter") showMapTableRow(e.target.closest("tr"));
  });
}
