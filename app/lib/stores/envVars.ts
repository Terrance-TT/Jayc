import { map } from 'nanostores';
import { webcontainer } from '~/lib/webcontainer';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('EnvVarsStore');

export type EnvVars = Record<string, string>;

const STORAGE_KEY = 'jayc_env_vars';
const ENV_FILE_NAME = '.env';

/*
 * Project-level environment variables (Replit-style secrets for the *generated*
 * app). Unlike app-level secrets (stores/secrets.ts), these never leave the
 * browser: they are persisted to localStorage and mirrored into the
 * WebContainer as a `.env` file so generated code can read them via
 * process.env / import.meta.env through the usual dotenv tooling.
 */
export const envVarsStore = map<EnvVars>({});

let initialized = false;

/** call once from a client-only component; safe to call repeatedly */
export function initEnvVars() {
  if (initialized || import.meta.env.SSR) {
    return;
  }

  initialized = true;

  envVarsStore.set(loadEnvVars());

  envVarsStore.subscribe((vars) => {
    persistEnvVars(vars);
    void syncEnvToWebcontainer(vars);
  });
}

export function setEnvVar(name: string, value: string) {
  envVarsStore.setKey(name, value);
}

export function removeEnvVar(name: string) {
  const next = { ...envVarsStore.get() };
  delete next[name];
  envVarsStore.set(next);
}

export function isValidEnvVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function serializeEnv(vars: EnvVars): string {
  const lines = Object.entries(vars)
    .filter(([name, value]) => isValidEnvVarName(name) && value.length > 0)
    .map(([name, value]) => `${name}=${escapeEnvValue(value)}`);

  return ['# Managed by Jayc — Tools & Connectors. Do not commit this file.', ...lines, ''].join('\n');
}

function escapeEnvValue(value: string): string {
  // leave simple values bare; quote anything with spaces, #, quotes, etc.
  if (/^[A-Za-z0-9_./:@%+,=-]*$/.test(value)) {
    return value;
  }

  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function loadEnvVars(): EnvVars {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    return raw ? (JSON.parse(raw) as EnvVars) : {};
  } catch {
    return {};
  }
}

function persistEnvVars(vars: EnvVars) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vars));
  } catch (error) {
    logger.error('Failed to persist env vars', error);
  }
}

/*
 * Writing `.env` into the workdir does two things:
 *  1. dev servers started in the container pick the variables up (dotenv,
 *     Vite, Next, etc. all read `.env` automatically)
 *  2. the AI sees the real variable names in the file tree, so it codes
 *     against them instead of hallucinating placeholder names
 */
async function syncEnvToWebcontainer(vars: EnvVars) {
  try {
    const wc = await webcontainer;
    await wc.fs.writeFile(ENV_FILE_NAME, serializeEnv(vars));
  } catch (error) {
    logger.error('Failed to sync .env to WebContainer', error);
  }
}
