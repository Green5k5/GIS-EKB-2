function createGlossaryIcon(source) {
  if (typeof source !== "string" || !source || source === "none") return null;
  if (source.startsWith("data:image/png;base64,")) {
    const img = document.createElement("img");
    img.src = source;
    img.alt = "";
    img.className = "gl-icon-image";
    return img;
  }
  if (!/^[a-z]+$/.test(source)) return null;
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(namespace, "use");
  use.setAttribute("href", "/assets/glossary-icons.svg#" + source);
  svg.append(use);
  return svg;
}
