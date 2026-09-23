// js/glossary-map.js

// Карта соответствия между терминами глоссария и фильтрами
// Термины, которых нет в этом объекте, НЕ будут вести на карту
const GLOSSARY_FILTER_MAP = {
    // ===== СОСЛОВНО-ПРОФЕССИОНАЛЬНЫЕ ГРУППЫ (из скрина) =====
    "Мастеровые": { filterKey: "soslovie", filterValue: "Мастеровые" },
    "Мещане": { filterKey: "soslovie", filterValue: "Мещане" },
    "Солдаты": { filterKey: "soslovie", filterValue: "Солдаты" },
    "Купцы": { filterKey: "soslovie", filterValue: "Купцы" },
    "Непременные работники": { filterKey: "soslovie", filterValue: "Непременные работники" },
    "Дворяне": { filterKey: "soslovie", filterValue: "Дворяне" },
    "Канцелярские служители": { filterKey: "soslovie", filterValue: "Канцелярские служители" },
    "Младшие офицеры": { filterKey: "soslovie", filterValue: "Младшие офицеры" },
    "Крестьяне": { filterKey: "soslovie", filterValue: "Крестьяне" },
    "Горнозаводские служители": { filterKey: "soslovie", filterValue: "Горнозаводские служители" },
    "Старшие офицеры": { filterKey: "soslovie", filterValue: "Старшие офицеры" },
    "Священнослужители": { filterKey: "soslovie", filterValue: "Священнослужители" },
    "Работные люди": { filterKey: "soslovie", filterValue: "Работные люди" },
    "Церковнослужители": { filterKey: "soslovie", filterValue: "Церковнослужители" },
    "Медицинские работники": { filterKey: "soslovie", filterValue: "Медицинские работники" },
    "Несчастные": { filterKey: "soslovie", filterValue: "Несчастные" },
    "Именитые граждане": { filterKey: "soslovie", filterValue: "Именитые граждане" },
    "Казаки": { filterKey: "soslovie", filterValue: "Казаки" },
    "Отпущенники": { filterKey: "soslovie", filterValue: "Отпущенники" },
    
    // ===== ТИП ПОСТРОЙКИ (из скрина) =====
    "Дом деревянный": { filterKey: "buildingType", filterValue: "Дом деревянный" },
    "Обывательский дом": { filterKey: "buildingType", filterValue: "Обывательский дом" },
    "Огород": { filterKey: "buildingType", filterValue: "Огород" },
    "Дом каменный": { filterKey: "buildingType", filterValue: "Дом каменный" },
    "Казённый дом": { filterKey: "buildingType", filterValue: "Казённый дом" },
    
    // ===== СЕМЕЙНОЕ ПОЛОЖЕНИЕ (из скрина) =====
    "Вдова": { filterKey: "familyStatus", filterValue: "Вдова" },
    "Жена": { filterKey: "familyStatus", filterValue: "Жена" },
    "Дочь": { filterKey: "familyStatus", filterValue: "Дочь" },
    "Девица": { filterKey: "familyStatus", filterValue: "Девица" },
    
    // ===== МЕСТО ПРИПИСКИ (из скрина) =====
    "Екатеринбургская волость": { filterKey: "registrationPlace", filterValue: "Екатеринбургская волость" },
    "Шарташский участок": { filterKey: "registrationPlace", filterValue: "Шарташский участок" },
    "Камышлов": { filterKey: "registrationPlace", filterValue: "Камышлов" },
    "Камышловская волость": { filterKey: "registrationPlace", filterValue: "Камышловская волость" },
    "Шарташская волость": { filterKey: "registrationPlace", filterValue: "Шарташская волость" },
    "Арамашевская волость": { filterKey: "registrationPlace", filterValue: "Арамашевская волость" },
    "Березовский": { filterKey: "registrationPlace", filterValue: "Березовский" },
    "Березовский завод": { filterKey: "registrationPlace", filterValue: "Березовский завод" },
    "Вольск": { filterKey: "registrationPlace", filterValue: "Вольск" },
    
    // ===== МЕСТО СЛУЖБЫ (из скрина) =====
    "Екатеринбургский монетный двор": { filterKey: "servicePlace", filterValue: "Екатеринбургский монетный двор" },
    "Екатеринбургская горная команда": { filterKey: "servicePlace", filterValue: "Екатеринбургская горная команда" },
    "Екатеринбургская гранильная фабрика": { filterKey: "servicePlace", filterValue: "Екатеринбургская гранильная фабрика и Горнощитский мраморный завод" },
    "Екатеринбургский завод": { filterKey: "servicePlace", filterValue: "Екатеринбургский завод" },
    "Екатеринбургская штатная команда": { filterKey: "servicePlace", filterValue: "Екатеринбургская штатная команда" },
    "Главная контора Екатеринбургских заводов": { filterKey: "servicePlace", filterValue: "Главная контора Екатеринбургских заводов" },
    "Екатеринбургская золотопромывальная фабрика": { filterKey: "servicePlace", filterValue: "Екатеринбургская золотопромывальная фабрика" },
    "Богоявленская кафедральная соборная церковь": { filterKey: "servicePlace", filterValue: "Богоявленская кафедральная соборная церковь" },
    "Екатеринбургская заводская чертежная": { filterKey: "servicePlace", filterValue: "Екатеринбургская заводская чертежная" },
    "Екатеринбургская заводская команда": { filterKey: "servicePlace", filterValue: "Екатеринбургская заводская команда" },
    "Екатеринбургское уездное казначейство": { filterKey: "servicePlace", filterValue: "Екатеринбургское уездное казначейство" },
    "Бывший Екатеринбургский мушкетерский полк": { filterKey: "servicePlace", filterValue: "Бывший Екатеринбургский мушкетерский полк" },
    "Богословские заводы": { filterKey: "servicePlace", filterValue: "Богословские заводы" },
    "Нижне-Исетский завод": { filterKey: "servicePlace", filterValue: "Нижне-Исетский завод" },
    "Екатеринбургское горное начальство": { filterKey: "servicePlace", filterValue: "Екатеринбургское горное начальство" },
    "Вознесенская церковь": { filterKey: "servicePlace", filterValue: "Вознесенская церковь" },
    "Екатеринбургская лаборатория": { filterKey: "servicePlace", filterValue: "Екатеринбургская лаборатория" },
    "Златоустовская церковь": { filterKey: "servicePlace", filterValue: "Златоустовская церковь" },
    "Екатеринбургский уездный суд": { filterKey: "servicePlace", filterValue: "Екатеринбургский уездный суд" },
    "Третья часть": { filterKey: "servicePlace", filterValue: "Третья часть" },
    "Екатеринбургское заводское казначейство": { filterKey: "servicePlace", filterValue: "Екатеринбургское заводское казначейство" },
    "Екатеринбургская управа благочиния": { filterKey: "servicePlace", filterValue: "Екатеринбургская управа благочиния" },
    "Верх-Исетский завод": { filterKey: "servicePlace", filterValue: "Верх-Исетский завод" },
    "Екатеринбургская заводская школа": { filterKey: "servicePlace", filterValue: "Екатеринбургская заводская школа" },
    "Тобольский гарнизон": { filterKey: "servicePlace", filterValue: "Тобольский гарнизон" },
    
    // ===== РОД СЛУЖБЫ =====
    "Гражданская": { filterKey: "serviceType", filterValue: "Гражданская" },
    "Военная": { filterKey: "serviceType", filterValue: "Военная" },
    "Горная": { filterKey: "serviceType", filterValue: "Горная" },
    
    // ===== ПОСЕЛЕНИЯ (для терминов из глоссария) =====
    "Нижне-Исетский завод": { filterKey: "settlement", filterValue: "Нижне-Исетск" },
    "Уктусский завод": { filterKey: "settlement", filterValue: "Уктус" },
    "Усадьба": { filterKey: "buildingType", filterValue: "Дом деревянный" },
};

// Функция для применения фильтра по клику на термин
function applyGlossaryFilter(term) {
    const mapping = GLOSSARY_FILTER_MAP[term];
    if (!mapping) return;

    // 1. Переключаемся на страницу карты
    const mapNavItem = document.querySelector('.nav-item[data-page="map"]');
    if (mapNavItem) {
        mapNavItem.click();
    }

    // 2. Применяем фильтр
    // Сначала сбрасываем все фильтры, чтобы не было конфликтов
    resetAllFilters();

    // Устанавливаем фильтр
    const { filterKey, filterValue } = mapping;
    if (state[filterKey]) {
        state[filterKey].add(filterValue);
    }

    // 3. Обновляем интерфейс и карту
    if (typeof renderFilters === 'function') renderFilters();
    if (typeof renderActiveTags === 'function') renderActiveTags();

    // Получаем отфильтрованные данные
    const filtered = getFiltered();
    if (typeof renderMap === 'function') renderMap(filtered);
    if (typeof updateStats === 'function') updateStats(filtered);

    // Убираем активную подсветку терминов в глоссарии
    document.querySelectorAll('.glossary-term-clickable').forEach(el => el.classList.remove('active-term'));
    // Подсвечиваем кликнутый термин
    const termElement = document.querySelector(`.glossary-term-clickable[data-term="${term}"]`);
    if (termElement) {
        termElement.classList.add('active-term');
        termElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    // Показываем кнопку сброса
    showGlossaryResetButton();
}

// Функция для очистки фильтра глоссария
function clearGlossaryFilter() {
    const activeTerm = document.querySelector('.glossary-term-clickable.active-term');
    if (activeTerm) {
        activeTerm.classList.remove('active-term');
    }
    // Сбрасываем фильтры
    resetAllFilters();
    // Скрываем кнопку сброса
    const btn = document.getElementById('glossary-reset-btn');
    if (btn) btn.style.display = 'none';
    // Обновляем карту
    if (typeof update === 'function') update();
}

// Функция для отображения кнопки сброса
function showGlossaryResetButton() {
    const btn = document.getElementById('glossary-reset-btn');
    if (btn) btn.style.display = 'block';
}
