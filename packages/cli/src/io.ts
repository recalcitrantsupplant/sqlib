/**
 * Where a command reads and writes. Injected, so a test drives the whole CLI
 * with strings and the binary drives it with the process's streams.
 */
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  cwd: string;
}

/** A user error: printed without a stack, exit status 1. */
export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
    this.name = 'CliError';
  }
}

/** Read a file, or standard input when the path is `-`. */
export async function readInput(io: Io, file: string): Promise<string> {
  if (file === '-') return io.readStdin();
  try {
    return await readFile(path.resolve(io.cwd, file), 'utf8');
  } catch (error) {
    throw new CliError(`Cannot read ${file}: ${(error as Error).message}`);
  }
}

export interface Output {
  write(text: string): Promise<void>;
  close(): Promise<void>;
}

/** Write to a file, or to standard output when the path is `-` or absent. */
export function openOutput(io: Io, file: string | undefined): Output {
  if (!file || file === '-') {
    return { write: async text => { io.stdout(text); }, close: async () => {} };
  }
  const stream = createWriteStream(path.resolve(io.cwd, file), { encoding: 'utf8' });
  const failed = new Promise<never>((_, reject) => stream.once('error', reject));
  failed.catch(() => {});
  return {
    write: text => Promise.race([
      new Promise<void>(resolve => { if (stream.write(text)) resolve(); else stream.once('drain', resolve); }),
      failed,
    ]),
    close: () => Promise.race([new Promise<void>(resolve => stream.end(resolve)), failed]),
  };
}

const RDF_FORMATS: Record<string, string> = {
  '.ttl': 'text/turtle',
  '.turtle': 'text/turtle',
  '.nt': 'application/n-triples',
  '.nq': 'application/n-quads',
  '.trig': 'application/trig',
  '.jsonld': 'application/ld+json',
  '.rdf': 'application/rdf+xml',
  '.owl': 'application/rdf+xml',
};

const FORMAT_NAMES: Record<string, string> = {
  turtle: 'text/turtle',
  ttl: 'text/turtle',
  ntriples: 'application/n-triples',
  'n-triples': 'application/n-triples',
  nt: 'application/n-triples',
  nquads: 'application/n-quads',
  'n-quads': 'application/n-quads',
  nq: 'application/n-quads',
  trig: 'application/trig',
  jsonld: 'application/ld+json',
  'json-ld': 'application/ld+json',
  rdfxml: 'application/rdf+xml',
  'rdf-xml': 'application/rdf+xml',
};

/** A media type from a short name (`turtle`, `nt`) or a media type itself. */
export function rdfFormat(name: string): string {
  const known = FORMAT_NAMES[name.toLowerCase()];
  if (known) return known;
  if (name.includes('/')) return name;
  throw new CliError(`Unknown RDF format '${name}'. Use turtle, n-triples, n-quads, trig, json-ld or rdf-xml.`);
}

/** The format of a data file: the option if given, else from its extension. */
export function rdfFormatOf(file: string, override?: string): string {
  if (override) return rdfFormat(override);
  const format = RDF_FORMATS[path.extname(file).toLowerCase()];
  if (format) return format;
  throw new CliError(`Cannot tell the RDF format of ${file} from its name. Pass --data-format.`);
}
