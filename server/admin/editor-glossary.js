import {
  button, el, emptyState, entryChanged, field, fieldChanged, glyph,
  searchBox, selectInput, splitLines, textInput,
} from "./editor-dom.js?v=inline-2";
import { columnLabel } from "./editor-table.js?v=bulk-table";

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const iconCatalogLabel = "Значок термина";

async function resizeIcon(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 3_000_000)
    throw new Error("Выберите PNG, JPEG или WebP размером до 3 МБ.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Не удалось прочитать изображение.");
  }
  try {
    const canvas = el("canvas");
    canvas.width = canvas.height = 96;
    const context = canvas.getContext("2d");
    const scale = 96 / Math.max(bitmap.width, bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, (96 - width) / 2, (96 - height) / 2, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

export function createGlossaryEditor({ getSnapshot, getRows, getMapFilters, refreshStatus, imageBusy }) {
  let query = "", category = "", mode = "alphabet";
  const block = el("section", "editor-glossary");
  const filters = el("div", "editor-glossary-toolbar");
  const modes = el("div", "editor-segmented");
  const search = searchBox("Найти термин или синоним", "", value => {
    query = value;
    draw();
  });
  const alphabet = el("div", "gl-alpha editor-alphabet");
  const categories = el("div", "editor-category-tabs");
  const list = el("div", "editor-glossary-list");
  const categoryList = el("datalist");
  categoryList.id = "editor-glossary-categories";
  for (const [value, label] of [["alphabet", "По алфавиту"], ["category", "По тематике"]]) {
    const control = button(label, () => {
      mode = value;
      category = "";
      updateModes();
      draw();
    }, { className: "editor-segment" });
    control.dataset.mode = value;
    modes.append(control);
  }
  filters.append(search, modes);
  block.append(filters, categories, alphabet, list, categoryList);

  function updateModes() {
    for (const control of modes.children) {
      control.setAttribute("aria-pressed", String(control.dataset.mode === mode));
    }
  }

  function categoryIcon(name) {
    return getSnapshot().site.glossaryIcons?.find(item => item.category === name)?.id || "book";
  }

  function drawIconPicker(entry, afterChange, parent) {
    const catalog = getSnapshot().site.glossaryIcons || [];
    const options = el("div", "editor-icon-options");
    const current = entry.value.icon;
    const presets = [
      { id: "", label: "По категории", preview: categoryIcon(entry.value.category) },
      ...catalog.map(item => ({ ...item, preview: item.id })),
      { id: "none", label: "Без значка" },
    ];
    const choose = item => {
      entry.iconRequest = null;
      entry.value.icon = item;
      afterChange("icon");
      for (const choice of options.children)
        choice.setAttribute("aria-pressed", String(choice.dataset.icon === item));
    };
    for (const { id, label, preview } of presets) {
      const choice = button(label, () => choose(id), { className: "editor-icon-choice" });
      choice.dataset.icon = id;
      choice.prepend(createGlossaryIcon(preview) || glyph("hidden"));
      choice.setAttribute("aria-pressed", String(id === current));
      options.append(choice);
    }
    const uploadLine = el("div", "editor-icon-upload");
    const file = el("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp";
    file.hidden = true;
    const chooseFile = button("Загрузить изображение", () => file.click(), { icon: "upload", className: "editor-quiet" });
    const note = el("span", "editor-field-hint", "PNG, JPEG или WebP до 3 МБ");
    note.setAttribute("role", "status");
    file.onchange = async () => {
      const selected = file.files[0];
      if (!selected) return;
      chooseFile.disabled = true;
      note.textContent = "Обработка изображения…";
      note.classList.remove("is-error");
      const request = Symbol();
      entry.iconRequest = request;
      imageBusy(1);
      try {
        const image = await resizeIcon(selected);
        if (entry.iconRequest === request && !entry.removed) {
          choose(image);
          note.textContent = "Своё изображение выбрано";
        }
      } catch (error) {
        note.textContent = error.message;
        note.classList.add("is-error");
      } finally {
        chooseFile.disabled = false;
        file.value = "";
        imageBusy(-1);
      }
    };
    if (current.startsWith("data:image/png")) note.textContent = "Используется своё изображение";
    uploadLine.append(chooseFile, note, file);
    parent.append(options, uploadLine);
  }

  function renderCard(entry) {
    const values = entry.value;
    const card = el("article", "gl-entry editor-glossary-card");
    const main = el("div", "editor-glossary-main");
    const body = el("div", "editor-glossary-body");
    const actions = el("div", "editor-item-actions");
    const disclosure = el("div", "editor-glossary-disclosure");
    const title = textInput("Термин", values.term, { className: "editor-term-input", placeholder: "Название термина" });
    const subject = textInput("Категория", values.category, { className: "editor-category-input", placeholder: "Категория" });
    subject.setAttribute("list", categoryList.id);
    const definition = textInput("Определение", values.description, {
      tag: "textarea", className: "editor-definition", placeholder: "Определение термина…",
    });
    const icon = button("Выбрать значок", () => openDetails("icons"), { className: "gl-cat editor-term-icon", iconOnly: true });
    const more = button("Связи и синонимы", () => openDetails("links"), { icon: "link", className: "editor-quiet editor-links" });
    const inputs = new Map([["term", title], ["description", definition], ["category", subject], ["icon", icon]]);

    function drawCurrentIcon() {
      const graphic = createGlossaryIcon(values.icon || categoryIcon(values.category));
      const pencil = el("span", "editor-icon-pencil");
      pencil.append(glyph("edit"));
      icon.replaceChildren(graphic || glyph("image"), pencil);
      icon.classList.toggle("is-dirty", Boolean(entry.original && fieldChanged(entry, "icon")));
    }

    function afterChange(key) {
      if (key === "icon" || key === "category") drawCurrentIcon();
      card.classList.toggle("is-dirty", entryChanged(entry));
      inputs.get(key)?.classList.toggle("is-dirty", Boolean(entry.original && fieldChanged(entry, key)));
      refreshStatus();
    }

    function wire(input, key, convert = value => value) {
      inputs.set(key, input);
      input.maxLength = 12000;
      input.classList.toggle("is-dirty", Boolean(entry.original && fieldChanged(entry, key)));
      input.oninput = () => {
        values[key] = convert(input.value);
        afterChange(key);
      };
    }

    function openDetails(kind) {
      entry.open = entry.open === kind ? "" : kind;
      renderDetails();
    }

    function renderDetails() {
      disclosure.replaceChildren();
      disclosure.hidden = !entry.open;
      icon.setAttribute("aria-expanded", String(entry.open === "icons"));
      more.setAttribute("aria-expanded", String(entry.open === "links"));
      if (entry.open === "icons") {
        disclosure.append(el("h3", "editor-detail-heading", iconCatalogLabel));
        drawIconPicker(entry, afterChange, disclosure);
      } else if (entry.open === "links") {
        const aliases = textInput("Синонимы", values.aliases.join("\n"), { tag: "textarea", placeholder: "По одному на строку" });
        const mapLabels = new Map(getMapFilters().map(item => [item.key, item.title]));
        const options = getSnapshot().site.filterFields.map(key => [key, mapLabels.get(key) || columnLabel(key)]);
        const link = selectInput("Фильтр карты", [["", "Без связи"], ...options], values.filterKey);
        const linkValues = textInput("Значения фильтра", values.filterValue.join("\n"), { tag: "textarea", placeholder: "По одному на строку" });
        const valuesField = field("Значения фильтра", linkValues);
        valuesField.hidden = !values.filterKey;
        wire(aliases, "aliases", splitLines);
        wire(link, "filterKey");
        link.addEventListener("input", () => { valuesField.hidden = !link.value; });
        wire(linkValues, "filterValue", splitLines);
        const fields = el("div", "editor-glossary-meta");
        fields.append(field("Синонимы", aliases), field("Фильтр карты", link), valuesField);
        disclosure.append(fields);
      }
    }

    const remove = button(entry.removed ? "Вернуть термин" : "Удалить термин", () => {
      if (!entry.original) {
        const rows = getRows();
        rows.splice(rows.indexOf(entry), 1);
        draw();
      } else {
        entry.removed = !entry.removed;
        entry.open = "";
        const successor = renderCard(entry);
        card.replaceWith(successor);
        successor.querySelector(".editor-term-action")?.focus({ preventScroll: true });
      }
      refreshStatus();
    }, { icon: entry.removed ? "undo" : "trash", className: "editor-term-action " +
      (entry.removed ? "" : "editor-quiet editor-danger"), iconOnly: !entry.removed });
    card.classList.toggle("is-dirty", entryChanged(entry));
    card.classList.toggle("is-removed", Boolean(entry.removed));
    if (entry.removed) {
      card.append(el("p", "editor-removed-name", values.term), remove);
      return card;
    }
    for (const [key, control] of [["term", title], ["category", subject], ["description", definition]]) wire(control, key);
    const titleLine = el("div", "editor-glossary-title-line");
    titleLine.append(title, subject);
    body.append(titleLine, definition);
    actions.append(more, remove);
    main.append(icon, body, actions);
    card.append(main, disclosure);
    drawCurrentIcon();
    renderDetails();
    return card;
  }

  function draw() {
    const rows = getRows();
    const names = [...new Set(rows.map(entry => entry.value.category).filter(Boolean))].sort(collator.compare);
    categoryList.replaceChildren(...names.map(name => new Option(name)));
    categories.hidden = mode !== "category";
    alphabet.hidden = mode !== "alphabet";
    categories.replaceChildren();
    for (const name of ["", ...names]) {
      const control = button(name || "Все категории", () => { category = name; draw(); }, { className: "editor-category-tab" });
      control.setAttribute("aria-pressed", String(category === name));
      categories.append(control);
    }
    alphabet.replaceChildren();
    const needle = EstateTable.normalize(query);
    const matched = rows.filter(entry => !entry.original || (
      (!category || entry.value.category === category) &&
      EstateTable.normalize([entry.value.term, entry.value.category, entry.value.description, ...entry.value.aliases].join(" ")).includes(needle)
    ));
    const ordered = matched.filter(entry => entry.original).sort((a, b) => collator.compare(a.value.term, b.value.term));
    const cards = document.createDocumentFragment();
    for (const entry of matched.filter(entry => !entry.original)) cards.append(renderCard(entry));
    let lastLetter;
    for (const entry of ordered) {
      const letter = entry.value.term?.charAt(0).toLocaleUpperCase("ru") || "—";
      if (mode === "alphabet" && letter !== lastLetter) {
        const title = el("h2", "gl-letter editor-letter", letter);
        alphabet.append(button(letter, () => title.scrollIntoView({ block: "start" }), { className: "editor-letter-link" }));
        cards.append(title);
        lastLetter = letter;
      }
      cards.append(renderCard(entry));
    }
    if (!matched.length) cards.append(emptyState(needle || category ? "По этим условиям терминов нет." : "Глоссарий пока пуст."));
    list.replaceChildren(cards);
  }

  return {
    block,
    render() { updateModes(); draw(); },
    reset() {
      mode = "alphabet";
      category = query = "";
      search.querySelector("input").value = "";
    },
    focusNew() {
      query = "";
      search.querySelector("input").value = "";
      draw();
      const first = list.querySelector(".editor-term-input");
      first?.scrollIntoView({ block: "nearest" });
      first?.focus({ preventScroll: true });
    },
    selectedCategory: () => category,
  };
}
