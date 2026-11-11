# Example images for the sqlib CLI

These images are starting points to run `sqlib` in a pipeline. None of them is
the published image. See [docs/guides/cli.md](../../docs/guides/cli.md#container-images).

| Example | What it adds | Built in CI |
| --- | --- | --- |
| [`cli-minimal`](cli-minimal/Dockerfile) | The CLI, built from this repository | yes, and CI runs each command on `sample/` |
| [`cli-duckdb-azure`](cli-duckdb-azure/Dockerfile) | The DuckDB extensions `httpfs` and `azure`, installed at build time | no, because it needs a storage account |
| [`cli-azcopy`](cli-azcopy/Dockerfile) | `azcopy`, and a script that copies in, runs the job, copies out | no, because it needs a storage account |
