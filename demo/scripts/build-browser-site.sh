#!/bin/sh
# Builds the Rail demo as a static site that needs no sqlib server. The API
# runs in a Worker in the visitor's browser (packages/api/browser), on the
# library store that seed.sh builds.
#
# Usage: build-browser-site.sh [out-dir]
#
# | Setting | Default | Use |
# | --- | --- | --- |
# | out-dir (argument) | packages/web/.output/public | The site |
# | DEMO_STORE | tmp/demo/store/library.sqlite | The seeded library; seeded when it does not exist |
# | SITE_BASE | / | The path the site is served under, with both slashes |
# | DEMO_ETL_OUTPUT | etl-output beside the store | The seeded ETL runs' output files, which the site carries |
# | DUCKDB_BASE_URL | jsDelivr | Where the browser loads duckdb-wasm from, for ETL |
#
# The site has the map page at `map/`, which reads the Rail library's OGC API
# Features service from the same Worker.
#
# Serve the result with any static file server, for example
# `node packages/api/browser/test/serve.mjs <out-dir> 3721 200.html`.
set -eu

root="$(cd "$(dirname "$0")/../.." && pwd)"
out="${1:-${root}/packages/web/.output/public}"
store="${DEMO_STORE:-${root}/tmp/demo/store/library.sqlite}"
site_base="${SITE_BASE:-/}"

if [ ! -s "${store}" ]; then
  state="$(dirname "$(dirname "${store}")")"
  rm -rf "${state}"
  DEMO_OGC=true LIBRARY_STORAGE_DIR="$(dirname "${store}")" ETL_OUTPUT_DIR="${state}/etl-output" \
  DEMO_API_DIR="${root}/packages/api" DEMO_API_CMD="node_modules/.bin/tsx src/index.ts" \
    sh "${root}/demo/scripts/seed.sh"
fi

# The web app, with the demo's feature flags and the API in the browser.
(
  set -a
  # shellcheck disable=SC1091
  . "${root}/demo/server.env"
  set +a
  cd "${root}/packages/web"
  NUXT_PUBLIC_API_BASE_URL=browser NUXT_APP_BASE_URL="${site_base}" pnpm exec nuxt generate
)
if [ "${out}" != "${root}/packages/web/.output/public" ]; then
  rm -rf "${out}"
  mkdir -p "${out}"
  cp -a "${root}/packages/web/.output/public/." "${out}/"
fi

# The API Worker, its WebAssembly and the library.
etl_output="${DEMO_ETL_OUTPUT:-$(dirname "$(dirname "${store}")")/etl-output}"
if [ -d "${etl_output}" ]; then export SQLIB_BROWSER_ETL_OUTPUT="${etl_output}"; fi
(cd "${root}/packages/api" && node browser/build.mjs "${out}/sqlib-api")
rm -f "${out}"/sqlib-api/*.map
cp "${store}" "${out}/sqlib-api/library.sqlite"

node -e '
  const [file, duckdb] = process.argv.slice(1);
  const config = { apiBaseUrl: "browser", ...(duckdb ? { duckdbBaseUrl: duckdb } : {}) };
  require("node:fs").writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
' "${out}/config.json" "${DUCKDB_BASE_URL:-}"

# The map page, a client of the Rail library's OGC API Features service.
(cd "${root}/packages/ogc-map" && node build.mjs "${out}/map")
printf '{\n  "service": "rail"\n}\n' > "${out}/map/config.json"

# Cache rules for hosts that read a `_headers` file, such as Cloudflare static
# assets. The `_nuxt` files have a content hash in their names. The API files
# do not, so a browser checks them with the ETag on each load.
cat > "${out}/_headers" <<'EOF'
/_nuxt/*
  Cache-Control: public, max-age=31536000, immutable
/sqlib-api/*
  Cache-Control: public, max-age=0, must-revalidate
EOF

echo "build-browser-site: wrote ${out}"
