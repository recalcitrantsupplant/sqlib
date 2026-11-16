# List paging

The list routes take query parameters that page, filter and sort the list. A library can hold thousands of entities, so a client that shows a list loads one page at a time ([#197](https://github.com/recalcitrantsupplant/sqlib/issues/197)).

The code is in `packages/api/src/lib/listPage.ts`.

## Routes

Every collection route takes the parameters, through one helper (`sendListPage`):

- `GET /libraries`, `/backends`, `/environments`, `/tags`, `/benchmarks` and `/etl-jobs`.
- `GET /queries`, `/query-groups`, `/rules`, `/rule-sets`, `/data-blocks`, `/data-graphs`, `/tuple-sets`, `/tests` and `/notebooks`.
- `GET /argument-sets?libraryId=…`.
- `GET /queries/:id/argument-sets` and `GET /query-groups/:id/argument-sets`.

`GET /libraries` with an RDF `Accept` header returns the whole collection, and ignores the parameters.

## Parameters

| Parameter | Value | Effect |
| --- | --- | --- |
| `limit` | 1 to 500 | Returns at most this many entities. Without it, the route returns every match. |
| `offset` | 0 or more | Skips this many matches before the page starts. Default 0. |
| `q` | text | Keeps the entities whose name holds the characters of `q` in order, ignoring case and spaces. `qgrp` matches "Query group". |
| `ids` | entity IRI, repeatable | Keeps the named entities only. |
| `library` | library IRI | Keeps the entities in that library. |
| `tag` | tag IRI, repeatable | Keeps the entities that carry every named tag. |
| `sort` | `name`, `modified`, `created`, `creator`, `versions` | Orders the matches before the page is cut. Without it, the order is the store's order. The argument-set routes sort by `name` by default. |
| `order` | `asc`, `desc` | The direction. Default `asc` for `name` and `creator`, `desc` for the others. |
| `preferTarget` | query or group IRI | `GET /argument-sets` only. Puts the sets made for that query or group before the others. |

A row with no value for the sort key goes last in both directions. Rows with equal values sort by name. `creator` sorts by the principal IRI, so its order can differ from the web, which sorts by display name.

## Response

The body is a JSON array of the entities on the page. The `X-Total-Count` header gives the number of matches before `limit` and `offset` apply. The header is on every answer of these routes, with or without `limit`, and CORS exposes it to browsers.

```sh
curl -sD - "$API/argument-sets?libraryId=$LIB&limit=50&q=perth&preferTarget=$QUERY" -o page.json
```

## Argument-set lists

The argument-set lists return summaries. A summary has the name, `currentVersionNumber`, and each tuple binding's variables. It has no rows. `GET /argument-sets/:id` returns the set with its rows.

## Web

- The argument-set switcher loads 50 sets at a time. Its filter calls the server with `q`, and Show more loads the next 50.
- Each search picker (`SearchSelect`) draws its first 50 matches. Typing searches every option, and Show more draws 50 more.
- The section rail loads its saved rows a page at a time for queries, query groups, rule sets, benchmarks, data graphs, tuple sets and argument sets (`composables/useRailPaging.ts`, on `composables/usePagedList.ts`).
  - The filter box searches on the server with `q`. The sort menu sets `sort` and `order`.
  - Pinned rows load by `ids`, whatever page they are on.
  - "Last opened" is a browser setting, so it asks the server for name order and loads the 100 most recently opened rows by `ids`. Those rows sort first.
  - Grouped by tag, each tag heading shows the server's count (`tag=…&limit=1`) and loads its own rows with Show more. The Untagged heading counts the loaded rows only.
- The Tests and ETL sections still load each full list. Run all in Tests runs every test in the list, so it needs the full list.
- The screens that pick an entity (`SearchSelect`) still load each full list from their store, and draw 50 rows at a time.
