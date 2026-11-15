// The same declaration as packages/api/src/types/rdf-canonize.d.ts: the
// package ships no types.
declare module 'rdf-canonize' {
  interface CanonizeOptions {
    algorithm?: string;
    format?: string;
    inputFormat?: string;
    maxWorkFactor?: number;
  }

  interface NQuadsApi {
    parse(input: string): unknown[];
  }

  interface CanonizeApi {
    canonize(input: unknown, options?: CanonizeOptions): Promise<string>;
    NQuads: NQuadsApi;
  }

  const api: CanonizeApi;
  export = api;
}
