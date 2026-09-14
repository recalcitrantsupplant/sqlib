/**
 * Type mapping utilities for LDKit → OpenAPI schema conversion
 *
 * Centralizes type inference logic to avoid hardcoded heuristics scattered
 * throughout the generator code.
 */

import { xsd, ldkit as ldkitNs, rdf as rdfNs } from '../../src/persistence/namespaces.js';
import { jsonShape } from '../../src/persistence/jsonShapes.js';

/**
 * Direct XSD/LDKit type to OpenAPI type mappings
 */
export const XSD_TO_OPENAPI = new Map<string, any>([
  [xsd.dateTime, { type: 'string', format: 'date-time', readOnly: true }],
  [xsd.integer, { type: 'integer' }],
  [xsd.int, { type: 'integer' }],
  [xsd.long, { type: 'integer' }],
  // Without these three the map has no numeric case beyond `integer`, so a
  // decimal property fell through to the string default and the published
  // contract called it a string. `BenchmarkObservation.durationMs` is
  // `xsd:decimal`, is a `number` in the entity interface and on the wire, and
  // was documented as `{ type: 'string', minLength: 1 }` — which is also why
  // the entity-model document for `benchmarkobservation` could not replace the
  // snapshot one that types it `number` (issue #65).
  [xsd.decimal, { type: 'number' }],
  [xsd.double, { type: 'number' }],
  [xsd.float, { type: 'number' }],
  [xsd.boolean, { type: 'boolean' }],
  [xsd.anyURI, { type: 'string', format: 'iri' }],
  [(ldkitNs as any).IRI, { type: 'string', format: 'iri' }],
]);

/**
 * Field name pattern-based type inference (fallback when @type not explicit)
 */
export const FIELD_PATTERNS = new Map<RegExp, any>([
  [/date(Created|Modified)?$/i, { type: 'string', format: 'date-time', readOnly: true }],
  [/(url|URI|iri|endpoint)$/i, { type: 'string', format: 'iri' }],
]);

export interface TypeInferenceOptions {
  isArray?: boolean;
  isOptional?: boolean;
  /**
   * The property's declared JSON document shape name (`@jsonShape`).
   *
   * Like `values`, it replaces the datatype's inferred schema rather than
   * adding to it: `rdf:JSON` alone says only "a document", and emitting that as
   * an untyped blob is how `backendConfig` came to be published as a string
   * while every reader treated it as an object (issue #294).
   */
  jsonShape?: string;
  /**
   * The property's declared value vocabulary (`API token -> stored RDF value`).
   *
   * It replaces the datatype's inferred schema rather than adding to it: the
   * tokens are what the API accepts and returns, so a vocabulary on an
   * `ldkit:IRI` property yields `enum` over the tokens and *not* `format: iri`,
   * which the tokens would fail.
   */
  values?: Readonly<Record<string, string>>;
}

/**
 * Infer OpenAPI property schema from LDKit property metadata
 *
 * @param fieldName - Property name (used for pattern-based inference)
 * @param ldkitType - LDKit @type value (if present)
 * @param ldkitId - LDKit @id value (used for pattern matching)
 * @param options - Additional property metadata (array, optional)
 * @returns OpenAPI property schema object
 */
export function inferOpenAPIType(
  fieldName: string,
  ldkitType: string | undefined,
  ldkitId: string | undefined,
  options: TypeInferenceOptions = {}
): any {
  let baseType: any = { type: 'string' }; // Default fallback

  // 0. A declared vocabulary is the property's type — nothing to infer.
  if (options.values) {
    baseType = { type: 'string', enum: Object.keys(options.values) };
  }

  // 0b. So is a declared JSON shape. An `rdf:JSON` property without one has no
  // published structure at all, which is worse than a wrong type: nothing tells
  // a client what to send. Requiring the declaration keeps that impossible.
  //
  // Falls through to the array/nullable wrapping below like every other
  // datatype. The pattern matching in step 2 is guarded on `type === 'string'`,
  // so an object shape passes it untouched.
  if (ldkitType === rdfNs.JSON) {
    if (!options.jsonShape) {
      throw new Error(
        `${fieldName} is rdf:JSON but declares no "@jsonShape"; ` +
          `the contract would publish it as an untyped blob.`,
      );
    }
    baseType = { ...jsonShape(options.jsonShape).jsonSchema };
  }

  // 1. Try exact type mapping first
  if (!options.values && ldkitType) {
    const mapped = XSD_TO_OPENAPI.get(ldkitType);
    if (mapped) {
      baseType = { ...mapped };
    }
  }

  // 2. Try field name pattern matching if no explicit type found
  if (baseType.type === 'string' && !baseType.format && !baseType.enum) {
    for (const [pattern, typeSchema] of FIELD_PATTERNS.entries()) {
      if (pattern.test(fieldName) || (ldkitId && pattern.test(ldkitId))) {
        baseType = { ...typeSchema };
        break;
      }
    }
  }

  // 3. Wrap in array if needed
  if (options.isArray) {
    return {
      type: 'array',
      items: baseType,
      ...(options.isOptional ? { nullable: true } : {})
    };
  }

  // 4. Add nullable flag if optional
  //
  // An enum states its own permitted values, so it has to say `null` outright.
  // `nullable: true` is not a keyword this ajv honours — a `null` reaching
  // `{type: 'string', nullable: true}` survives because `coerceTypes` turns it
  // into `''`, not because the schema permitted it — and coercing `null` to `''`
  // is exactly what an `enum` then rejects. The type union keeps the `null` a
  // `null`, so a nullable vocabulary accepts what its zod counterpart accepts.
  if (options.isOptional) {
    if (baseType.enum) {
      baseType.type = ['string', 'null'];
      baseType.enum = [...baseType.enum, null];
    }
    baseType.nullable = true;
  }

  return baseType;
}
