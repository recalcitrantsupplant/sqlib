# The sqlib CLI with azcopy: copy rows in, convert, copy RDF out. DuckDB never
# sees the blob store, so the sandbox stays at its defaults.
#
#   docker build -f examples/docker/cli-minimal/Dockerfile -t sqlib-cli .
#   docker build -t sqlib-cli-azcopy --build-arg BASE=sqlib-cli examples/docker/cli-azcopy
#   docker run --rm -e SOURCE_URL -e TARGET_URL -v "$PWD/job:/job" sqlib-cli-azcopy
#
# SOURCE_URL and TARGET_URL are blob URLs azcopy can use, for example with a
# SAS token. Not run in CI: it needs a storage account.

ARG BASE=sqlib-cli
FROM ${BASE}
USER root
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates curl \
 && curl -fsSL https://aka.ms/downloadazcopy-v10-linux | tar -xz --strip-components=1 -C /usr/local/bin --wildcards '*/azcopy' \
 && apt-get purge --yes curl && apt-get autoremove --yes && rm -rf /var/lib/apt/lists/*
COPY run.sh /usr/local/bin/sqlib-azcopy-run
RUN chmod +x /usr/local/bin/sqlib-azcopy-run
USER node
ENTRYPOINT ["sqlib-azcopy-run"]
