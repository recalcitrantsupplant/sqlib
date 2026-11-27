// Runs before any API module: Node globals, the fixed environment, and the
// configuration files the API reads at start-up.
import process from 'unenv/node/process';
import { Buffer } from 'unenv/node/buffer';
import { setImmediate, clearImmediate } from 'unenv/node/timers';
import { seedFile } from './shims/fs.mjs';
import { env, files } from 'sqlib-browser-config';

globalThis.global ??= globalThis;
globalThis.process = process;
globalThis.Buffer ??= Buffer;
globalThis.setImmediate ??= setImmediate;
globalThis.clearImmediate ??= clearImmediate;
// unenv's process defines some fields as getters, so set them as properties.
const set = (key, value) => Object.defineProperty(process, key, { value, writable: true, configurable: true });
set('env', { ...env });
set('cwd', () => '/app');
set('platform', 'linux');
set('versions', { ...(process.versions ?? {}), node: '22.0.0' });
set('version', 'v22.0.0');
const memoryUsage = () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 });
memoryUsage.rss = () => 0;
set('memoryUsage', memoryUsage);
set('exit', code => { throw new Error(`process.exit(${code}) in the browser build`); });
set('on', () => process);
set('once', () => process);
set('off', () => process);
set('emitWarning', () => {});
for (const [path, text] of Object.entries(files)) seedFile(path, text);
