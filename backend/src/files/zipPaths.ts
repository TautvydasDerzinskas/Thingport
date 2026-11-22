import { cutName, normalizeFileName, numberedFolderName, numberedName, PATH_SEGMENT_MAX } from "./names";

// Where each file goes in a zip of models: every path once, ignoring case, as the folder it's unzipped into may (on a
// Mac or Windows), and never a path that's both a file and a folder. Folders belong to whoever claimed them first, so
// two models named alike get two folders, and a model's supporting/ folder or LICENSE.txt, claimed before its plates,
// can't be taken over by a plate named like them. Folder names go through the name rule as file names do, so a
// category called "Tools/Parts" is one folder and one called ".." leads nowhere outside the zip, and every level keeps
// the cap a storage path's does, numbered or not: 120 characters and NAME_MAX_BYTES.

// Compared as a disk that ignores case compares names: upper case, then lower, decomposed. Lower case alone keeps
// "ΦΙΛΟΣ" and "φιλος", or "µ" and "μ", apart, which a Mac or Windows takes as one name. Folding more than a disk does
// only numbers a name that needn't be.
const key = (path: string) => path.toUpperCase().toLowerCase().normalize("NFD");
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

export class ZipPaths {
  private readonly files = new Set<string>();
  /** A folder's owner and its path as first spelled, by its path. */
  private readonly folders = new Map<string, { owner: string; path: string }>();

  private taken(path: string): boolean {
    return this.files.has(key(path)) || this.folders.has(key(path));
  }

  /** The folder `name` inside `parent` for `owner`: its own if it already claimed one, else the first free
   *  "name", "name (2)", ... A folder another owner has, or a file, is passed over. */
  folder(parent: string, name: string, owner: string): string {
    const normal = normalizeFileName(name);
    for (let n = 1; ; n++) {
      const candidate = join(parent, numberedFolderName(normal, n, PATH_SEGMENT_MAX));
      const holder = this.folders.get(key(candidate));
      // Its own folder comes back as it was first spelled, so "STL" and "stl" are one folder in the zip.
      if (holder?.owner === owner) return holder.path;
      if (holder === undefined && !this.files.has(key(candidate))) {
        this.folders.set(key(candidate), { owner, path: candidate });
        return candidate;
      }
    }
  }

  /** The folders of `levels` inside `parent`, one by one, for `owner`. */
  nested(parent: string, levels: readonly string[], owner: string): string {
    return levels.reduce((at, level) => this.folder(at, level, owner), parent);
  }

  /** A file named `name` in `folder`: that name if it's free, else numbered apart ("Base (2).stl"). */
  file(folder: string, name: string): string {
    const normal = normalizeFileName(name);
    for (let n = 1; ; n++) {
      const candidate = join(
        folder,
        n === 1 ? cutName(normal, PATH_SEGMENT_MAX) : numberedName(normal, n, PATH_SEGMENT_MAX),
      );
      if (!this.taken(candidate)) {
        this.files.add(key(candidate));
        return candidate;
      }
    }
  }
}
