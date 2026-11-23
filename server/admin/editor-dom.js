const paths = {
  table: "M3 4h18v16H3zM3 9h18M9 9v11m6-11v11",
  book: "M12 6a13 13 0 0 0-9-2v14a13 13 0 0 1 9 2 13 13 0 0 1 9-2V4a13 13 0 0 0-9 2v14",
  sliders: "M5 3v5m0 4v9m7-18v10m0 4v4m7-18v3m0 4v11M3 8h4v4H3zm7 5h4v4h-4zm7-7h4v4h-4z",
  filter: "M3 4h18l-7 8v6l-4 2v-8Z",
  search: "M15.5 15.5 21 21m-4-10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  expand: "M9 4H4v5m11-5h5v5m-5 11h5v-5M4 15v5h5",
  collapse: "M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5",
  undo: "m8 6-4 4 4 4m-4-4h10a5 5 0 0 1 5 5v2",
  close: "m6 6 12 12M18 6 6 18",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14m-6-6 6 6 6-6",
  left: "m14 6-6 6 6 6",
  right: "m10 6 6 6-6 6",
  chevron: "m6 9 6 6 6-6",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  edit: "m4 16-1 5 5-1L20 8l-4-4ZM14 6l4 4",
  image: "M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5M16 8h.01",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4",
  link: "M10 13a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-2 2m3 5a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l2-2",
  external: "M13 5h6v6m0-6-9 9m7-1v6H5V7h6",
  hidden: "m3 3 18 18M10 10a3 3 0 0 0 4 4m-5-9c1-.3 2-.5 3-.5 5.5 0 9 7.5 9 7.5s-1.1 2.2-3 4M6 7a18 18 0 0 0-3 5s3.5 7.5 9 7.5c1.3 0 2.5-.4 3.6-1",
};
const svgNamespace = "http://www.w3.org/2000/svg";

export function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function glyph(name) {
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.classList.add("editor-glyph");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNamespace, "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}

export function button(label, click, { icon, className = "", iconOnly = false } = {}) {
  const control = el("button", `editor-button ${className}`);
  control.type = "button";
  control.onclick = click;
  if (icon) control.append(glyph(icon));
  if (iconOnly) {
    control.classList.add("editor-icon-button");
    control.setAttribute("aria-label", label);
    control.title = label;
  } else control.append(el("span", "", label));
  return control;
}

export function field(label, control, hint) {
  const wrapper = el("label", "editor-field");
  wrapper.append(el("span", "editor-field-label", label), control);
  if (hint) wrapper.append(el("small", "editor-field-hint", hint));
  return wrapper;
}

export function textInput(label, value, { tag = "input", className = "", placeholder = "", type = "text" } = {}) {
  const input = el(tag, `editor-input ${className}`);
  if (tag === "input") input.type = type;
  input.setAttribute("aria-label", label);
  input.placeholder = placeholder;
  input.value = value ?? "";
  return input;
}

export function selectInput(label, options, value) {
  const select = el("select", "editor-input");
  select.setAttribute("aria-label", label);
  for (const [key, label] of options) select.add(new Option(label, key));
  select.value = value ?? "";
  return select;
}

export function switchInput(label, checked, change, { hint } = {}) {
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  input.onchange = () => change(input.checked);
  const wrapper = el("label", "editor-switch");
  const copy = el("span", "editor-switch-copy");
  copy.append(el("span", "", label));
  if (hint) copy.append(el("small", "editor-field-hint", hint));
  wrapper.append(copy, input, el("span", "editor-switch-track"));
  return wrapper;
}

export function searchBox(label, value, onInput) {
  const box = el("div", "editor-search");
  const input = textInput(label, value, { placeholder: label, type: "search" });
  input.oninput = () => onInput(input.value);
  box.append(glyph("search"), input);
  return box;
}

export const formatNumber = value => value.toLocaleString("ru", { maximumFractionDigits: 2 });
export const splitLines = value => [...new Set(String(value || "").split("\n").map(line => line.trim()).filter(Boolean))];

export function emptyState(text) {
  return el("p", "editor-empty", text);
}

export function fieldChanged(entry, key) {
  const value = entry.value[key];
  const original = entry.original?.[key];
  return Array.isArray(value) && Array.isArray(original)
    ? value.length !== original.length || value.some((item, index) => item !== original[index])
    : value !== original;
}

export function entryChanged(entry) {
  return !entry.original || entry.removed || Object.keys(entry.value).some(key => fieldChanged(entry, key));
}
