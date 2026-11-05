// Another user's public model or collection opens under Explore, where the sidebar shows the user is, rather than in
// their own library; the same pages draw it.

export function modelPath(print: { id: string; owner?: unknown }): string {
  return print.owner ? `/explore/models/${print.id}` : `/models/${print.id}`;
}

export function collectionPath(collection: { id: string; owner?: unknown }): string {
  return collection.owner ? `/explore/collections/${collection.id}` : `/models/collections/${collection.id}`;
}
