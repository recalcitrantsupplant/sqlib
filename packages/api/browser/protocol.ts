/** Messages between the page and the API Worker. */
export interface WorkerInit {
  type: 'init';
  /** URL of the seed library.sqlite. */
  libraryUrl: string;
  /** URL of sqlite3.wasm, when it is not beside the Worker script. */
  sqliteWasmUrl?: string;
  /** URL of Oxigraph's web_bg.wasm, when it is not beside the Worker script. */
  oxigraphWasmUrl?: string;
  /** Directory URL of the duckdb-wasm files. Default: jsDelivr. */
  duckdbBaseUrl?: string;
  /** Keep the library in OPFS. Default true. */
  persist?: boolean;
  /** Delete the stored library first, so it is seeded again. */
  reset?: boolean;
  /**
   * The URL the page sends API calls to. OGC API Features links are built on
   * it (`SQLIB_OGC_BASE_URL`), so a client can follow them back to this Worker.
   */
  apiBaseUrl?: string;
}

export interface WorkerRequest {
  type: 'request';
  id: number;
  method: string;
  /** Path and query, without the origin. */
  url: string;
  headers: Record<string, string>;
  body?: string | Uint8Array | null;
}

export type WorkerMessage = WorkerInit | WorkerRequest;

export type WorkerReply =
  | { type: 'ready'; persistent: boolean; startMs: number }
  | { type: 'failed'; message: string }
  | { type: 'response'; id: number; status: number; headers: Record<string, string>; body: ArrayBuffer };
