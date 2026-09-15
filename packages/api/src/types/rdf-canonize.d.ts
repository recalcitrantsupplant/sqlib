declare module 'rdf-canonize' {
  interface CanonizeOptions {
    algorithm?: string;
    format?: string;
  }

  interface NQuadsApi {
    parse(input: string): any[];
  }

  interface CanonizeApi {
    canonize(input: unknown, options?: CanonizeOptions): Promise<string>;
    canonizeSync?(input: unknown, options?: CanonizeOptions): string;
    NQuads: NQuadsApi;
  }

  const api: CanonizeApi;
  export = api;
}
