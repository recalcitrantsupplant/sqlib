/*
 * Per-file reset for the files that run without module isolation.
 *
 * Those files share one module registry per worker (`isolate: false`, see
 * vitest.config.ts), so a module-level singleton outlives the file that filled
 * it. Under isolation each file got fresh copies by re-evaluating every module;
 * here each singleton is put back explicitly instead, which is what makes the
 * shared registry safe. Setup files run before every test file, so this runs
 * before each one imports anything.
 *
 * A singleton added to `src` that tests write to belongs here too. The symptom
 * of a missing one is a file that passes alone and fails in the full run.
 */
import { setAuthStore } from '../src/auth/AuthStore.js';
import { resetAuthConfig } from '../src/auth/config.js';
import { resetTokenVerifier } from '../src/auth/tokenVerifier.js';
import { resetEarlReportConfig } from '../src/config/earlReport.js';
import { resetFeatureFlags } from '../src/config/featureFlags.js';
import { resetReadOnly } from '../src/config/readOnly.js';
import { clearProbeResults } from '../src/lib/backendProbe.js';
import { clearCacheCoordinator } from '../src/lib/CacheCoordinatorProvider.js';
import { resetChangeSubscribers } from '../src/lib/changeEvents.js';
import { oxigraphStoreManager } from '../src/lib/OxigraphStoreManager.js';
import { clearEntityStoreExecutor } from '../src/persistence/EntityStore.js';
import { setPersistenceAdapter } from '../src/persistence/adapterRegistry.js';
import { resetAssistantConfiguration } from '../src/routes/assistant.js';

/*
 * Process-wide state as the first file in this worker saw it, restored for
 * every later one:
 *
 * - the environment, which the config modules below re-read;
 * - `globalThis.fetch`, which several files assign outright;
 * - process error listeners: importing `src/index.ts` installs one that exits
 *   the process, which would turn a later file's stray rejection into a dead
 *   worker.
 */
const PROCESS_EVENTS = ['uncaughtException', 'unhandledRejection'] as const;
type Listener = (...args: unknown[]) => void;
const globals = globalThis as {
  __sqlibInitial?: {
    env: NodeJS.ProcessEnv;
    fetch: typeof globalThis.fetch;
    listeners: Map<string, Listener[]>;
  };
};
if (globals.__sqlibInitial) {
  const { env, fetch, listeners } = globals.__sqlibInitial;
  for (const key of Object.keys(process.env)) {
    if (!(key in env)) delete process.env[key];
  }
  Object.assign(process.env, env);
  globalThis.fetch = fetch;
  for (const event of PROCESS_EVENTS) {
    const initial = listeners.get(event)!;
    for (const listener of process.listeners(event) as Listener[]) {
      if (!initial.includes(listener)) process.off(event, listener);
    }
  }
} else {
  globals.__sqlibInitial = {
    env: { ...process.env },
    fetch: globalThis.fetch,
    listeners: new Map(PROCESS_EVENTS.map(event => [event, process.listeners(event) as Listener[]])),
  };
}

oxigraphStoreManager.reset();
clearEntityStoreExecutor();
clearCacheCoordinator();
setPersistenceAdapter(null);
setAuthStore(null);
resetAuthConfig();
resetTokenVerifier();
resetFeatureFlags();
resetReadOnly();
resetEarlReportConfig();
clearProbeResults();
resetChangeSubscribers();
resetAssistantConfiguration();
