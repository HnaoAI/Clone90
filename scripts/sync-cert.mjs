// Certificats HTTPS du partage avec le téléphone (T43). Le téléphone ouvre Clone90 en HTTPS (GitHub Pages) : son navigateur refuse de lire
// une adresse http://, donc le Mac répond en HTTPS avec un certificat signé par une petite autorité « Clone90 » propre à CE Mac, que la
// personne installe UNE fois sur le téléphone. Fabriqués avec la commande `openssl` du Mac (aucune dépendance npm).
// INVARIANT (sécurité) : l'autorité est LIMITÉE (nameConstraints) aux adresses privées du réseau local, à localhost et aux noms en .local :
//   même volée, sa clé ne permet pas de se faire passer pour un autre site auprès du téléphone. Clés lisibles par la seule personne (0600),
//   dans `.clone90-sync/` (dossier caché : jamais servi par serve.mjs, ignoré par git).
// Le certificat du serveur est refait quand les adresses du Mac changent (autre Wi-Fi) ou avant son expiration : signé par la même autorité,
//   le téléphone n'a rien à réinstaller.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const SYNC_CERT_DIR = '.clone90-sync';
/** Nom affiché par Android dans la liste des certificats installés. */
export const CA_NAME = 'Clone90 - partage local';
/** Durées : autorité 10 ans ; certificat du serveur 397 jours (règle des navigateurs), refait 30 jours avant la fin. */
const CA_DAYS = 3650;
const SERVER_DAYS = 397;
const RENEW_BEFORE_MS = 30 * 24 * 3600 * 1000;

/** Domaines autorisés pour l'autorité (format openssl). */
export const NAME_CONSTRAINTS = 'critical,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0,'
  + 'permitted;IP:127.0.0.0/255.0.0.0,permitted;DNS:local,permitted;DNS:localhost';

/** Lance openssl. @returns {Promise<string>} sortie standard @throws {Error} openssl absent ou en erreur */
export function runOpenssl(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile('openssl', args, { cwd, timeout: 30000 }, (err, stdout, stderr) => (err ? reject(new Error(`openssl ${args[0]} : ${stderr || err.message}`)) : resolve(stdout)));
  });
}

/**
 * Noms du certificat du serveur (subjectAltName) : adresses IPv4 du Mac, localhost, 127.0.0.1 et `<nom>.local`.
 * @param {string[]} addresses IPv4 du Mac @param {string} [hostname] nom de l'ordinateur
 * @returns {string} ex. `IP:192.168.1.20,IP:127.0.0.1,DNS:localhost,DNS:mac-de-hicham.local`
 */
export function serverAltNames(addresses, hostname = '') {
  const ips = [...new Set([...addresses, '127.0.0.1'])].filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)).sort();
  const local = hostname.toLowerCase().replace(/\.local$/, '').replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  return [...ips.map((ip) => `IP:${ip}`), 'DNS:localhost', ...(local ? [`DNS:${local}.local`] : [])].join(',');
}

const caConfig = () => [
  '[req]', 'distinguished_name = dn', 'x509_extensions = v3_ca', 'prompt = no',
  '[dn]', `CN = ${CA_NAME}`, 'O = Clone90',
  '[v3_ca]', 'basicConstraints = critical,CA:TRUE,pathlen:0', 'keyUsage = critical,keyCertSign,cRLSign',
  'subjectKeyIdentifier = hash', `nameConstraints = ${NAME_CONSTRAINTS}`, '',
].join('\n');

const serverExt = (altNames) => [
  'basicConstraints = critical,CA:FALSE', 'keyUsage = critical,digitalSignature,keyEncipherment',
  'extendedKeyUsage = serverAuth', `subjectAltName = ${altNames}`, '',
].join('\n');

/**
 * Prépare (si besoin) l'autorité et le certificat du serveur, et les renvoie.
 * @param {{root: string, addresses: string[], hostname?: string, now?: () => number, openssl?: typeof runOpenssl}} options
 * @returns {Promise<{key: string, cert: string, ca: string, altNames: string, created: boolean}>} PEM ; `created` : certificat du serveur refait
 * @throws {Error} openssl absent ou en erreur
 */
export async function ensureCertificates({ root, addresses, hostname = '', now = Date.now, openssl = runOpenssl }) {
  const dir = join(root, SYNC_CERT_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = (name) => join(dir, name);
  const read = (name) => readFile(file(name), 'utf8').catch(() => null);
  const secure = async (name) => { await chmod(file(name), 0o600).catch(() => {}); };

  if (!(await read('ca.key')) || !(await read('ca.pem'))) {
    await writeFile(file('ca.cnf'), caConfig());
    await openssl(['genrsa', '-out', 'ca.key', '2048'], { cwd: dir });
    await secure('ca.key');
    await openssl(['req', '-x509', '-new', '-key', 'ca.key', '-sha256', '-days', String(CA_DAYS), '-config', 'ca.cnf', '-out', 'ca.pem'], { cwd: dir });
    await rm(file('server.json'), { force: true }); // nouvelle autorité : le certificat du serveur doit être refait
  }
  const altNames = serverAltNames(addresses, hostname);
  let meta = null;
  try { meta = JSON.parse(await read('server.json')); } catch { meta = null; }
  const fresh = meta && meta.altNames === altNames && Number(meta.expiresAt) - now() > RENEW_BEFORE_MS && (await read('server.pem')) && (await read('server.key'));
  if (!fresh) {
    await writeFile(file('server.ext'), serverExt(altNames));
    await openssl(['genrsa', '-out', 'server.key', '2048'], { cwd: dir });
    await secure('server.key');
    await openssl(['req', '-new', '-key', 'server.key', '-subj', '/CN=Clone90 Mac/O=Clone90', '-out', 'server.csr'], { cwd: dir });
    await openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-sha256',
      '-days', String(SERVER_DAYS), '-extfile', 'server.ext', '-out', 'server.pem'], { cwd: dir });
    await writeFile(file('server.json'), JSON.stringify({ altNames, expiresAt: now() + SERVER_DAYS * 24 * 3600 * 1000 }));
  }
  return { key: await read('server.key'), cert: await read('server.pem'), ca: await read('ca.pem'), altNames, created: !fresh };
}
