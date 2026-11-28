// unenv's node:util, with a debuglog that stays silent like Node's when
// NODE_DEBUG does not name the section.
import * as util from 'unenv/node/util';
export * from 'unenv/node/util';
export function debuglog() {
  const log = () => {};
  log.enabled = false;
  return log;
}
export const debug = debuglog;
export default { ...util.default, debuglog, debug };
