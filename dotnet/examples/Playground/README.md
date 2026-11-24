# Playground

A web page on the .NET library. Pick a query from a bundle, give its inputs
values, and see the query text that `QueryHandle.Text` writes. "Fill in and
run" also sends the text to a SPARQL endpoint and shows the result. The log
panel shows each library call, the payload, the time it took, and the HTTP
request and response.

## Run it with Docker

You need Docker only. From this folder:

```sh
docker compose up --build
```

Open <http://localhost:5080>. The compose file starts two containers:

| Service | Port | What it is |
| --- | --- | --- |
| `playground` | 5080 | This app, built from the library source in this repository |
| `oxigraph` | 7878 | A SPARQL endpoint. The playground loads `../QuickStart/sample-data.ttl` into it at start |

Try these with the sample bundle:

1. Select `people-by-city`. Set `?city` to "Values", and enter
   `http://example.org/city/perth`. Click "Fill in and run". The result has
   one row, Alice.
2. Add a row with `http://example.org/city/darwin`. The result has two rows.
3. Put a space in an IRI, and click "Fill in". The library refuses it with
   `InvalidTermException`, and nothing is sent.
4. Select `paged-things`, then the example "First page". The payload box
   shows the example, and "Fill in" gives `LIMIT 25 OFFSET 50`.
5. Click "Load bundle…" to load your own bundle file. To run its queries,
   set "Endpoint" to your SPARQL endpoint.

Stop it with Ctrl+C, then `docker compose down`.

## Run it with the .NET SDK

```sh
dotnet run
```

The app listens on the URL that it prints. Set `ENDPOINT` to a SPARQL query
URL, and `BUNDLE` to a bundle file, to change the defaults.

This app is a demonstration. It has no authentication, and it sends queries
to any endpoint URL that the page gives. Do not expose it on a network.
