# @sparql-query-lib/compiler

The half of sqlib that needs a SPARQL parser.

- `SparqlQueryParser` parses and formats SPARQL 1.2, detects parameters
  (`VALUES … { UNDEF }` slots and `LIMIT 000n` / `OFFSET 000n` placeholders),
  applies arguments through the AST, and compiles verified templates.
- `detectSparqlOperation` names the top-level form of a text: `SELECT`, `ASK`,
  `CONSTRUCT`, `DESCRIBE` or `UPDATE`.
- `compileQueryTemplate` compiles a read query to the template
  `@sparql-query-lib/runtime` splices with no parser, including the spans of
  its page parameters. It throws `TemplateCompileError` naming the query when
  the text does not parse, is an update, or fails verification.

## Why it is a package

Two hosts run it. The API runs it on its request path and at export time. The
command-line tool runs it on query text read from a file. Both then hand the
compiled template to the same runtime splice, so a query compiled from text
runs exactly the way an exported one does. See
[`docs/explanation/architecture.md`](../../docs/explanation/architecture.md).

The browser runtime does not depend on this package. That keeps a static page
free of the parser.

## Diagnostics

The parser has no logger of its own. Pass a callback to see what it reports:

```ts
import { SparqlQueryParser } from '@sparql-query-lib/compiler';

const parser = new SparqlQueryParser({
  diagnostics: ({ level, message, attributes }) => {
    if (level === 'warn') console.warn(message, attributes);
  },
});
```

`debug` traces detection. `warn` marks a correlated `VALUES` inside
`FILTER EXISTS`, whose meaning differs between endpoints, and a template that
failed verification and fell back to the AST path. The API forwards both
levels to OpenTelemetry.

## Status

Private to the workspace. It becomes publishable with the command-line tool.
