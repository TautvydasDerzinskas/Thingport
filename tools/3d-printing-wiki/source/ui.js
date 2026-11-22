export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

export function button(label, run, className = "wiki-button") {
  const action = node("button", className, label);
  action.type = "button";
  action.addEventListener("click", run);
  return action;
}

export function pageTitle(title, intro) {
  const heading = node("header", "wiki-page-title");
  const name = node("h1", null, title);
  name.tabIndex = -1;
  heading.append(name);
  if (intro) heading.append(node("p", "wiki-muted", intro));
  return heading;
}
