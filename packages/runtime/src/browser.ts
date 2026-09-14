/**
 * Everything a page needs, in one bundle.
 *
 * The exported demo page inlines a single CommonJS file. Inlining `index.cjs`
 * and `args-element.cjs` separately would work but would carry two copies of the
 * term serialiser — harmless, yet the sort of duplication that invites someone
 * to wonder which one is authoritative. This entry exists so the answer stays
 * "there is only one".
 *
 * Registration is left to the caller (`defineArgsElement()`), so importing this
 * has no side effects.
 */

export * from './index.js';
export {
  ARGS_ELEMENT_STYLES,
  // The base the element extends, carried here for the same reason it is
  // exported at all: this entry is "everything a page needs", and a consumer
  // holding only this one would otherwise find a base class it cannot name.
  ArgsElementBase,
  SqlibArgsElement,
  defineArgsElement,
  type ArgsPayload,
  type ArgsSignature,
} from './args-element.js';
