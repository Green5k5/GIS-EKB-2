// js/glossary.js
// Глоссарий: поиск и категории

const GLOSSARY_SOCIAL_CATEGORY = "Сословно-профессиональные группы";
const GLOSSARY_TOPOGRAPHY_CATEGORY = "Городская среда и топонимика";

const GLOSSARY_TERM_ALIASES = {
  "Купец": "Купцы",
  "Мастеровой": "Мастеровые",
  "Мещанин": "Мещане",
  "Непременный работник": "Непременные работники",
  "Солдат": "Солдаты"
};

const GLOSSARY_ADDITIONS = [
  { term: "Горнозаводские служители", category: GLOSSARY_SOCIAL_CATEGORY, description: "Административно-технические работники заводов, не имевшие офицерских чинов по Табели о рангах и занимавшие низшие должности." },
  { term: "Дворяне", category: GLOSSARY_SOCIAL_CATEGORY, description: "Привилегированное сословие российского общества, представленное на Урале преимущественно горным офицерством и чиновничеством." },
  { term: "Именитые граждане", category: GLOSSARY_SOCIAL_CATEGORY, description: "Привилегированная категория городского населения, представленная крупными торговцами и промышленниками. Введена Жалованной грамотой городам Екатерины II в 1785 г." },
  { term: "Казаки", category: GLOSSARY_SOCIAL_CATEGORY, description: "Военно-служилое сословие, занятое охраной пограничных территорий, несением гарнизонной и конвойной службы при заводах, на трактах и в городах." },
  { term: "Канцелярские служители", category: GLOSSARY_SOCIAL_CATEGORY, description: "Работники учреждений, ответственные за ведение делопроизводства и не имевшие классного чина по Табели о рангах." },
  { term: "Крестьяне", category: GLOSSARY_SOCIAL_CATEGORY, description: "Податное сословие российского общества. В заводских селениях Екатеринбургского уезда проживали преимущественно приписные крестьяне — государственные крестьяне, приписанные к заводам для отработки подушной подати." },
  { term: "Купцы", category: GLOSSARY_SOCIAL_CATEGORY, description: "Представители торгового сословия. В соответствии с размером объявленного капитала купцы делились на гильдии, принадлежность к которым определяла объём их торговых прав и привилегий. В Екатеринбурге купцы владели крупными усадьбами, нередко — с каменными домами." },
  { term: "Мастеровые", category: GLOSSARY_SOCIAL_CATEGORY, description: "Квалифицированные работники горных заводов. Относились к податному состоянию, но не входили в городские сословия. Крупнейшая категория владельцев усадеб Екатеринбурга и окрестных заводских селений." },
  { term: "Медицинские работники", category: GLOSSARY_SOCIAL_CATEGORY, description: "Служители Екатеринбургского военного госпиталя и частных аптек. К их числу относились доктора, лекари, подлекари и аптекарские ученики." },
  { term: "Мещане", category: GLOSSARY_SOCIAL_CATEGORY, description: "Податное городское сословие в Российской империи. Основные занятия — мелкая торговля и ремесло." },
  { term: "Младшие офицеры", category: GLOSSARY_SOCIAL_CATEGORY, description: "Военнослужащие младшего командного состава (унтер-офицеры, сержанты, капралы, фельдфебели), не имевшие чина по Табели о рангах." },
  { term: "Непременные работники", category: GLOSSARY_SOCIAL_CATEGORY, description: "Категория казённых крестьян, приписанных к горным заводам для выполнения вспомогательных работ — заготовки дров, угля, руды, их транспортировки и т. д." },
  { term: "Несчастные", category: GLOSSARY_SOCIAL_CATEGORY, description: "Категория владельцев усадеб, фигурирующая в ведомости обывательских строений Екатеринбурга. Статус несчастных требует дополнительного уточнения. Вероятнее всего, в состав категории входили бывшие ссыльно-каторжные." },
  { term: "Отпущенники", category: GLOSSARY_SOCIAL_CATEGORY, description: "Бывшие крепостные крестьяне, получившие вольную от помещика." },
  { term: "Работные люди", category: GLOSSARY_SOCIAL_CATEGORY, description: "Постоянное заводское состояние, неквалифицированные рабочие горных заводов. В отличие от мастеровых, выполняли тяжёлый физический труд; в отличие от непременных работников, не имели земельного надела и были постоянно прикреплены к заводу." },
  { term: "Священнослужители", category: GLOSSARY_SOCIAL_CATEGORY, description: "Категория православного духовенства, представители которой (священники, диаконы, протопопы) были наделены исключительным правом совершать таинства и церковные службы." },
  { term: "Солдаты", category: GLOSSARY_SOCIAL_CATEGORY, description: "Военнослужащие нижнего чина. При заводах несли службу в составе штатных команд, охранявших казённое имущество." },
  { term: "Старшие офицеры", category: GLOSSARY_SOCIAL_CATEGORY, description: "Военнослужащие, имевшие обер-офицерский (XIV–IX классы) или штаб-офицерский (VIII–VI классы) чин по Табели о рангах." },
  { term: "Церковнослужители", category: GLOSSARY_SOCIAL_CATEGORY, description: "Низшая категория православного духовенства (дьячки, пономари, причетники). Помогали священнослужителям в подготовке и проведении богослужений." },
  { term: "Арамашевская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Административно-территориальная единица в составе Верхотурского уезда Пермской губернии; центр — село Арамашево." },
  { term: "Березовский", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Старейший центр золотодобычи на Урале, расположенный в 14 км к северо-востоку от Екатеринбурга." },
  { term: "Вольск", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Уездный город в Саратовской губернии. В Екатеринбурге усадьбами владели вольские именитые граждане Лев Расторгуев и Василий Злобин." },
  { term: "Аршин", category: "Метрология", description: "Русская мера длины, равная 0,711 метрам. Квадратный аршин — единица измерения площади." },
  { term: "Сажень", category: "Метрология", description: "Русская мера длины, равная 2,13 метрам. Квадратная сажень — единица измерения площади." },
  { term: "Четверть", category: "Метрология", description: "Русская мера длины, равная 17,78 сантиметрам. Квадратная четверть — единица измерения площади." }
];

function prepareGlossaryEntries() {
  const list = document.getElementById("glossaryList");
  if (!list) return;

  const categoryAliases = {
    "Сословия": GLOSSARY_SOCIAL_CATEGORY,
    "Топография": GLOSSARY_TOPOGRAPHY_CATEGORY
  };

  list.querySelectorAll(".gl-entry").forEach(entry => {
    const categoryElement = entry.querySelector(".gl-cat");
    const termElement = entry.querySelector(".gl-term");
    if (categoryElement) {
      const category = categoryElement.textContent.trim();
      categoryElement.textContent = categoryAliases[category] || category;
    }
    if (termElement) {
      const term = termElement.textContent.trim();
      termElement.textContent = GLOSSARY_TERM_ALIASES[term] || term;
    }
  });

  const entriesByTerm = new Map();
  list.querySelectorAll(".gl-entry").forEach(entry => {
    const term = entry.querySelector(".gl-term")?.textContent.trim();
    if (term) entriesByTerm.set(term, entry);
  });

  GLOSSARY_ADDITIONS.forEach(item => {
    let entry = entriesByTerm.get(item.term);
    if (!entry) {
      entry = document.createElement("div");
      entry.className = "gl-entry";
      entry.innerHTML = '<div class="gl-cat"></div><div class="gl-body"><div class="gl-term"></div><div class="gl-desc"></div></div>';
      entriesByTerm.set(item.term, entry);
    }
    entry.querySelector(".gl-cat").textContent = item.category;
    entry.querySelector(".gl-term").textContent = item.term;
    entry.querySelector(".gl-desc").textContent = item.description;
  });

  const sortedEntries = Array.from(entriesByTerm.values()).sort((a, b) => {
    const aTerm = a.querySelector(".gl-term").textContent.trim();
    const bTerm = b.querySelector(".gl-term").textContent.trim();
    return aTerm.localeCompare(bTerm, "ru");
  });

  const fragment = document.createDocumentFragment();
  let currentLetter = "";
  sortedEntries.forEach(entry => {
    const term = entry.querySelector(".gl-term").textContent.trim();
    const letter = term.charAt(0).toLocaleUpperCase("ru-RU");
    if (letter !== currentLetter) {
      currentLetter = letter;
      const letterElement = document.createElement("div");
      letterElement.className = "gl-letter";
      letterElement.textContent = letter;
      fragment.appendChild(letterElement);
    }
    fragment.appendChild(entry);
  });
  list.replaceChildren(fragment);
}

function decorateGlossaryCategoryIcons() {
  const categoryIcons = new Map();
  document.querySelectorAll(".gl-cat-btn").forEach(button => {
    const icon = button.querySelector(".gl-cat-icon svg");
    if (icon) categoryIcons.set(button.dataset.cat, icon);
  });

  document.querySelectorAll(".gl-entry .gl-cat").forEach(categoryElement => {
    const category = categoryElement.textContent.trim();
    const icon = categoryIcons.get(category);
    categoryElement.dataset.cat = category;
    categoryElement.title = category;
    categoryElement.setAttribute("aria-label", category);
    if (icon) {
      const iconClone = icon.cloneNode(true);
      iconClone.setAttribute("aria-hidden", "true");
      categoryElement.replaceChildren(iconClone);
    }
  });
}

function initGlossary() {
  prepareGlossaryEntries();
  decorateGlossaryCategoryIcons();

  const searchInput = document.getElementById("glSearch");
  if (searchInput) {
    searchInput.addEventListener("input", function(e) {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll(".gl-entry").forEach(el => {
        el.style.display = el.textContent.toLowerCase().indexOf(q) !== -1 ? "flex" : "none";
      });
      document.querySelectorAll(".gl-letter").forEach(el => {
        let next = el.nextElementSibling;
        let hasVisible = false;
        while (next && !next.classList.contains("gl-letter")) {
          if (next.classList.contains("gl-entry") && next.style.display !== "none") hasVisible = true;
          next = next.nextElementSibling;
        }
        el.style.display = hasVisible ? "block" : "none";
      });
    });
  }
  
  // Переключение режимов
  const modes = document.querySelectorAll(".gl-mode");
  modes.forEach((m, i) => {
    m.addEventListener("click", function() {
      modes.forEach(mm => mm.classList.remove("active"));
      m.classList.add("active");
      const cats = document.getElementById("glCats");
      if (cats) cats.style.display = i === 1 ? "grid" : "none";
      if (i === 0) {
        document.querySelectorAll(".gl-cat-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".gl-entry").forEach(el => el.style.display = "flex");
        document.querySelectorAll(".gl-letter").forEach(el => el.style.display = "block");
        // Скрываем кнопку сброса при переключении на "По алфавиту"
        const resetBtn = document.getElementById('glossary-reset-btn');
        if (resetBtn) resetBtn.style.display = 'none';
        // Снимаем активные термины
        document.querySelectorAll('.glossary-term-clickable').forEach(el => el.classList.remove('active-term'));
        // Сбрасываем фильтры
        clearGlossaryFilter();
      }
    });
  });
 
  // Алфавитная навигация
  const letters = [];
  document.querySelectorAll(".gl-letter").forEach(el => letters.push(el.textContent.trim()));
  const alphaNav = document.getElementById("glAlpha");
  if (alphaNav) {
    letters.forEach(letter => {
      const btn = document.createElement("div");
      btn.className = "gl-alpha-btn";
      btn.textContent = letter;
      btn.onclick = () => {
        document.querySelectorAll(".gl-letter").forEach(el => {
          if (el.textContent.trim() === letter) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      };
      alphaNav.appendChild(btn);
    });
  }

  // --- НОВАЯ ЛОГИКА: Делаем термины кликабельными ---
  document.querySelectorAll('.gl-entry').forEach(entry => {
    const termElement = entry.querySelector('.gl-term');
    if (!termElement) return;

    const termText = termElement.textContent.trim();
    // Проверяем, есть ли термин в карте соответствия
    const mapping = GLOSSARY_FILTER_MAP[termText];

    if (mapping) {
        // Термин ведет на карту
        termElement.classList.add('glossary-term-clickable');
        termElement.dataset.term = termText;
        termElement.style.cursor = 'pointer';
        
        // Добавляем точку вместо иконки карты
        const dot = document.createElement('span');
        dot.className = 'glossary-dot';
        dot.innerHTML = ' •';
        dot.style.cssText = `
            color: var(--accent);
            font-weight: 700;
            font-size: 1.1em;
            margin-left: 4px;
            transition: all 0.2s ease;
        `;
        termElement.appendChild(dot);

        // Вешаем обработчик клика
        termElement.addEventListener('click', function(e) {
            e.stopPropagation();
            applyGlossaryFilter(termText);
        });

        // Добавляем подсказку
        termElement.title = 'Нажмите, чтобы показать на карте';

    } else {
        // Термин НЕ ведет на карту (Аршин, Сажень, Берг-гешворен и т.д.)
        termElement.style.cursor = 'default';
        termElement.title = '';
    }
  });

  // Кнопки категорий («Производство», «Чины» и т.д.): подключаем клик.
  // filterByCat была определена, но нигде не вызывалась - кнопки не работали.
  document.querySelectorAll(".gl-cat-btn").forEach(function(btn) {
    btn.addEventListener("click", function() { filterByCat(btn); });
  });

  // Добавляем кнопку для сброса фильтра глоссария
  addGlossaryResetButton();
}

// Функция для добавления кнопки сброса
function addGlossaryResetButton() {
    const glossaryList = document.getElementById('glossaryList');
    if (!glossaryList) return;

    // Проверяем, есть ли уже такая кнопка
    if (document.getElementById('glossary-reset-btn')) return;

    const resetBtn = document.createElement('div');
    resetBtn.id = 'glossary-reset-btn';
    resetBtn.style.cssText = `
        margin: 8px 0 16px;
        padding: 8px 16px;
        background: var(--accent-bg);
        border: 1px solid var(--accent);
        border-radius: 6px;
        color: var(--accent);
        font-size: 12px;
        cursor: pointer;
        display: none;
        text-align: center;
        font-weight: 600;
        transition: all 0.2s ease;
    `;
    resetBtn.innerHTML = '✕ Сбросить фильтр глоссария';
    resetBtn.addEventListener('click', function() {
        clearGlossaryFilter();
    });

    // Вставляем кнопку в начало списка
    glossaryList.prepend(resetBtn);
}

// Фильтрация по категории
function filterByCat(btn) {
  const cat = btn.dataset.cat;
  const wasActive = btn.classList.contains("active");
  document.querySelectorAll(".gl-cat-btn").forEach(b => b.classList.remove("active"));
  if (!wasActive) btn.classList.add("active");

  // Сбрасываем фильтр глоссария при фильтрации по категории
  clearGlossaryFilter();
  
  document.querySelectorAll(".gl-entry").forEach(el => {
    if (wasActive) {
      el.style.display = "flex";
      return;
    }
    const elCat = el.querySelector(".gl-cat");
    el.style.display = (elCat && elCat.dataset.cat === cat) ? "flex" : "none";
  });
  
  document.querySelectorAll(".gl-letter").forEach(el => {
    if (wasActive) {
      el.style.display = "block";
      return;
    }
    let next = el.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains("gl-letter")) {
      if (next.classList.contains("gl-entry") && next.style.display !== "none") hasVisible = true;
      next = next.nextElementSibling;
    }
    el.style.display = hasVisible ? "block" : "none";
  });
}
