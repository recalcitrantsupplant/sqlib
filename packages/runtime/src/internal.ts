/**
 * `@sparql-query-lib/runtime/internal` — the machinery under the public API.
 *
 * The sqlib server and its tooling share these with the runtime so that "the
 * client substitutes exactly as the server does" is true by construction: one
 * term serialiser, one slot assigner, one page-parameter splice, one bundle
 * hash. They are exported for that reuse only.
 *
 * **No semver promise.** Anything here may change shape or disappear in any
 * release, patch releases included. An application built on an exported bundle
 * needs nothing from this entry; if it seems to, that is a gap in the public one
 * worth reporting.
 */

export {
  escapeLiteralLexical,
  isAbsoluteIri,
  isSafePrefixLabel,
  isSafeVariableName,
  renderValuesBlock,
  serializeIri,
  serializeTerm,
  serializeVariable,
} from './sparql-terms.js';

export {
  applyTemplateArguments,
  assignArgumentSets,
  completeArgumentSets,
  type TemplateArgumentSet,
} from './query-template.js';

export { normalizeArguments, normalizeWireTerm } from './arguments.js';

export {
  assertPageParameterValue,
  substituteLimitOffset,
  toExecutionParameters,
} from './limit-offset.js';

export { canonicalJson, computeIntegrity, hashTemplateText, sealBundle } from './bundle.js';
