/**
 * One API call, rendered in five languages.
 *
 * The build page grew these snippets first, inline, and then the query, group
 * and rule set work areas each grew their own — three more copies, two of them
 * pointing at `api.example.com`. A snippet that names a host nobody can call is
 * worse than no snippet, so the rendering lives here and the callers supply
 * only what is actually being called: a method, a URL and a JSON body.
 */

export type SnippetLanguage = 'curl' | 'javascript' | 'python' | 'java' | 'go';

export const SNIPPET_LANGUAGES: ReadonlyArray<{ id: SnippetLanguage; label: string }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'go', label: 'Go' },
];

export interface SnippetRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  /** Serialised as JSON. Omitted entirely when undefined — a GET has no body. */
  body?: unknown;
  /**
   * Headers beyond the two every call carries (Authorization, and
   * Content-Type when there is a body) — an `Accept` for a chosen result
   * media type, mostly.
   */
  headers?: Record<string, string>;
}

/** The token is read from the environment, never inlined into a snippet. */
const TOKEN_ENV = 'SQLIB_TOKEN';

const jsonHeaders = (request: SnippetRequest): Array<[string, string]> => {
  const headers: Array<[string, string]> = [['Authorization', `Bearer $${TOKEN_ENV}`]];
  if (request.body !== undefined) headers.push(['Content-Type', 'application/json']);
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers.push([name, value]);
  }
  return headers;
};

const compactJson = (body: unknown) => JSON.stringify(body ?? {});
const prettyJson = (body: unknown, indent = '') =>
  JSON.stringify(body ?? {}, null, 2).replace(/\n/g, `\n${indent}`);

function curlSnippet(request: SnippetRequest): string {
  const lines = [`curl -X ${request.method} ${request.url} \\`];
  for (const [name, value] of jsonHeaders(request)) {
    lines.push(`  -H "${name}: ${value}" \\`);
  }
  if (request.body === undefined) {
    // No body: the last header line must not end in a continuation.
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '');
    return lines.join('\n');
  }
  lines.push(`  -d '${prettyJson(request.body, '  ')}'`);
  return lines.join('\n');
}

function javascriptSnippet(request: SnippetRequest): string {
  const lines = [
    `const response = await fetch('${request.url}', {`,
    `  method: '${request.method}',`,
    `  headers: {`,
    `    Authorization: \`Bearer \${process.env.${TOKEN_ENV}}\`,`,
  ];
  if (request.body !== undefined) lines.push(`    'Content-Type': 'application/json',`);
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    lines.push(`    '${name}': '${value}',`);
  }
  lines.push(`  },`);
  if (request.body !== undefined) {
    lines.push(`  body: JSON.stringify(${prettyJson(request.body, '  ')}),`);
  }
  lines.push(`});`, `const results = await response.json();`);
  return lines.join('\n');
}

function pythonSnippet(request: SnippetRequest): string {
  const method = request.method.toLowerCase();
  const headers = [`"Authorization": f"Bearer {os.environ['${TOKEN_ENV}']}"`];
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers.push(`"${name}": "${value}"`);
  }
  const lines = [
    `import os, requests`,
    ``,
    `response = requests.${method}(`,
    `    "${request.url}",`,
    `    headers={${headers.join(', ')}},`,
  ];
  if (request.body !== undefined) {
    lines.push(`    json=${prettyJson(request.body, '    ')},`);
  }
  lines.push(`)`, `results = response.json()`);
  return lines.join('\n');
}

function javaSnippet(request: SnippetRequest): string {
  const lines = [
    `HttpRequest request = HttpRequest.newBuilder()`,
    `    .uri(URI.create("${request.url}"))`,
    `    .header("Authorization", "Bearer " + System.getenv("${TOKEN_ENV}"))`,
  ];
  if (request.body !== undefined) lines.push(`    .header("Content-Type", "application/json")`);
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    lines.push(`    .header("${name}", "${value}")`);
  }
  if (request.body === undefined) {
    lines.push(`    .method("${request.method}", HttpRequest.BodySaveers.noBody())`);
  } else {
    lines.push(
      `    .method("${request.method}", HttpRequest.BodySaveers.ofString(`,
      `        "${compactJson(request.body).replace(/"/g, '\\"')}"))`,
    );
  }
  lines.push(
    `    .build();`,
    `HttpResponse<String> response = HttpClient.newHttpClient()`,
    `    .send(request, HttpResponse.BodyHandlers.ofString());`,
  );
  return lines.join('\n');
}

function goSnippet(request: SnippetRequest): string {
  const lines: string[] = [];
  if (request.body === undefined) {
    lines.push(`req, _ := http.NewRequest("${request.method}", "${request.url}", nil)`);
  } else {
    lines.push(
      `body := strings.NewReader(\`${compactJson(request.body)}\`)`,
      `req, _ := http.NewRequest("${request.method}", "${request.url}", body)`,
    );
  }
  lines.push(`req.Header.Set("Authorization", "Bearer "+os.Getenv("${TOKEN_ENV}"))`);
  if (request.body !== undefined) lines.push(`req.Header.Set("Content-Type", "application/json")`);
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    lines.push(`req.Header.Set("${name}", "${value}")`);
  }
  lines.push(`resp, err := http.DefaultClient.Do(req)`);
  return lines.join('\n');
}

export function renderSnippet(language: SnippetLanguage, request: SnippetRequest): string {
  switch (language) {
    case 'curl':
      return curlSnippet(request);
    case 'javascript':
      return javascriptSnippet(request);
    case 'python':
      return pythonSnippet(request);
    case 'java':
      return javaSnippet(request);
    case 'go':
      return goSnippet(request);
    default:
      return '';
  }
}
