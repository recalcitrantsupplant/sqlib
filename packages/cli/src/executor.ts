/**
 * Where a query runs: an endpoint, or an in-process Oxigraph store seeded with
 * data files. `--endpoint` and `--data` are the same choice in every command.
 */
import { httpExecutor, type Executor } from '@sparql-query-lib/runtime';
import { oxigraphExecutor } from '@sparql-query-lib/runtime-oxigraph';
import { CliError, readInput, rdfFormatOf, type Io } from './io.js';

export interface ExecutorChoice {
  endpoint?: string;
  'update-endpoint'?: string;
  data?: string[];
  'data-format'?: string;
}

export async function chooseExecutor(io: Io, choice: ExecutorChoice, rdfFormat: string): Promise<Executor> {
  if (choice.endpoint) {
    if (choice.data && choice.data.length > 0) throw new CliError('Pass --endpoint or --data, not both.');
    return httpExecutor(choice.endpoint, {
      rdfAccept: rdfFormat,
      ...(choice['update-endpoint'] ? { updateEndpoint: choice['update-endpoint'] } : {}),
    });
  }
  const documents = [];
  for (const file of choice.data ?? []) {
    documents.push({ content: await readInput(io, file), format: rdfFormatOf(file, choice['data-format']) });
  }
  try {
    return await oxigraphExecutor({ data: documents, rdfFormat });
  } catch (error) {
    throw new CliError(`Cannot load the data: ${(error as Error).message}`);
  }
}
