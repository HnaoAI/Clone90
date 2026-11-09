// Racine du projet, partagée par les scripts (serve.mjs, generate-games.mjs). Aucune dépendance.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// INVARIANT : la racine est celle du projet, jamais le dossier courant (voir revue T1).
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
