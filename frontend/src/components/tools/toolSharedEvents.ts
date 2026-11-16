// Told when a tool shares or removes an entry, so a model's page showing the tools' notes reads them again.
const listeners = new Set<() => void>();

export function onToolInfoChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toolInfoChanged(): void {
  listeners.forEach((listener) => listener());
}
