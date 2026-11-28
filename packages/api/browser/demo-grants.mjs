// The demo's grants for a writable build: the guest's grants in
// `demo/grants.ttl`, and, on every library and backend they name, the right
// to change it. Write and delete on a library, and updates on a backend.
//
// build.mjs seeds the browser build with them. Run on its own, it prints
// them, so a server can hold the same grants for a comparison:
//   node demo-grants.mjs ../../../demo/grants.ttl > grants.ttl
import { readFileSync } from 'node:fs';

export function writableGrants(text) {
  const iris = kind => [...new Set([...text.matchAll(new RegExp(`auth:${kind}\\s+<([^>]+)>`, 'g'))].map(m => m[1]))];
  const extra = [
    ...iris('onLibrary').map((iri, i) => `<urn:sqlib:grant:browser-write-library-${i}> a auth:Grant ;\n`
      + `  auth:principal <urn:sqlib:principal:anonymous> ;\n  auth:onLibrary <${iri}> ;\n  auth:mode auth:Write, auth:Delete .`),
    ...iris('onBackend').map((iri, i) => `<urn:sqlib:grant:browser-update-backend-${i}> a auth:Grant ;\n`
      + `  auth:principal <urn:sqlib:principal:anonymous> ;\n  auth:onBackend <${iri}> ;\n  auth:mode auth:UpdateAdhoc .`),
  ];
  return `${text.trimEnd()}\n\n${extra.join('\n')}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(writableGrants(readFileSync(process.argv[2], 'utf8')));
}
