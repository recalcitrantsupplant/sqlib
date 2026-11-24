# List paging

The list routes take query parameters that page, filter and sort the list. A library can hold thousands of entities, so a client that shows a list loads one page at a time ([#197](https://github.com/recalcitrantsupplant/sqlib/issues/197)).

The code is in `packages/api/src/lib/listPage.ts`.

## Routes

Every collection route takes the parameters, through one helper (`sendListPage`):

- `GET /libraries`, `/backends`, `/environments`, `/tags`, `/benchmarks` and `/etl-jobs`.
- `GET /queries`, `/query-groups`, `/rules`, `/rule-sets`, `/data-blocks`, `/data-graphs`, `/tuple-sets`, `/tests` and `/notebooks`.
- `GET /argument-sets?library=…`. The route needs a library. It also takes the older name `libraryId`, and refuses the request with 400 when the two name different libraries.
- `GET /queries/:id/argument-sets` and `GET /query-groups/:id/argument-sets`.

`GET /libraries` with an RDF `Accept` header returns the whole collection, and ignores the parameters.

## Parameters

| Parameter | Value | Effect |
| --- | --- | --- |
| `limit` | 1 to 500 | Returns at most this many entities. Without it, the route returns every match. |
| `offset` | 0 or more | Skips this many matches before the page starts. Default 0. |
| `q` | text | Keeps the entities whose name holds the characters of `q` in order, ignoring case and spaces. `qgrp` matches "Query group". |
| `ids` | entity IRI, repeatable | Keeps the named entities only. |
| `library` | library IRI | Keeps the entities in that library, by `isPartOf` as a string or an array. `GET /etl-jobs` also takes the short id that its summaries carry. The filter applies after the read-access filter, so a library the caller cannot read gives an empty list. |
| `tag` | tag IRI, repeatable | Keeps the entities that carry the named tags: every one by default, at least one with `tagMatch=any`. |
| `tagMatch` | `any`, `all` | How `tag` combines. Default `all`. |
| `withTag` | tag IRI, repeatable | Keeps the entities that also carry every named tag, whatever `tagMatch` says. A tag heading loads its rows inside the tag filter this way. |
| `sort` | `name`, `modified`, `created`, `creator`, `versions` | Orders the matches before the page is cut. Without it, the order is the store's order. The argument-set routes sort by `name` by default. |
| `order` | `asc`, `desc` | The direction. Default `asc` for `name` and `creator`, `desc` for the others. |
| `preferTarget` | query or group IRI | `GET /argument-sets` only. Puts the sets made for that query or group before the others. |

A row with no value for the sort key goes last in both directions. Rows with equal values sort by name. `creator` sorts by the principal IRI, so its order can differ from the web, which sorts by display name.

## Response

The body is a JSON array of the entities on the page. The `X-Total-Count` header gives the number of matches before `limit` and `offset` apply. The header is on every answer of these routes, with or without `limit`, and CORS exposes it to browsers.

```sh
curl -sD - "$API/argument-sets?library=$LIB&limit=50&q=perth&preferTarget=$QUERY" -o page.json
```

## Tag counts

`GET /tags/counts?type=Query` returns how many readable entities of one type carry each tag, as an object from tag IRI to count. `type` is one of the taggable entity types (`Query`, `QueryGroup`, `Rule`, `RuleSet`, `DataBlock`, `DataGraph`, `Test`, `ArgumentSet`, `TupleSet`, `Notebook`). The list filters `library`, `q`, `tag`, `tagMatch` and `withTag` apply first. A tag that no entity carries is absent from the answer.

```sh
curl -s "$API/tags/counts?type=Query&library=$LIB"
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
  - The tag filter in the filter bar sets `tag` and `tagMatch`. "Any of" is the default, so the web sends `tagMatch=any` until someone picks "All of". The filter is kept per section in this browser, with the sort.
  - Grouped by tag, the tag headings show the counts of one `GET /tags/counts` request, inside the search and the tag filter. Each heading loads its own rows with Show more, through `withTag`. The Untagged heading counts the loaded rows only.
  - The tag menu counts each tag over the section's whole kind in the library, from one more `GET /tags/counts` request.
- The Tests and ETL sections still load each full list. Run all in Tests runs every test in the list, so it needs the full list. The Tests tag filter runs in the browser, with the same rule. With a tag filter, Run runs the filtered tests, and its menu runs all tests or downloads a report of the filtered run.
- The screens that pick an entity (`SearchSelect`) still load each full list from their store, and draw 50 rows at a time.
- The data-graph pickers on the test, rule-set and query-group screens, the argument-set fit list, the callables list and the environment board send `library` ([#250](https://github.com/recalcitrantsupplant/sqlib/issues/250)). The shared stores (`useTestsStore`, `useQueriesStore` and the others) still load every readable library.
