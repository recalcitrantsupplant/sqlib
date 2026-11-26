#!/usr/bin/env node
/**
 * A token issuer for the seed stage, so each write is made as a demo person.
 *
 * sqlib stamps `createdBy` and `modifiedBy` from the caller of the request.
 * The runtime is read-only, so every entity a visitor sees was written while
 * seeding. The seeding server runs `SQLIB_AUTH_MODE=dry-run` with this issuer,
 * and the seeder sends a bearer token for the person a manifest names.
 *
 * The issuer is `DEMO_ISSUER` from the environment. Its default is
 * `urn:sqlib:demo`, the issuer of sqlib's demo mode (`DEMO_ISSUER` in sqlib's
 * `config/demoMode.ts`), so a token for `alice` gives the same principal IRI
 * that `X-Sqlib-Demo-Person: alice` gives at run time. For optional sign-in,
 * the seed stage sets it to the sign-in URL, so a token gives the IRI that
 * Alice gets when she signs in. Either way the activity lists show the name
 * from `people.json`.
 *
 * The key pair is made at start and never written to disk. The process serves
 * on 127.0.0.1 only, and the seed stage stops it before the image is
 * committed.
 *
 * - `GET /jwks.json`: the public key, for the server (`jwksUri`).
 * - `GET /token/<id>`: a token for a person in the people file, valid for
 *   1 hour. An id the file does not list gets 404.
 *
 * Usage: demo-issuer.mjs --port PORT --people FILE --audience AUD
 */

import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && process.argv[at + 1]) return process.argv[at + 1];
  console.error(`demo-issuer: --${name} is required`);
  process.exit(2);
}

const ISSUER = process.env.DEMO_ISSUER || 'urn:sqlib:demo';
const port = Number(arg('port'));
const audience = arg('audience');
const people = new Map(
  JSON.parse(readFileSync(arg('people'), 'utf8')).people.map(person => [person.id, person])
);

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = randomUUID();
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] };

const base64url = value => Buffer.from(value).toString('base64url');

function tokenFor(person) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = base64url(JSON.stringify({
    iss: ISSUER,
    aud: audience,
    sub: person.id,
    name: person.name,
    groups: person.groups ?? [],
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`;
}

createServer((request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (request.method !== 'GET') return send(405, { error: 'GET only' });
  if (request.url === '/jwks.json') return send(200, jwks);
  const match = /^\/token\/([a-z0-9-]+)$/.exec(request.url ?? '');
  const person = match && people.get(match[1]);
  if (!person) return send(404, { error: `no demo person at ${request.url}` });
  return send(200, { token: tokenFor(person) });
}).listen(port, '127.0.0.1', () => {
  console.log(`demo-issuer: listening on 127.0.0.1:${port} for ${people.size} people`);
});
