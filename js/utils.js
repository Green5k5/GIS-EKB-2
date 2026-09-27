// Вспомогательные функции

// Экранирование HTML
function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Единый формат архивного шифра для отображения в интерфейсе.
function formatArchiveSource(source) {
  const value = String(source || "").trim();
  if (!value) return "";
  return /^ГАСО(?:\.|\s)/i.test(value) ? value : `ГАСО. ${value}`;
}

function formatNum(num) {
  if (num === undefined || num === null || num === "") return "";
  const n = parseFloat(num);
  return Number.isNaN(n) ? String(num) : String(Math.round(n));
}

// Скачивание CSV
/* function downloadCSV(settlement) {
  let data = settlement ? allData.filter(d => d.settlement === settlement) : allData;
  const keys = ["id", "num", "settlement", "street", "buildingType", "surname", "name", "patronymic", "soslovie", "familyStatus", "sex", "serviceType", "rank", "position", "servicePlace", "registrationPlace", "area_sazh", "source", "scanUrl", "lat", "lng"];
  const headers = ["ID", "Номер", "Поселение", "Улица", "Тип постройки", "Фамилия", "Имя", "Отчество", "Сословие", "Семейное положение", "Пол", "Род службы", "Чин", "Должность", "Место службы", "Место приписки", "Площадь (саж.)", "Источник", "Скан", "Широта", "Долгота"];
  
  let csv = "\uFEFF" + headers.join(";") + "\n";
  data.forEach(d => {
    csv += keys.map(k => {
      let v = d[k] || "";
      return '"' + String(v).replace(/"/g, '""') + '"';
    }).join(";") + "\n";
  });
  
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (settlement || "full_dataset") + "_ekb_1809.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
} */

// Закрытие мобильного меню
function closeMobile() {
  const menu = document.getElementById("mobileMenu");
  if (menu) menu.classList.remove("show");
  if (menu) menu.setAttribute("aria-hidden", "true");
  const burger = document.getElementById("burgerBtn");
  if (burger) {
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-label", "Открыть меню");
  }
  document.body.classList.remove("mobile-menu-open");
  document.querySelectorAll(".page").forEach(page => page.removeAttribute("inert"));
}

// Очистка поиска
function clearSearch() {
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.value = "";
    // Закрываем выпадающий список результатов поиска
    if (typeof showSearchResults === 'function') showSearchResults("");
  }
  if (typeof update === 'function') update();
}

// Очистка всех фильтров
function clearAll() {
  if (typeof resetAllFilters === 'function') resetAllFilters();
  clearSearch();
  if (typeof update === 'function') update();
}

// Фокус на объекте
function focusOnItem(id) {
  const item = allData.find(d => d.id === id);
  if (!item || !item.lat || !item.lng) return;
  const mapPage = document.getElementById("page-map");
  const mapNav = document.querySelector('.nav-item[data-page="map"]');
  if (mapNav && mapPage && !mapPage.classList.contains("active")) mapNav.click();
  if (window.map && window.map.flyTo) {
    window.map.flyTo([item.lat, item.lng], 17, { duration: 1 });
  }
  if (typeof estateLayer !== "undefined" && estateLayer) estateLayer.setSelected(item.id);
  if (typeof showSelected === 'function') showSelected(item);
  
  const searchResults = document.getElementById("searchResults");
  if (searchResults) searchResults.className = "search-results";
  
  const sec = document.getElementById("selectedSection");
  if (sec) {
    const existing = sec.querySelector(".search-back");
    if (!existing) {
      const back = document.createElement("div");
      back.className = "search-back";
      back.textContent = "← Назад к результатам поиска";
      back.onclick = function() {
        sec.style.display = "none";
        const results = document.getElementById("searchResults");
        if (results) results.className = "search-results show";
      };
      sec.insertBefore(back, sec.firstChild);
    }
  }
}
// Поиск по ФИО: запрос разбивается на слова, каждое слово должно
// встретиться в имени/фамилии/отчестве. Работает по отдельным частям
// и не зависит от порядка слов: "Иван Петров" найдёт "Петров Иван".
function matchesSearch(item, query) {
  if (!query) return true;
  var full = ((item.surname || "") + " " +
              (item.name || "") + " " +
              (item.patronymic || "")).toLowerCase();
  var tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  for (var i = 0; i < tokens.length; i++) {
    if (full.indexOf(tokens[i]) === -1) return false;
  }
  return true;
}
