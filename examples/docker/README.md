# Example images for the sqlib CLI

Not the published image: starting points for running `sqlib` in a pipeline.
See [docs/guides/cli.md](../../docs/guides/cli.md#container-images).

| Example | What it adds | Built in CI |
| --- | --- | --- |
| [`cli-minimal`](cli-minimal/Dockerfile) | The CLI, built from this repository | yes, and each command is run on `sample/` |
| [`cli-duckdb-azure`](cli-duckdb-azure/Dockerfile) | DuckDB's `httpfs` and `azure` extensions, installed at build time | no: needs a storage account |
| [`cli-azcopy`](cli-azcopy/Dockerfile) | `azcopy`, and a script that copies in, runs the job, copies out | no: needs a storage account |
