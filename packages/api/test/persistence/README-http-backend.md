# Running the persistence suites against an `http` backend

The plan commits to both internal backend modes working (§2): in-process oxigraph,
and `http` with basic auth. CI exercises the oxigraph modes. This is how to point
the same suites at a real SPARQL endpoint.

`test/setup-vitest.ts` and `test/setup-env.ts` set their backend variables with
`||=`, so anything already in the environment wins.

Any Fuseki that speaks SPARQL 1.1 Query and Update over HTTP with basic auth
works. Set `FUSEKI_IMAGE` to one you can pull; the suites need no Fuseki module
beyond the core server. The credentials below are local to the throwaway
container.

```bash
printf 'admin: admin, admin\n' > /tmp/fuseki-passwd
docker create --name sqlib-fuseki -p 3033:3030 \
  --entrypoint java "${FUSEKI_IMAGE:?set FUSEKI_IMAGE to a Fuseki image you can pull}" \
  -jar /fuseki/jena-fuseki-server.jar \
  --mem --update --auth=basic --passwd=/tmp/passwd --port 3030 /parity
docker cp /tmp/fuseki-passwd sqlib-fuseki:/tmp/passwd
docker start sqlib-fuseki

INTERNAL_BACKEND_TYPE=http \
  LIBRARY_STORAGE_SPARQL_ENDPOINT=http://localhost:3033/parity \
  LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT=http://localhost:3033/parity/query \
  LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT=http://localhost:3033/parity/update \
  LIBRARY_STORAGE_SPARQL_USERNAME=admin LIBRARY_STORAGE_SPARQL_PASSWORD=admin \
  pnpm --filter @sparql-query-lib/api exec vitest run test/persistence/
```

The password file is copied in rather than bind-mounted because the Docker daemon
does not necessarily share the host's filesystem — a bind mount can silently
present an empty directory, and Fuseki then exits on a missing password file.

Check that traffic actually reached the endpoint rather than trusting a pass — the
setup files used to pin the backend unconditionally, and a run that silently stayed
on oxigraph looked identical to a successful one:

```bash
curl -u admin:admin http://localhost:3033/parity/query \
  --data-urlencode 'query=SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }' -H 'Accept: text/csv'
```

## Status

**LDKit is gone (#61), and with it the parity harness.** The suites that used to
compare two adapters over HTTP no longer exist, because there is one adapter. What
replaced them, for the purpose of proving the `http` mode still works:

- `httpBackend.test.ts` — skipped unless `INTERNAL_BACKEND_TYPE=http`, and the only
  test that writes to a network endpoint and reads it back. It round-trips a
  create, read, update, list and delete, and checks the *endpoint's own* triple
  count on either side, because a run that silently fell back to oxigraph would
  otherwise look exactly like a passing one.
- The rest of `test/persistence/` is unit tests over the generators, serialiser
  and assembler. They pass identically on either backend and prove nothing about
  HTTP — do not read a green `test/persistence/` run as HTTP coverage.

Last full-suite run against Fuseki over HTTP with basic auth: 181 files, all
passing except `test/server/config.test.ts`, which asserts on configuration
defaults "when no env vars set" and so fails by construction in a run that sets
`LIBRARY_STORAGE_*`. That is a property of the suite, not of the backend.

### Why file parallelism is off for `http`

`vitest.config.ts` sets `fileParallelism: false` when `INTERNAL_BACKEND_TYPE=http`.

On oxigraph each test file gets its own in-process store, so files are genuinely
independent. Over HTTP they all share one dataset, and any assertion about store
*state* is then reading other files' concurrent writes. This is what produced the
180-of-329 failure once recorded here as a possible LDKit HTTP bug; it was neither
an LDKit nor an adapter defect.

Two suspicions from that investigation turned out not to be the cause, and are
recorded because they cost time:

- **A shared dataset alone was not the problem.** Residue from an earlier test is
  harmless when the comparison is of deltas — it sits in both before-snapshots
  equally. Only *concurrent* writes break it.
- **LDKit's single `baseUrl` was not a mismatch.** Fuseki serves query and update
  at the dataset root as well as at `/query` and `/update`, so both were talking
  to the same dataset.

### If you need file parallelism over HTTP

You would need a dataset per test file. Fuseki's admin API (`POST /$/datasets`)
can create them on demand, but it refuses non-localhost callers — from a
port-mapped container, host requests arrive from the bridge gateway and get a 403.
Running the container with `--network host`, or declaring the datasets up front in
a mounted `config.ttl`, are the ways around that. Not worth it so far: the
sequential HTTP run of `test/persistence/` takes a couple of seconds.
