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

/**
 * Each language, with the media type its highlighting is asked for by. See
 * `loadLanguage` in `lib/codeLanguage.ts`, which owns the grammars.
 */
export const SNIPPET_LANGUAGES: ReadonlyArray<{ id: SnippetLanguage; label: string; mediaType: string }> = [
  { id: 'curl', label: 'cURL', mediaType: 'application/x-sh' },
  { id: 'javascript', label: 'JavaScript', mediaType: 'text/javascript' },
  { id: 'python', label: 'Python', mediaType: 'text/x-python' },
  { id: 'java', label: 'Java', mediaType: 'text/x-java' },
  { id: 'go', label: 'Go', mediaType: 'text/x-go' },
];

export interface SnippetRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  /** Serialised as JSON. Omitted entirely when undefined — a GET has no body. */
  body?: unknown;
  /**
   * Headers beyond Authorization and Content-Type (Content-Type is sent when
   * there is a body), such as an `Accept` for a chosen result media type.
   */
  headers?: Record<string, string>;
}

export interface SnippetOptions {
  /**
   * Send `Authorization: Bearer $SQLIB_TOKEN`. Set it when the instance uses
   * sign-in (`useAuth().usesSignIn`). On an instance without sign-in the API
   * ignores the header and nobody can get a token. Defaults to true.
   */
  bearerToken?: boolean;
}

/** The token is read from the environment, never inlined into a snippet. */
export const TOKEN_ENV = 'SQLIB_TOKEN';

const jsonHeaders = (request: SnippetRequest, bearerToken: boolean): Array<[string, string]> => {
  const headers: Array<[string, string]> = bearerToken ? [['Authorization', `Bearer $${TOKEN_ENV}`]] : [];
  if (request.body !== undefined) headers.push(['Content-Type', 'application/json']);
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers.push([name, value]);
  }
  return headers;
};

const compactJson = (body: unknown) => JSON.stringify(body ?? {});
const prettyJson = (body: unknown, indent = '') =>
  JSON.stringify(body ?? {}, null, 2).replace(/\n/g, `\n${indent}`);

function curlSnippet(request: SnippetRequest, bearerToken: boolean): string {
  const lines = [`curl -X ${request.method} ${request.url} \\`];
  for (const [name, value] of jsonHeaders(request, bearerToken)) {
    lines.push(`  -H "${name}: ${value}" \\`);
  }
  if (request.body === undefined) {
    // No body: the last line must not end in a continuation.
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '');
    return lines.join('\n');
  }
  lines.push(`  -d '${prettyJson(request.body, '  ')}'`);
  return lines.join('\n');
}

function javascriptSnippet(request: SnippetRequest, bearerToken: boolean): string {
  const headers: string[] = [];
  if (bearerToken) headers.push(`    Authorization: \`Bearer \${process.env.${TOKEN_ENV}}\`,`);
  if (request.body !== undefined) headers.push(`    'Content-Type': 'application/json',`);
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers.push(`    '${name}': '${value}',`);
  }
  const lines = [`const response = await fetch('${request.url}', {`, `  method: '${request.method}',`];
  if (headers.length) lines.push(`  headers: {`, ...headers, `  },`);
  if (request.body !== undefined) {
    lines.push(`  body: JSON.stringify(${prettyJson(request.body, '  ')}),`);
  }
  lines.push(`});`, `const results = await response.json();`);
  return lines.join('\n');
}

function pythonSnippet(request: SnippetRequest, bearerToken: boolean): string {
  const method = request.method.toLowerCase();
  const headers = bearerToken ? [`"Authorization": f"Bearer {os.environ['${TOKEN_ENV}']}"`] : [];
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers.push(`"${name}": "${value}"`);
  }
  const lines = [
    bearerToken ? `import os, requests` : `import requests`,
    ``,
    `response = requests.${method}(`,
    `    "${request.url}",`,
  ];
  if (headers.length) lines.push(`    headers={${headers.join(', ')}},`);
  if (request.body !== undefined) {
    lines.push(`    json=${prettyJson(request.body, '    ')},`);
  }
  lines.push(`)`, `results = response.json()`);
  return lines.join('\n');
}

function javaSnippet(request: SnippetRequest, bearerToken: boolean): string {
  const lines = [`HttpRequest request = HttpRequest.newBuilder()`, `    .uri(URI.create("${request.url}"))`];
  if (bearerToken) lines.push(`    .header("Authorization", "Bearer " + System.getenv("${TOKEN_ENV}"))`);
  if (request.body !== undefined) lines.push(`    .header("Content-Type", "application/json")`);
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    lines.push(`    .header("${name}", "${value}")`);
  }
  if (request.body === undefined) {
    lines.push(`    .method("${request.method}", HttpRequest.BodyPublishers.noBody())`);
  } else {
    lines.push(
      `    .method("${request.method}", HttpRequest.BodyPublishers.ofString(`,
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

function goSnippet(request: SnippetRequest, bearerToken: boolean): string {
  const lines: string[] = [];
  if (request.body === undefined) {
    lines.push(`req, _ := http.NewRequest("${request.method}", "${request.url}", nil)`);
  } else {
    lines.push(
      `body := strings.NewReader(\`${compactJson(request.body)}\`)`,
      `req, _ := http.NewRequest("${request.method}", "${request.url}", body)`,
    );
  }
  if (bearerToken) lines.push(`req.Header.Set("Authorization", "Bearer "+os.Getenv("${TOKEN_ENV}"))`);
  if (request.body !== undefined) lines.push(`req.Header.Set("Content-Type", "application/json")`);
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    lines.push(`req.Header.Set("${name}", "${value}")`);
  }
  lines.push(`resp, err := http.DefaultClient.Do(req)`);
  return lines.join('\n');
}

export function renderSnippet(
  language: SnippetLanguage,
  request: SnippetRequest,
  options: SnippetOptions = {},
): string {
  const bearerToken = options.bearerToken ?? true;
  switch (language) {
    case 'curl':
      return curlSnippet(request, bearerToken);
    case 'javascript':
      return javascriptSnippet(request, bearerToken);
    case 'python':
      return pythonSnippet(request, bearerToken);
    case 'java':
      return javaSnippet(request, bearerToken);
    case 'go':
      return goSnippet(request, bearerToken);
    default:
      return '';
  }
}
