# Environments

An environment is a named set of version pointers inside one library. A library
can define "dev", "test" and "prod", or any other names. Each environment points
to at most one version of each query, query group and rule set in that library.
A caller that names an environment runs the version it points to. A caller that
names none runs the current version.

This page explains the model, how a run resolves, and who may do what.

## The model

An `Environment` belongs to one library (`isPartOf`). It has a `name`, a
`position` in the chain (dev before prod), an optional `defaultBackend`, and a
list of `versions`. Each version in the list belongs to a different entity: a
version's own `isPartOf` names its entity, and the write path keeps one version
per entity.

| Kind | Promotable |
| --- | --- |
| Query, query group, rule set | Yes |
| Data graph, tuple set | No. They are inputs, and a test case ties inputs to versions. |
| Test, benchmark | No. They are evidence for a promotion, not things to promote. |

The name `latest` is reserved. It is the implicit environment that every entity
has: its `currentVersion`. A library cannot define an environment named
`latest`, and names are unique in a library.

Environments are opt-in. A library that defines none has only `latest`.

Why the pointers live on the environment, not on the query:

- The `Query`, `QueryGroup` and `RuleSet` schemas do not change.
- Deleting an environment removes all its pointers in one step.
- A version that an environment points to is protected from delete, the same
  way a version that a group pins is protected.
- The environment exports with its library.

## How a run resolves

`resolveVersionIn` in `packages/api/src/lib/environments.ts` is the one place
that turns "this entity in this environment" into a version. `/execute`, MCP,
published tools and the export bundle all use it.

| Request | Result |
| --- | --- |
| No environment, or `latest` | `currentVersion`. 409 if the entity has no version. |
| A name, in a library with no environments | `currentVersion`. |
| A name the library does not define | 400. |
| A name the library defines, with no pointer for this entity | 409, "not promoted yet". |
| A name the library defines, with a pointer | The version it points to. |

A run that names a version id directly is already exact. It ignores the
environment.

`/execute` takes `environment` in the POST body and in the GET querystring. A
resolved run sets the `X-Resolved-Environment` response header.

`SQLIB_DEFAULT_ENVIRONMENT` sets the environment for a request that names none.
Published tools use it too. An explicit name, `latest` included, always wins.
A library with no environments ignores the default, so a server set to `prod`
does not break those libraries.

A backend is never chosen by the environment. `defaultBackend` on an
environment is a suggestion for clients, the same as on a query or a library.

## Moving a pointer

`PUT /environments/:id/pointers` with `{ entity, version, from? }` moves one
pointer. `version: null` removes it.

- The entity must be a promotable entity in the environment's library.
- The version must be of the matching kind, and must belong to the entity.
- `from` is a compare-and-set guard. When it is given and the pointer is not at
  `from`, the call returns 409 with the `current` version.

Every move writes an audit log line (`pointerMove`) with the environment, the
entity, the old and new version and the caller.

`GET /environments/:id/pointers` lists the pointers with the entity name and the
version number.

Today an administrator, or a holder of `promote`, moves a pointer directly. The
review flow (promotion requests, reviewers on each step of the chain, evidence
from test runs) builds on this route and is designed separately.

## Groups and their parts

A group version pins the exact version each node runs. Promoting a group
therefore runs those versions in the environment, whatever the environment
holds for each part on its own. This is allowed. When a group pointer moves,
the `X-Parts-Behind` response header counts the parts that the environment
holds at another version than the group pins. `partsBehind` in
`lib/environments.ts` lists them for a reviewer.

A query with `groupOnly: true` exists only to be a part. It cannot be promoted
on its own (400), it is never counted as behind, and published tools leave it
out. To change it in an environment, promote a group version that pins the new
version.

## Who may do what

Environments add one grant resource kind, `environment`, with two modes.

| Grant | Allows |
| --- | --- |
| `control` on the library | Create, rename and delete its environments, and administer their grants. It does not move pointers. |
| `promote` on an environment | Move that environment's pointers. Nothing else. |
| `execute` on an environment | Run exactly the versions that environment points to. Not the current version, not ad hoc text, not edits. |
| `execute` on the library | Run any version, as before. |

So "may run what is in prod, and nothing else" is `read` on the library plus
`execute` on the prod environment, plus the backend grant every run needs.

Library modes never imply environment modes. Defining environments and
approving what goes into them are separate jobs.

## Export

`GET /libraries/:id/export-bundle?environment=prod` exports the versions prod
points to instead of the current ones. An entity with no version in prod is
left out and reported. `latest` exports the current versions.

## Who made a version

Query, query group and rule set versions record `createdBy` (`dct:creator`):
the signed-in principal that saved them. A deployment with auth disabled records
nobody. A client cannot set the field.

## What is not covered yet

- Tests, benchmarks and ETL jobs that run versions use the library `execute`
  rule. They do not apply the environment `execute` rule.
- A dynamic query node picks its query at run time. It runs that query's
  current version, not the version the environment points to.
- Releases (a named snapshot of one environment) and `publishEnvironment` (the
  environment a library's published tools serve) are deferred.
