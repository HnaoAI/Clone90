// API locale des dossiers de jeux (T25), des pochettes (T28) et des logos des machines (T29) : GET /api/settings, POST /api/settings/choose,
// GET /api/covers, POST /api/covers/download, GET /api/logos, POST /api/logos/download,
// et (T34, « Télécharger depuis une page ») POST /api/links/scan, POST /api/links/download, GET /api/links,
// et (T35, mises à jour) POST /api/update/check, POST /api/update/apply, GET /api/update.
// Branchée par serve.mjs. Dépend de local-settings.mjs, generate-games.mjs (régénération), covers.mjs et machine-logos.mjs, sans les dupliquer.
// INVARIANT (sécurité) : active seulement si le serveur n'écoute que sur ce Mac (serve.mjs, isSettingsApiEnabled). Chaque requête doit
//   avoir un en-tête Host localhost:<port> ou 127.0.0.1:<port> (anti DNS rebinding), une Origin identique (ou aucune avec X-Clone90: 1),
//   un Content-Type application/json et un corps de 1 Ko au plus. Le navigateur ne fournit JAMAIS de chemin : il choisit un type
//   ('roms', 'bios', 'roms-default', 'bios-default'), c'est la boîte du Mac qui choisit le dossier. Une seule boîte ouverte à la fois (verrou).
//   T28 : le téléchargement des pochettes n'accepte que le corps `{}` (aucun paramètre) et partage le même verrou : jamais une boîte de choix pendant un téléchargement.
//   T29 : les logos suivent exactement le même mécanisme (même travail en arrière-plan, même verrou) : un seul téléchargement à la fois, pochettes ou logos.
//   T34 : les liens aussi (même verrou). Seul ce travail reçoit des paramètres : `{items: [{url, target}]}` (64 Ko au plus), chaque choix est revérifié
//   par link-relay.mjs (adresse publique, extension acceptée par la machine, nom de BIOS déclaré). L'analyse (scan) répond directement, une à la fois.
//   T35 : la mise à jour (updater.mjs) est un travail de plus (corps `{}`, même verrou) ; une fois faite, `restart` (serve.mjs) relance le serveur.
import { readLocalSettings, updateLocalSettings, folderProblemKind } from './local-settings.mjs';
import { runGenerate } from './generate-games.mjs';
import { runCovers, formatSummary } from './covers.mjs';
import { runLogos, formatLogosSummary } from './machine-logos.mjs';
import { scanPage, downloadLinks, formatLinksSummary, RelayError, MAX_ITEMS } from './link-relay.mjs';
import { checkForUpdate, applyUpdate } from './updater.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_BODY_BYTES = 1024;
/** Corps maximal d'une analyse (adresse de 2048 caractères au plus) et d'une liste de fichiers choisis (T34). */
export const MAX_SCAN_BODY_BYTES = 4096;
export const MAX_LINKS_BODY_BYTES = 64 * 1024;
/** Types de choix acceptés et réglage visé (null : retour au dossier du projet, sans boîte). */
const KINDS = { roms: 'romsDir', bios: 'biosDir', 'roms-default': 'romsDir', 'bios-default': 'biosDir' };
const isDefaultKind = (kind) => kind.endsWith('-default');
const CUSTOM_HEADER = 'x-clone90';

const REFUSALS = {
  'too-wide': 'Ce dossier est trop large (disque entier, dossier personnel ou dossier système). Choisissez le dossier qui contient directement vos jeux.',
  'not-a-folder': 'Ce dossier est introuvable. Choisissez un dossier existant.',
  'not-absolute': 'Ce dossier est introuvable. Choisissez un dossier existant.',
};
const ERROR_TEXT = {
  dialog: 'La fenêtre de choix n\'a pas pu s\'ouvrir sur ce Mac.',
  generate: 'Les dossiers sont enregistrés, mais la liste des jeux n\'a pas pu être mise à jour. Relancez Clone90.',
  save: 'Les dossiers n\'ont pas pu être enregistrés. Vérifiez le fichier clone90.local.json.',
  busy: 'Une fenêtre de choix est déjà ouverte sur votre Mac.',
  coversBusy: 'Le téléchargement des pochettes est en cours.',
  coversFailed: 'Le téléchargement des pochettes a échoué. Vérifiez votre connexion à Internet.',
  logosBusy: 'Le téléchargement des logos est en cours.',
  logosFailed: 'Le téléchargement des logos a échoué. Vérifiez votre connexion à Internet.',
  linksBusy: 'Un téléchargement de fichiers est en cours.',
  linksFailed: 'Le téléchargement des fichiers a échoué. Vérifiez votre connexion à Internet.',
  scanBusy: 'Une analyse de page est déjà en cours.',
  scanFailed: 'La page n\'a pas pu être analysée.',
  updateBusy: 'Une mise à jour est en cours.',
  updateFailed: 'La mise à jour a échoué. Rien n\'a été changé.',
};
/** Routes connues : chemin -> méthode attendue. */
const ROUTES = { '/api/settings': 'GET', '/api/settings/choose': 'POST', '/api/covers': 'GET', '/api/covers/download': 'POST', '/api/logos': 'GET', '/api/logos/download': 'POST',
  '/api/links': 'GET', '/api/links/download': 'POST', '/api/links/scan': 'POST',
  '/api/update': 'GET', '/api/update/apply': 'POST', '/api/update/check': 'POST' };
/** Téléchargements en arrière-plan (T28, T29) : état lu par GET /api/<nom>, lancé par POST /api/<nom>/download. */
const JOB_NAMES = ['covers', 'logos', 'links', 'update'];
/** Route de lancement d'un travail (`/api/<nom>/download`, sauf la mise à jour : `/api/update/apply`). */
const startPath = (name) => `/api/${name}/${name === 'update' ? 'apply' : 'download'}`;

/** Corps vide `{}` exigé (pochettes, logos : le serveur décide de tout). @returns {object|null} */
const parseEmpty = (data) => (Object.keys(data).length ? null : {});
/** Corps `{items: [{url, target}]}` (T34) : 1 à MAX_ITEMS choix de deux chaînes, aucune autre clé. Le contenu est revérifié par link-relay.mjs. */
export function parseLinkItems(data) {
  const keys = Object.keys(data);
  if (keys.length !== 1 || keys[0] !== 'items' || !Array.isArray(data.items) || !data.items.length || data.items.length > MAX_ITEMS) return null;
  const ok = data.items.every((i) => i && typeof i === 'object' && !Array.isArray(i) && Object.keys(i).length === 2
    && typeof i.url === 'string' && typeof i.target === 'string' && i.url.length <= 2048 && i.target.length <= 32);
  return ok ? { items: data.items.map(({ url, target }) => ({ url, target })) } : null;
}

/** Hôtes acceptés pour ce port (le nom de domaine d'une page piégée, même résolu vers 127.0.0.1, est refusé). */
const allowedHosts = (port) => [`localhost:${port}`, `127.0.0.1:${port}`];

/**
 * Contrôles communs à toutes les requêtes de l'API.
 * @returns {{status: number, message: string}|null} le refus, ou null si la requête est acceptée
 */
export function checkRequestOrigin(headers, port, method) {
  if (!allowedHosts(port).includes(headers.host ?? '')) return { status: 403, message: 'Hôte refusé' };
  // Défense en profondeur : un navigateur qui sait dire « requête venue d'un autre site » est cru. Absent (curl, anciens navigateurs) : accepté.
  if (['cross-site', 'same-site'].includes(headers['sec-fetch-site'])) return { status: 403, message: 'Requête d\'un autre site refusée' };
  const origin = headers.origin;
  if (origin !== undefined) {
    return allowedHosts(port).some((h) => origin === `http://${h}`) ? null : { status: 403, message: 'Origine refusée' };
  }
  // Sans Origin (même origine en GET, outils locaux) : un POST doit porter l'en-tête personnalisé, qu'une page tierce ne peut pas envoyer sans autorisation.
  return method === 'POST' && headers[CUSTOM_HEADER] !== '1' ? { status: 403, message: 'En-tête X-Clone90 manquant' } : null;
}

/** Lit le corps en s'arrêtant à `limit` octets. @returns {Promise<string|null>} null si trop gros */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) return resolve(null);
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { chunks.length = 0; resolve(null); } else chunks.push(chunk);
    });
    req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Lit `{ "kind": ... }`. @returns {string|null} le type, ou null si le corps est invalide (autre clé comprise : aucun chemin accepté) */
function parseKind(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  return keys.length === 1 && keys[0] === 'kind' && typeof data.kind === 'string' && Object.hasOwn(KINDS, data.kind) ? data.kind : null;
}

/**
 * Crée l'API. `handle(req, res)` répond toujours (404 si désactivée).
 * @param {object} options
 * @param {string} options.root racine du projet (clone90.local.json, games.json)
 * @param {boolean} options.enabled voir isSettingsApiEnabled
 * @param {() => number} options.getPort port d'écoute réel
 * @param {(folders: {romsDir: string, biosDir: string}) => void} options.applyFolders applique les dossiers au serveur sans redémarrage
 * @param {(kind: 'roms'|'bios', options: {signal: AbortSignal}) => Promise<string|null>} options.chooseFolder boîte du Mac (injectable) ;
 *   null = annulé ; `signal` s'active si la requête HTTP se ferme (onglet fermé), pour libérer le verrou
 * @param {() => Promise<{exitCode: number}>} [options.regenerate] régénère games.json (le vrai générateur par défaut)
 * @param {(options: {onProgress: Function}) => Promise<{exitCode: number, dryRun: boolean, summary: object}>} [options.downloadCovers]
 *   téléchargement des pochettes (T28, `runCovers` par défaut), injectable pour les tests ; il régénère games.json lui-même
 * @param {(options: {onProgress: Function}) => Promise<{exitCode: number, summary: object}>} [options.downloadLogos]
 *   téléchargement des logos des machines (T29, `runLogos` par défaut), injectable ; il régénère games.json lui-même
 * @param {(url: string, systems: object[]) => Promise<object>} [options.scanLinks] analyse d'une page (T34, `scanPage` par défaut), injectable
 * @param {(items: object[], options: object) => Promise<object>} [options.fetchLinks] téléchargement des fichiers choisis (T34, `downloadLinks`), injectable
 * @param {() => Promise<object>} [options.checkUpdate] vérification de mise à jour (T35, `checkForUpdate` par défaut), injectable
 * @param {() => Promise<{ok: boolean, version?: string, message?: string}>} [options.runUpdate] application de la mise à jour (T35, `applyUpdate`)
 * @param {() => void} [options.restart] relance du serveur après une mise à jour réussie (T35, fourni par serve.mjs ; sans lui, rien)
 * @param {Record<string, string>} [options.baseHeaders] en-têtes de toutes les réponses (nosniff)
 */
export function createSettingsApi({ root, enabled, getPort, applyFolders, chooseFolder, baseHeaders = { 'X-Content-Type-Options': 'nosniff' },
  regenerate = () => runGenerate({ root, log: () => {}, logError: () => {} }),
  downloadCovers = (options) => runCovers({ root, ...options }),
  downloadLogos = (options) => runLogos({ root, ...options }),
  scanLinks = (url, systems) => scanPage(url, systems),
  fetchLinks = (items, options) => downloadLinks(items, options),
  checkUpdate = () => checkForUpdate({ root }),
  runUpdate = () => applyUpdate({ root }),
  restart = () => {} }) {
  let busy = false;
  // Par travail : idle | running (progress) | done (found, lines) | error (message) ; `id` = numéro du travail, pour que le client ne traite qu'une fois sa fin
  const jobs = { covers: { status: 'idle' }, logos: { status: 'idle' }, links: { status: 'idle' }, update: { status: 'idle' } };
  let checking = false;
  /** Travail de mise à jour (T35) : pull, puis régénération de games.json (un nouveau générateur peut lister autrement). L'échec porte son message. */
  async function runUpdateJob({ onProgress }) {
    onProgress({ phase: 'updating' });
    const result = await runUpdate();
    if (!result.ok) throw Object.assign(new Error('mise à jour refusée'), { userMessage: result.message });
    await regenerate().catch(() => {});
    return { exitCode: 0, summary: { found: [result.version] }, version: result.version };
  }
  let scanning = false;
  const readSystems = async () => JSON.parse(await readFile(join(root, 'systems.json'), 'utf8')).systems;
  /** Travail des liens (T34) : télécharge dans les dossiers utilisés, puis régénère games.json (même si rien n'a été téléchargé : sans effet). */
  async function runLinks({ onProgress, params }) {
    const s = await readLocalSettings(root);
    const summary = await fetchLinks(params.items, { romsDir: s.romsDir, biosDir: s.biosDir, systems: await readSystems(), onProgress });
    const { exitCode } = summary.downloaded.length ? await regenerate() : { exitCode: 0 };
    return { exitCode, summary: { ...summary, found: summary.downloaded } };
  }
  const jobSpecs = {
    covers: { run: downloadCovers, summary: (r) => formatSummary(r, { details: false }), busy: ERROR_TEXT.coversBusy, failed: ERROR_TEXT.coversFailed, what: 'pochettes' },
    logos: { run: downloadLogos, summary: (r) => formatLogosSummary(r, { details: false }), busy: ERROR_TEXT.logosBusy, failed: ERROR_TEXT.logosFailed, what: 'logos' },
    links: { run: runLinks, summary: (r) => formatLinksSummary(r.summary), busy: ERROR_TEXT.linksBusy, failed: ERROR_TEXT.linksFailed, what: 'fichiers',
      parse: parseLinkItems, maxBody: MAX_LINKS_BODY_BYTES },
    update: { run: runUpdateJob, summary: (r) => [`Clone90 est passé en v${r.version}. Redémarrage...`], busy: ERROR_TEXT.updateBusy, failed: ERROR_TEXT.updateFailed,
      what: 'mises à jour', after: () => setTimeout(restart, 300) },
  };
  let jobCounter = 0;

  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...baseHeaders, ...extra });
    res.end(JSON.stringify(body));
  };

  const busyMessage = () => jobSpecs[JOB_NAMES.find((n) => jobs[n].status === 'running')]?.busy ?? ERROR_TEXT.busy;

  async function currentSettings() {
    const s = await readLocalSettings(root);
    return { romsDir: s.romsDir, biosDir: s.biosDir, romsIsDefault: !s.custom.romsDir, biosIsDefault: !s.custom.biosDir };
  }

  /** Écrit le réglage, l'applique au serveur puis régénère games.json. */
  async function saveAndApply(patch) {
    await updateLocalSettings(root, patch);
    const s = await readLocalSettings(root);
    applyFolders({ romsDir: s.romsDir, biosDir: s.biosDir });
    const { exitCode } = await regenerate();
    return exitCode === 0 ? { status: 'ok' } : { status: 'error', message: ERROR_TEXT.generate };
  }

  async function choose(kind, signal) {
    const key = KINDS[kind];
    if (!isDefaultKind(kind)) {
      let path;
      try { path = await chooseFolder(kind, { signal }); } catch (err) {
        console.error('Boîte de choix du Mac impossible :', err.message);
        return { status: 'error', message: ERROR_TEXT.dialog };
      }
      if (path === null) return { status: 'cancelled' };
      const problem = await folderProblemKind(path);
      if (problem) return { status: 'refused', message: REFUSALS[problem] };
      return saveAndApply({ [key]: path });
    }
    return saveAndApply({ [key]: null });
  }

  async function handleChoose(req, res) {
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) return send(res, 415, { message: 'Type de contenu refusé' });
    const text = await readBody(req, MAX_BODY_BYTES);
    if (text === null) return send(res, 413, { message: 'Requête trop grande' }, { Connection: 'close' });
    const kind = parseKind(text);
    if (kind === null) return send(res, 400, { message: 'Requête invalide' });
    if (busy) return send(res, 409, { status: 'busy', message: busyMessage() });
    busy = true;
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    try {
      let result;
      try { result = await choose(kind, abort.signal); } catch (err) {
        console.error('Enregistrement des dossiers impossible :', err.message); // le détail (chemins) reste dans le journal du serveur
        result = { status: 'error', message: ERROR_TEXT.save };
      }
      return send(res, 200, { ...result, settings: await currentSettings() });
    } finally { busy = false; }
  }

  /** POST /api/<nom>/download : lance le téléchargement en arrière-plan et répond tout de suite ; l'avancement se lit par GET /api/<nom>. */
  async function handleJobStart(name, req, res) {
    const spec = jobSpecs[name];
    const data = await readJson(req, res, spec.maxBody ?? MAX_BODY_BYTES);
    if (data === undefined) return undefined;
    const params = (spec.parse ?? parseEmpty)(data);
    if (params === null) return send(res, 400, { message: 'Requête invalide' });
    if (busy) return send(res, 409, { status: 'busy', message: busyMessage() });
    busy = true;
    jobCounter += 1;
    jobs[name] = { id: jobCounter, status: 'running', progress: { phase: name === 'covers' ? 'listing' : 'downloading', done: 0, total: 0 } };
    runJob(name, jobCounter, params).finally(() => { busy = false; });
    return send(res, 202, { status: 'started' });
  }

  /** Lit un corps JSON objet. @returns {Promise<object|undefined>} undefined si la réponse d'erreur est déjà envoyée */
  async function readJson(req, res, limit) {
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) { send(res, 415, { message: 'Type de contenu refusé' }); return undefined; }
    const text = await readBody(req, limit);
    if (text === null) { send(res, 413, { message: 'Requête trop grande' }, { Connection: 'close' }); return undefined; }
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { send(res, 400, { message: 'Requête invalide' }); return undefined; }
    return data;
  }

  /** POST /api/links/scan (T34) : `{url}` -> `{status: 'ok', url, files, truncated}` ou `{status: 'error', message}`. Une analyse à la fois. */
  async function handleScan(req, res) {
    const data = await readJson(req, res, MAX_SCAN_BODY_BYTES);
    if (data === undefined) return undefined;
    if (Object.keys(data).length !== 1 || typeof data.url !== 'string') return send(res, 400, { message: 'Requête invalide' });
    if (scanning) return send(res, 409, { status: 'busy', message: ERROR_TEXT.scanBusy });
    scanning = true;
    try {
      const result = await scanLinks(data.url, await readSystems());
      return send(res, 200, { status: 'ok', ...result });
    } catch (err) {
      if (!(err instanceof RelayError)) console.error('Analyse de page impossible :', err.message);
      return send(res, 200, { status: 'error', message: err instanceof RelayError ? err.message : ERROR_TEXT.scanFailed });
    } finally { scanning = false; }
  }

  /** POST /api/update/check (T35) : corps `{}` -> résultat de checkForUpdate (uptodate, available, error). Une vérification à la fois. */
  async function handleUpdateCheck(req, res) {
    const data = await readJson(req, res, MAX_BODY_BYTES);
    if (data === undefined) return undefined;
    if (Object.keys(data).length) return send(res, 400, { message: 'Requête invalide' });
    if (checking) return send(res, 409, { status: 'busy', message: 'Vérification déjà en cours.' });
    checking = true;
    try { return send(res, 200, await checkUpdate()); } catch (err) {
      console.error('Vérification de mise à jour impossible :', err.message);
      return send(res, 200, { status: 'error', message: 'Impossible de vérifier les mises à jour.' });
    } finally { checking = false; }
  }

  async function runJob(name, id, params) {
    const spec = jobSpecs[name];
    try {
      const result = await spec.run({ params, onProgress: (progress) => { jobs[name] = { id, status: 'running', progress }; } });
      jobs[name] = result.exitCode === 0
        ? { id, status: 'done', found: result.summary.found.length, lines: spec.summary(result), ...(result.version && { version: result.version }) }
        : { id, status: 'error', message: ERROR_TEXT.generate };
      if (result.exitCode === 0) spec.after?.();
    } catch (err) {
      console.error(`Téléchargement des ${spec.what} impossible :`, err.message);
      jobs[name] = { id, status: 'error', message: err.userMessage ?? spec.failed };
    }
  }

  return {
    /** Traite une requête /api/... (le routage par préfixe est fait par serve.mjs). */
    async handle(req, res) {
      try {
        const path = (req.url ?? '').split('?')[0].split('#')[0];
        const known = Object.hasOwn(ROUTES, path);
        if (!enabled || !known) return send(res, 404, { message: 'Introuvable' });
        const refused = checkRequestOrigin(req.headers, getPort(), req.method);
        if (refused) return send(res, refused.status, { message: refused.message });
        const method = ROUTES[path];
        if (req.method !== method) return send(res, 405, { message: 'Méthode non autorisée' }, { Allow: method });
        if (path === '/api/links/scan') return await handleScan(req, res);
        if (path === '/api/update/check') return await handleUpdateCheck(req, res);
        const job = JOB_NAMES.find((n) => path === `/api/${n}` || path === startPath(n));
        if (job && method === 'GET') return send(res, 200, jobs[job]);
        if (job) return await handleJobStart(job, req, res);
        if (method === 'GET') return send(res, 200, await currentSettings());
        return await handleChoose(req, res);
      } catch (err) {
        console.error('API des dossiers :', err.message);
        if (!res.headersSent) send(res, 500, { message: 'Erreur interne' });
      }
    },
  };
}
