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
  { term: "Макарова", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Деревня на левом берегу Чусовой, в устье реки Макаровки, в 60 км к северо-западу от Екатеринбурга. Основана в 1720 г. по распоряжению В. Н. Татищева как сухопутная переправа и стан ямской гоньбы." },
  { term: "Шарташская деревня", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Поселение на северном берегу озера Шарташ, возникшее, предположительно, во время строительства Екатеринбургского завода. Центр старообрядческого движения; с конца XVIII в. приписано к Березовским золотым промыслам." },
  { term: "Белоярская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Екатеринбургского уезда Пермской губернии с центром в селе Белоярском, основанном в конце XVII в. и расположенном в 60 км к востоку от Екатеринбурга." },
  { term: "Щелкунская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Екатеринбургского уезда Пермской губернии с центром в селе Щелкун, основанном в конце XVII в. и расположенном в 70 км к югу от Екатеринбурга." },
  { term: "Екатеринбургский участок", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Учётная единица Екатеринбургских казённых заводов, связанная с городом Екатеринбургом; место приписки непременных работников. Упоминается в ревизских документах начала XIX в." },
  { term: "Казань", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Губернский город, административный и торговый центр Казанской губернии на Сибирском тракте, соединявшем его с Екатеринбургом." },
  { term: "Камышлов", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Уездный город Пермской губернии, основанный в 1668 г. как Камышловский острог. Расположен в 140 км к востоку от Екатеринбурга; важный пункт на Сибирском тракте." },
  { term: "Камышловская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Камышловского уезда с центром в городе Камышлове, основанном в 1668 г. как Камышловский острог и расположенном в 140 км к востоку от Екатеринбурга." },
  { term: "Калиновская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Камышловского уезда Пермской губернии с центром в селе Калиновском, основанном в конце XVIII в. как Калиновская слобода и расположенном в 135 км к востоку от Екатеринбурга." },
  { term: "Катайская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Камышловского уезда Пермской губернии с центром в селе Катайском (ныне Катайск Курганской области), основанном в середине XVIII в. как Катайский острог и расположенном в 150 км к юго-востоку от Екатеринбурга." },
  { term: "Камышловская округа", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Название Камышловского уезда в документах." },
  { term: "Красноярская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волости с таким названием в Камышловском уезде не было. Вероятнее всего, имеется в виду село Красноярское Тамакульской волости, основанное в конце XVII в. как Красноярская слобода и расположенное в 160 км к юго-востоку от Екатеринбурга." },
  { term: "Щербаковская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Камышловского уезда Пермской губернии с центром в селе Щербаково (до начала XVII в. — башкирский аул Щербаки), расположенном в 90 км к юго-востоку от Екатеринбурга." },
  { term: "Некрасовская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Камышловского уезда Пермской губернии с центром в селе Некрасово, основанном в конце XVII в. как деревня Некрасова и расположенном в 85 км к востоку от Екатеринбурга." },
  { term: "Тамакульская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Камышловского уезда Пермской губернии с центром в селе Тамакульском, основанном в 1686 г. как Тамакульская слобода с острогом и расположенном в 160 км к востоку от Екатеринбурга." },
  { term: "Воздвиженская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волости с таким названием в Красноуфимском уезде не было. Вероятнее всего, имеется в виду Крестовоздвиженская волость с центром в селе Крестовоздвиженском, основанном во второй половине XVII в. и расположенном в 200 км к западу от Екатеринбурга." },
  { term: "Красноуфимская округа", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Название Красноуфимского уезда в документах." },
  { term: "Монастырская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Верхотурского уезда Пермской губернии с центром в селе Монастырском (ныне Кировское), основанном в 1621 г. и расположенном в 180 км к северо-востоку от Екатеринбурга." },
  { term: "Петропавловская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Шадринского уезда Пермской губернии с центром в селе Петропавловском (до 1761 г. — Верхняя Шутиха), возникшем в XVII в. и расположенном в 160 км к юго-востоку от Екатеринбурга." },
  { term: "Тюмень", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Уездный город Тобольской губернии, основанный в 1586 г. как русская крепость. Крупный торговый и транспортный узел на Сибирском тракте, связывавшем город с Екатеринбургом." },
  { term: "Усадьба", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Землевладение с жилыми и хозяйственными постройками, а также насаждениями — садом и огородом." },
  { term: "Уткинская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Екатеринбургского уезда Пермской губернии с центром в посёлке Уткинский завод (ныне Новоуткинск), расположенном в 70 км к западу от Екатеринбурга." },
  { term: "Шадринск", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Уездный город Пермской губернии, основанный в середине XVIII в. как Шадринская слобода и расположенный в 220 км к юго-востоку от Екатеринбурга. Торговый центр с тремя ежегодными ярмарками." },
  { term: "Шарташская волость", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Волость Екатеринбургского уезда Пермской губернии с центром в селе Шарташском на северном берегу озера Шарташ (см. «Шарташская деревня»). Поселение возникло, предположительно, во время строительства Екатеринбургского завода." },
  { term: "Шарташский участок", category: GLOSSARY_TOPOGRAPHY_CATEGORY, description: "Учётная единица Екатеринбургских казённых заводов в районе озера Шарташ; место приписки непременных работников. Упоминается в ревизских документах начала XIX в." },
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
    searchInput.addEventListener("input", function (e) {
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
    m.addEventListener("click", function () {
      modes.forEach(mm => mm.classList.remove("active"));
      m.classList.add("active");
      const cats = document.getElementById("glCats");
      if (cats) cats.style.display = i === 1 ? "grid" : "none";
      if (i === 0) {
        document.querySelectorAll(".gl-cat-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".gl-entry").forEach(el => el.style.display = "flex");
        document.querySelectorAll(".gl-letter").forEach(el => el.style.display = "block");
        const resetBtn = document.getElementById('glossary-reset-btn');
        if (resetBtn) resetBtn.style.display = 'none';
        document.querySelectorAll('.glossary-term-clickable').forEach(el => el.classList.remove('active-term'));
        clearGlossaryFilter();
      }
    });
  });

  // Алфавитная навигация
  const letters = [];
  document.querySelectorAll(".gl-letter").forEach(el => letters.push(el.textContent.trim()));
  const alphaNav = document.getElementById("glAlpha");
  if (alphaNav) {
    alphaNav.innerHTML = "";
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

  // Делаем термины кликабельными, если есть маппинг
  document.querySelectorAll('.gl-entry').forEach(entry => {
    const termElement = entry.querySelector('.gl-term');
    if (!termElement) return;

    const termText = termElement.textContent.trim();
    const mapping = GLOSSARY_FILTER_MAP[termText];

    if (mapping) {
      termElement.classList.add('glossary-term-clickable');
      termElement.dataset.term = termText;
      termElement.style.cursor = 'pointer';

      if (!termElement.querySelector('.glossary-dot')) {
        const dot = document.createElement('span');
        dot.className = 'glossary-dot';
        dot.textContent = ' •';
        termElement.appendChild(dot);
      }

      termElement.addEventListener('click', function (e) {
        e.stopPropagation();
        applyGlossaryFilter(termText);
      });
      termElement.title = 'Нажмите, чтобы показать на карте';
    } else {
      termElement.style.cursor = 'default';
      termElement.title = '';
    }
  });

  // Кнопки категорий
  document.querySelectorAll(".gl-cat-btn").forEach(function (btn) {
    btn.addEventListener("click", function () { filterByCat(btn); });
  });

  addGlossaryResetButton();
}

// Кнопка сброса фильтра глоссария
function addGlossaryResetButton() {
  const glossaryList = document.getElementById('glossaryList');
  if (!glossaryList) return;
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
  resetBtn.addEventListener('click', function () {
    clearGlossaryFilter();
  });

  glossaryList.prepend(resetBtn);
}

// Фильтрация по категории
function filterByCat(btn) {
  const cat = btn.dataset.cat;
  const wasActive = btn.classList.contains("active");
  document.querySelectorAll(".gl-cat-btn").forEach(b => b.classList.remove("active"));
  if (!wasActive) btn.classList.add("active");

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
