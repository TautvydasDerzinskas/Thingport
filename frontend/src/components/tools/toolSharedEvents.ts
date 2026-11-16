// Told when a tool shares or removes an entry, so its parts of a model's page, and its window, can show the change.
const listeners = new Map<string, Set<() => void>>();

export function onToolSharedChange(toolId: string, listener: () => void): () => void {
  let set = listeners.get(toolId);
  if (!set) listeners.set(toolId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size && listeners.get(toolId) === set) listeners.delete(toolId);
  };
}

export function toolSharedChanged(toolId: string): void {
  // Those listening as it's told: one that stops and listens again would otherwise be told over and over. One stopped
  // along the way isn't told.
  for (const listener of Array.from(listeners.get(toolId) ?? [])) {
    if (!listeners.get(toolId)?.has(listener)) continue;
    try {
      listener();
    } catch {
      // One tool part failing mustn't keep the others from hearing it.
    }
  }
}
