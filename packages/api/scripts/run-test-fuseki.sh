#!/bin/bash

# Simple script to run Fuseki for LDKit testing
# Based on your existing Taskfile pattern but simplified for testing

FUSEKI_IMAGE="fuseki:5.5.0-3"
CONTAINER_NAME="fuseki-ldkit-test"
HOST_PORT="3031"
DATASET_NAME="testing123"

echo "🧪 Starting Fuseki for LDKit testing..."

# Stop and remove existing container if it exists
docker rm -f $CONTAINER_NAME 2>/dev/null || true

# Create minimal config directory
mkdir -p ./fuseki-test/config
mkdir -p ./fuseki-test/databases

# Create standard TDB2 config for testing dataset
cat > ./fuseki-test/config/config.ttl << EOF
PREFIX :        <#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX ex: <https://example.com/>
PREFIX fuseki:  <http://jena.apache.org/fuseki#>
PREFIX rdf:     <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <https://schema.org/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX tdb2:    <http://jena.apache.org/2016/tdb#>
PREFIX text: <http://jena.apache.org/text#>

[] rdf:type fuseki:Server .

:service1 rdf:type fuseki:Service ;
  fuseki:name                        "${DATASET_NAME}" ;
  fuseki:serviceQuery                "sparql" ;
  fuseki:serviceQuery                "query" ;
  fuseki:serviceUpdate               "update" ;
  fuseki:serviceUpload               "upload" ;
  fuseki:serviceReadWriteGraphStore  "data" ;     
  fuseki:serviceReadGraphStore       "get" ;
  fuseki:dataset                     :tdb_dataset_readwrite ;
.

:tdb_dataset_readwrite
  rdf:type       tdb2:DatasetTDB2;
  tdb2:unionDefaultGraph false ;
  tdb2:location  "/fuseki/databases/${DATASET_NAME}" ;
.
EOF

echo "Starting Fuseki container on port $HOST_PORT..."

# Run Fuseki container
docker run \
  -p $HOST_PORT:3030 \
  -v "$(pwd)/fuseki-test/config/config.ttl:/opt/fuseki/configuration/config.ttl" \
  -v "$(pwd)/fuseki-test/databases:/fuseki/databases" \
  --name $CONTAINER_NAME \
  --rm \
  -d \
  $FUSEKI_IMAGE

if [ $? -eq 0 ]; then
    echo "✅ Fuseki started successfully!"
    echo ""
    echo "🔗 Endpoints:"
    echo "  Query:  http://localhost:$HOST_PORT/$DATASET_NAME/sparql"
    echo "  Update: http://localhost:$HOST_PORT/$DATASET_NAME/update"
    echo "  UI:     http://localhost:$HOST_PORT"
    echo ""
    echo "🧪 Now you can run your LDKit validation tests:"
    echo "  npm test test/ldkit-persistence/validation/QueryNodeValidation.test.ts"
else
    echo "❌ Failed to start Fuseki container"
    exit 1
fi