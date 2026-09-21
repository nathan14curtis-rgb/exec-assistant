/**
 * Local config for the one-off setup scripts (not used by the Worker).
 *
 * Values come from `.dev.vars` in the repo root, which WINS over any
 * same-named environment variable. That is the opposite of the usual dotenv
 * precedence, on purpose: `.dev.vars` is the file you just edited, whereas a
 * shell variable is usually left over from an earlier session and silently
 * shadows it. `.dev.vars` is gitignored — it holds a path to your Google
 * service-account key, never the key itself.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parse a KEY=value file. Handles quoted values, `export ` prefixes, comments
 * and blank lines.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Load `.dev.vars` into process.env, overriding anything already set and
 * reporting each value it shadowed — a stale `$env:SHEET_ID` from an earlier
 * shell is otherwise invisible and very confusing.
 */
export function loadEnvFile(file = '.dev.vars'): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const [k, v] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
    if (!v) continue; // an empty line in the file shouldn't erase a real value
    const shadowed = process.env[k];
    if (shadowed !== undefined && shadowed !== v) {
      console.log(`${k}: using .dev.vars (ignoring the environment variable already set)`);
    }
    process.env[k] = v;
  }
}

function fail(message: string): never {
  console.error(`\n✘ ${message}\n`);
  console.error('Fill in .dev.vars — copy .dev.vars.example to .dev.vars and edit it.\n');
  process.exit(1);
}

export interface SetupConfig {
  saEmail: string;
  saKey: string;
  sheetId: string;
  legacyTab: string;
}

/**
 * Resolve Google credentials from either GOOGLE_SA_JSON (a path to the key
 * file Google Cloud hands you — preferred, nothing to transcribe) or the
 * separate GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY pair.
 */
export function loadSetupConfig(): SetupConfig {
  loadEnvFile();

  const sheetId = process.env.SHEET_ID?.trim();
  if (!sheetId) fail('SHEET_ID is not set — fill it in in .dev.vars.');
  if (/^your-|^the-real-/.test(sheetId)) fail(`SHEET_ID is still a placeholder ("${sheetId}").`);

  let saEmail = process.env.GOOGLE_SA_EMAIL?.trim() ?? '';
  let saKey = process.env.GOOGLE_SA_PRIVATE_KEY ?? '';

  const jsonPath = process.env.GOOGLE_SA_JSON?.trim();
  if (jsonPath) {
    const resolved = resolve(process.cwd(), jsonPath);
    if (!existsSync(resolved)) fail(`GOOGLE_SA_JSON points at a file that does not exist:\n  ${resolved}`);
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(readFileSync(resolved, 'utf8'));
    } catch (err) {
      fail(`GOOGLE_SA_JSON is not valid JSON: ${(err as Error).message}`);
    }
    if (!parsed.client_email || !parsed.private_key) {
      fail('That JSON has no client_email / private_key — is it the service-account key file?');
    }
    saEmail = parsed.client_email;
    saKey = parsed.private_key;
  }

  if (!saEmail) fail('No service account. Set GOOGLE_SA_JSON (preferred) or GOOGLE_SA_EMAIL.');
  if (!saKey) fail('No private key. Set GOOGLE_SA_JSON (preferred) or GOOGLE_SA_PRIVATE_KEY.');
  if (/^your-|^the-real-/.test(saEmail)) fail(`GOOGLE_SA_EMAIL is still a placeholder ("${saEmail}").`);

  // A key set through a shell variable often arrives with literal \n escapes.
  saKey = saKey.replace(/\\n/g, '\n');
  if (!saKey.includes('BEGIN')) fail('The private key does not look like a PEM block.');

  return { saEmail, saKey, sheetId, legacyTab: process.env.LEGACY_TAB?.trim() || 'Ideas' };
}
