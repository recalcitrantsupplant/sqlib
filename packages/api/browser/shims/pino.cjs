// A console logger with the parts of pino's API that sqlib and Fastify use.
const values = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Infinity };
const consoleOf = { trace: 'debug', debug: 'debug', info: 'info', warn: 'warn', error: 'error', fatal: 'error' };
const serializersSym = Symbol.for('pino.serializers');
const symbols = { serializersSym, chindingsSym: Symbol.for('pino.chindings'), streamSym: Symbol.for('pino.stream') };

function errSerializer(err) {
  if (!(err instanceof Error)) return err;
  return { type: err.name, message: err.message, stack: err.stack, ...(err.code ? { code: err.code } : {}) };
}

function make(levelName, bindings, serializers) {
  const logger = {
    levels: { values, labels: Object.fromEntries(Object.entries(values).map(([k, v]) => [v, k])) },
    [serializersSym]: serializers,
    get level() { return levelName; },
    set level(l) { levelName = l; },
    get levelVal() { return values[levelName]; },
    isLevelEnabled: l => values[l] >= values[levelName],
    bindings: () => ({ ...bindings }),
    setBindings: b => Object.assign(bindings, b),
    child(childBindings = {}, options = {}) {
      return make(options.level ?? levelName, { ...bindings, ...childBindings }, { ...serializers, ...(options.serializers ?? {}) });
    },
    flush() {},
    on() { return logger; },
  };
  for (const name of Object.keys(consoleOf)) {
    logger[name] = (obj, ...rest) => {
      if (values[name] < values[levelName]) return;
      const fn = console[consoleOf[name]];
      if (typeof obj === 'string') fn('[sqlib]', obj, ...rest);
      else if (obj instanceof Error) fn('[sqlib]', ...rest, obj);
      else {
        const o = obj?.err ? { ...obj, err: errSerializer(obj.err) } : obj;
        let text;
        try { text = JSON.stringify(o); } catch { text = String(o); }
        fn('[sqlib]', ...rest, text);
      }
    };
  }
  logger.silent = () => {};
  return logger;
}

function pino(opts = {}) {
  const level = typeof opts === 'object' && opts?.level ? opts.level : 'info';
  return make(level, { ...(opts?.base ?? {}), ...(opts?.name ? { name: opts.name } : {}) }, { ...(opts?.serializers ?? {}) });
}
pino.symbols = symbols;
pino.stdSerializers = { err: errSerializer, req: r => r, res: r => r };
pino.stdTimeFunctions = { epochTime: () => `,"time":${Date.now()}`, isoTime: () => `,"time":"${new Date().toISOString()}"`, nullTime: () => '' };
pino.destination = () => ({ write() {} });
pino.multistream = () => ({ write() {} });
pino.levels = { values };
pino.pino = pino;
pino.default = pino;
module.exports = pino;
