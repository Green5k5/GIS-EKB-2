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
