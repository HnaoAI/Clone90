// API locale des dossiers de jeux (T25) : GET /api/settings, POST /api/settings/choose. Branchée par serve.mjs.
// Dépend de local-settings.mjs (lecture, validation, écriture) et de generate-games.mjs (régénération), sans les dupliquer.
// INVARIANT (sécurité) : active seulement si le serveur n'écoute que sur ce Mac (serve.mjs, isSettingsApiEnabled). Chaque requête doit
//   avoir un en-tête Host localhost:<port> ou 127.0.0.1:<port> (anti DNS rebinding), une Origin identique (ou aucune avec X-Clone90: 1),
//   un Content-Type application/json et un corps de 1 Ko au plus. Le navigateur ne fournit JAMAIS de chemin : il choisit un type
//   ('roms', 'bios', 'roms-default', 'bios-default'), c'est la boîte du Mac qui choisit le dossier. Une seule boîte ouverte à la fois (verrou).
import { readLocalSettings, updateLocalSettings, folderProblemKind } from './local-settings.mjs';
import { runGenerate } from './generate-games.mjs';

export const MAX_BODY_BYTES = 1024;
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
};

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
 * @param {Record<string, string>} [options.baseHeaders] en-têtes de toutes les réponses (nosniff)
 */
export function createSettingsApi({ root, enabled, getPort, applyFolders, chooseFolder, baseHeaders = { 'X-Content-Type-Options': 'nosniff' },
  regenerate = () => runGenerate({ root, log: () => {}, logError: () => {} }) }) {
  let busy = false;

  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...baseHeaders, ...extra });
    res.end(JSON.stringify(body));
  };

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
    if (busy) return send(res, 409, { status: 'busy', message: ERROR_TEXT.busy });
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

  return {
    /** Traite une requête /api/... (le routage par préfixe est fait par serve.mjs). */
    async handle(req, res) {
      try {
        const path = (req.url ?? '').split('?')[0].split('#')[0];
        const known = path === '/api/settings' || path === '/api/settings/choose';
        if (!enabled || !known) return send(res, 404, { message: 'Introuvable' });
        const refused = checkRequestOrigin(req.headers, getPort(), req.method);
        if (refused) return send(res, refused.status, { message: refused.message });
        const method = path === '/api/settings' ? 'GET' : 'POST';
        if (req.method !== method) return send(res, 405, { message: 'Méthode non autorisée' }, { Allow: method });
        if (method === 'GET') return send(res, 200, await currentSettings());
        return await handleChoose(req, res);
      } catch (err) {
        console.error('API des dossiers :', err.message);
        if (!res.headersSent) send(res, 500, { message: 'Erreur interne' });
      }
    },
  };
}
