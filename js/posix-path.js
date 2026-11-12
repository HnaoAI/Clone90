// Sous-ensemble de `node:path` (posix) pour js/games-builder.js (T27), afin que le même code tourne sous Node et dans le navigateur.
// Aucune dépendance. INVARIANT : même résultat que node:path posix pour ces fonctions (vérifié par tests/posix-path.test.mjs).

/** Comme posix.normalize : résout `.` et `..`, fusionne les `/`, garde le `/` initial et final. Chaîne vide : '.'. */
export function normalize(path) {
  if (path === '') return '.';
  const absolute = path.startsWith('/');
  const trailing = path.endsWith('/');
  const out = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length && out.at(-1) !== '..') out.pop();
      else if (!absolute) out.push('..');
    } else out.push(segment);
  }
  let result = out.join('/');
  if (!result && !absolute) result = '.';
  if (result && trailing) result += '/';
  return absolute ? `/${result}` : result;
}

/** Comme posix.join. */
export function join(...parts) {
  const joined = parts.filter((p) => p !== '').join('/');
  return joined === '' ? '.' : normalize(joined);
}

/** Comme posix.isAbsolute. */
export const isAbsolute = (path) => path.startsWith('/');

/** Dernier segment sans les `/` finaux (base commune de basename, dirname, extname). */
const trimTrailing = (path) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** Comme posix.basename(path, ext). */
export function basename(path, ext) {
  const trimmed = trimTrailing(path);
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return ext && base !== ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

/** Comme posix.dirname. */
export function dirname(path) {
  if (path === '') return '.';
  const trimmed = trimTrailing(path);
  const index = trimmed.lastIndexOf('/');
  if (index === -1) return '.';
  if (index === 0) return '/';
  return trimmed.slice(0, index);
}

/** Comme posix.extname : '' pour un nom sans point ou commençant par un point (`.bashrc`). */
export function extname(path) {
  const base = basename(path);
  const index = base.lastIndexOf('.');
  return index <= 0 || base === '..' ? '' : base.slice(index);
}
