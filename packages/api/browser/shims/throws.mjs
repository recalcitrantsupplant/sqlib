// A module that is not available in the browser build. Importing it works;
// using it throws.
const fail = () => { throw new Error('This module is not available in the browser build'); };
const handler = { get: (_t, k) => (k === '__esModule' ? false : k === 'then' ? undefined : fail) };
export default new Proxy({}, handler);
