/**
 * Ambient declarations for dependencies that ship no types of their own.
 *
 * `packages/api/src/**\/*.d.ts` is gitignored to keep stray `tsc` output from
 * being committed as source, so this file is exempted by name in `.gitignore`.
 * It is hand-written source, not build output.
 */

declare module 'rdf-canonize' {
  /** The subset of the RDF/JS term shape `rdf-canonize` reads and writes. */
  interface CanonizeTerm {
    termType: string;
    value: string;
    datatype?: CanonizeTerm;
    language?: string;
  }

  interface CanonizeQuad {
    subject: CanonizeTerm;
    predicate: CanonizeTerm;
    object: CanonizeTerm;
    graph: CanonizeTerm;
  }

  interface CanonizeOptions {
    algorithm: string;
    format?: string;
    [option: string]: unknown;
  }

  const rdfCanonize: {
    canonize(dataset: readonly unknown[], options: CanonizeOptions): Promise<string>;
    NQuads: {
      parse(nquads: string): unknown[];
      serialize(dataset: readonly unknown[]): string;
    };
  };

  export default rdfCanonize;
}

declare module 'ajv-formats-draft2019' {
  /** Registers the draft-2019 formats (`iri`, `idn-email`, …) on an Ajv instance. */
  const addFormats2019: (ajv: unknown, options?: unknown) => unknown;
  export default addFormats2019;
}
