// Commande du partage Mac -> téléphone (T43) depuis Clone90 sur le Mac : GET /api/sync (état), POST /api/sync/enable, POST /api/sync/disable,
// POST /api/sync/pair (nouveau code à 6 chiffres), POST /api/sync/forget (oublier les téléphones). Corps `{}` seulement.
// Branchée par serve.mjs, comme settings-api.mjs, et soumise aux MÊMES contrôles (checkRequestOrigin : Host localhost, Origin, X-Clone90) :
// seul le navigateur du Mac peut activer le partage ou afficher un code. Le serveur de partage lui-même est dans sync-server.mjs.
// INVARIANT (sécurité) : rien n'est ouvert au réseau local tant que la personne n'a pas cliqué « Activer le partage » (état gardé dans
//   clone90.sync.json, repris au lancement suivant de Clone90) ; « Arrêter le partage » ferme le port.
import { hostname as osHostname, networkInterfaces } from 'node:os';
import { checkRequestOrigin, MAX_BODY_BYTES } from './settings-api.mjs';
import { createPairing } from './sync-pairing.mjs';
import { ensureCertificates } from './sync-cert.mjs';
import { createSyncHandler, startSyncServer, readSystemIds } from './sync-server.mjs';
import { readLocalSettings } from './local-settings.mjs';
import { SYNC_PORT } from '../js/sync-plan.js';

const ROUTES = ['/api/sync', '/api/sync/enable', '/api/sync/disable', '/api/sync/pair', '/api/sync/forget'];
const ERRORS = {
  openssl: 'Le certificat n\'a pas pu être créé (commande openssl du Mac introuvable ?).',
  port: `Le port ${SYNC_PORT} est déjà utilisé sur ce Mac : le partage n'a pas pu démarrer.`,
  notRunning: 'Activez d\'abord le partage.',
};

/** Adresses IPv4 du Mac sur le réseau local (comme serve.mjs). */
export function lanAddresses(interfaces = networkInterfaces()) {
  return Object.values(interfaces).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

/**
 * Crée la commande du partage.
 * @param {object} options
 * @param {string} options.root racine du projet
 * @param {boolean} options.enabled API permise (même règle que settings-api : serveur limité au Mac, macOS)
 * @param {() => number} options.getPort port du serveur de Clone90 (contrôle de Host)
 * @param {number} [options.syncPort] @param {() => string[]} [options.getAddresses] @param {() => string} [options.getHostname]
 * @param {typeof ensureCertificates} [options.certificates] @param {typeof startSyncServer} [options.start] injectables pour les tests
 * @param {object} [options.pairing] appairage déjà créé (tests)
 */
export async function createSyncController({ root, enabled, getPort, syncPort = SYNC_PORT, getAddresses = () => lanAddresses(), getHostname = () => osHostname(),
  certificates = ensureCertificates, start = startSyncServer, pairing: givenPairing, baseHeaders = { 'X-Content-Type-Options': 'nosniff' } }) {
  const pairing = givenPairing ?? await createPairing({ root });
  let server = null;
  let tls = null;
  let error = null;
  let busy = false;

  const handler = createSyncHandler({
    pairing,
    getDirs: async () => { const s = await readLocalSettings(root); return { romsDir: s.romsDir, biosDir: s.biosDir }; },
    getSystemIds: () => readSystemIds(root),
    getCa: () => tls?.ca ?? '',
  });

  /** Certificat à jour pour les adresses actuelles (autre Wi-Fi : nouveau certificat, même autorité). */
  async function refreshTls() {
    const next = await certificates({ root, addresses: getAddresses(), hostname: getHostname() });
    if (server && next.created) server.setSecureContext({ key: next.key, cert: next.cert });
    tls = next;
  }

  async function startServer() {
    error = null;
    try { await refreshTls(); } catch (err) {
      console.error('Partage : certificat impossible :', err.message);
      error = ERRORS.openssl;
      return false;
    }
    try { server = await start({ tls, port: syncPort, handler }); } catch (err) {
      console.error('Partage : démarrage impossible :', err.message);
      error = err.code === 'EADDRINUSE' ? ERRORS.port : `Le partage n'a pas pu démarrer (${err.code ?? err.message}).`;
      return false;
    }
    return true;
  }

  async function stopServer() {
    const s = server;
    server = null;
    if (s) await new Promise((r) => { s.close(() => r()); s.closeAllConnections?.(); });
  }

  /** État affiché sur le Mac. */
  async function status() {
    if (server) await refreshTls().catch(() => {});
    return {
      enabled: pairing.enabled, running: Boolean(server), port: syncPort,
      addresses: server ? getAddresses().map((a) => `https://${a}:${syncPort}`) : [],
      code: server ? pairing.currentCode() : null, devices: pairing.deviceCount, error,
    };
  }

  const send = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...baseHeaders });
    res.end(JSON.stringify(body));
  };

  /** Lit un corps `{}`. @returns {Promise<boolean>} faux si refusé (réponse déjà envoyée) */
  async function readEmptyBody(req, res) {
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) { send(res, 415, { message: 'Type de contenu refusé' }); return false; }
    const text = await new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > MAX_BODY_BYTES) req.destroy(); });
      req.on('end', () => resolve(data));
      req.on('error', () => resolve(null));
    });
    let body = null;
    try { body = JSON.parse(text ?? ''); } catch { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) { send(res, 400, { message: 'Requête invalide' }); return false; }
    return true;
  }

  return {
    /** Vrai pour une adresse de cette API. */
    owns: (path) => ROUTES.includes(path),
    /** Au lancement de Clone90 : reprend le partage s'il était activé. Ne lève jamais. */
    async startIfEnabled() {
      if (enabled && pairing.enabled) await startServer().catch(() => {});
    },
    async stop() { await stopServer(); },
    async handle(req, res) {
      try {
        const path = (req.url ?? '').split('?')[0];
        if (!enabled || !ROUTES.includes(path)) return send(res, 404, { message: 'Introuvable' });
        const refused = checkRequestOrigin(req.headers, getPort(), req.method);
        if (refused) return send(res, refused.status, { message: refused.message });
        const method = path === '/api/sync' ? 'GET' : 'POST';
        if (req.method !== method) return send(res, 405, { message: 'Méthode non autorisée' });
        if (method === 'GET') return send(res, 200, await status());
        if (!(await readEmptyBody(req, res))) return undefined;
        if (busy) return send(res, 409, { message: 'Une demande de partage est déjà en cours.' });
        busy = true;
        try {
          if (path === '/api/sync/enable') {
            if (!server && await startServer()) await pairing.setEnabled(true);
          } else if (path === '/api/sync/disable') {
            await stopServer();
            await pairing.setEnabled(false);
            error = null;
          } else if (path === '/api/sync/pair') {
            if (!server) return send(res, 409, { ...(await status()), message: ERRORS.notRunning });
            pairing.newCode();
          } else {
            await pairing.forgetDevices();
          }
        } finally { busy = false; }
        return send(res, 200, await status());
      } catch (err) {
        console.error('API du partage :', err.message);
        if (!res.headersSent) send(res, 500, { message: 'Erreur interne' });
        return undefined;
      }
    },
  };
}
