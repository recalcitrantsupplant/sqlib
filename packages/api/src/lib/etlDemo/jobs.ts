/**
 * The saved ETL jobs of the ETL examples library.
 *
 * Each job is complete: SQL, a column mapping and a CONSTRUCT template, so
 * Run works as soon as the job opens. They replace the SQL-only list that the
 * ETL screen's "Load example..." menu held.
 *
 * What each job needs from the deployment:
 *
 * - `inline`: nothing. DuckDB reads no file.
 * - `file`: `ETL_DUCKDB_ALLOW_FILESYSTEM=true`, and an API whose working
 *   directory is `packages/api`, which `just run-local-etl-demo` gives.
 * - `http`: `ETL_DUCKDB_ALLOW_HTTP=true`, outbound network access, and the
 *   `httpfs` extension: installed, or `ETL_DUCKDB_ALLOW_EXTENSION_INSTALL=true`.
 */
import type { ColumnDefinition } from '@sparql-query-lib/runtime-etl';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

export interface EtlDemoJob {
  /** Stable, and unique in the library: a re-run finds the job by it. */
  name: string;
  description: string;
  needs: 'inline' | 'file' | 'http';
  sql: string;
  columns: ColumnDefinition[];
  sparqlTemplate: string;
}

const literal = (columnName: string, datatype: string, targetVariable = columnName): ColumnDefinition => ({
  columnName,
  targetVariable,
  termType: 'literal',
  datatypeIri: `${XSD}${datatype}`,
  nullPolicy: 'undef',
});

export const ETL_DEMO_JOBS: readonly EtlDemoJob[] = [
  {
    name: 'People to RDF (inline rows)',
    description: 'Four people from a SELECT with inline rows. The person column holds IRIs.',
    needs: 'inline',
    sql: `SELECT * FROM (VALUES
  ('https://example.org/person/1', 'Alice Smith', 28, 'London'),
  ('https://example.org/person/2', 'Bob Johnson', 35, 'New York'),
  ('https://example.org/person/3', 'Chloé Martin', 41, 'Paris'),
  ('https://example.org/person/4', 'Daniel Okafor', 23, 'Lagos')
) AS people(person, name, age, city)`,
    columns: [
      { columnName: 'person', targetVariable: 'person', termType: 'uri', nullPolicy: 'skipRow' },
      literal('name', 'string'),
      literal('age', 'integer'),
      literal('city', 'string'),
    ],
    sparqlTemplate: `PREFIX schema: <https://schema.org/>

CONSTRUCT {
  ?person a schema:Person ;
    schema:name ?name ;
    schema:age ?age ;
    schema:homeLocation [ a schema:Place ; schema:name ?city ] .
}
WHERE {
  VALUES (?person ?name ?age ?city) { (UNDEF UNDEF UNDEF UNDEF) }
}`,
  },
  {
    name: 'People CSV to RDF',
    description: 'Reads data/examples/people.csv. The person IRI comes from an IRI template on the id column.',
    needs: 'file',
    sql: `SELECT id, name, age, city, country
FROM read_csv('data/examples/people.csv', header = true)`,
    columns: [
      {
        columnName: 'id', targetVariable: 'person', termType: 'uri',
        iriTemplate: 'https://example.org/person/{value}', nullPolicy: 'skipRow',
      },
      literal('name', 'string'),
      literal('age', 'integer'),
      literal('city', 'string'),
      literal('country', 'string'),
    ],
    sparqlTemplate: `PREFIX schema: <https://schema.org/>

CONSTRUCT {
  ?person a schema:Person ;
    schema:name ?name ;
    schema:age ?age ;
    schema:address [ a schema:PostalAddress ; schema:addressLocality ?city ; schema:addressCountry ?country ] .
}
WHERE {
  VALUES (?person ?name ?age ?city ?country) { (UNDEF UNDEF UNDEF UNDEF UNDEF) }
}`,
  },
  {
    name: 'Books CSV to RDF',
    description: 'Reads data/examples/books.csv. The book IRI is built from the ISBN in the template.',
    needs: 'file',
    sql: `SELECT isbn, title, author, publication_year, genre, pages
FROM read_csv('data/examples/books.csv', header = true)`,
    columns: [
      literal('isbn', 'string'),
      literal('title', 'string'),
      literal('author', 'string'),
      literal('publication_year', 'gYear', 'year'),
      literal('genre', 'string'),
      literal('pages', 'integer'),
    ],
    sparqlTemplate: `PREFIX schema: <https://schema.org/>

CONSTRUCT {
  ?book a schema:Book ;
    schema:isbn ?isbn ;
    schema:name ?title ;
    schema:author [ a schema:Person ; schema:name ?author ] ;
    schema:datePublished ?year ;
    schema:genre ?genre ;
    schema:numberOfPages ?pages .
}
WHERE {
  VALUES (?isbn ?title ?author ?year ?genre ?pages) { (UNDEF UNDEF UNDEF UNDEF UNDEF UNDEF) }
  BIND(IRI(CONCAT("https://example.org/book/", ENCODE_FOR_URI(?isbn))) AS ?book)
}`,
  },
  {
    name: 'Products CSV to RDF',
    description: 'Reads data/examples/products.csv. Each product becomes an offer with a price and a stock level.',
    needs: 'file',
    sql: `SELECT product_id, product_name, category, price, stock_quantity
FROM read_csv('data/examples/products.csv', header = true)`,
    columns: [
      {
        columnName: 'product_id', targetVariable: 'product', termType: 'uri',
        iriTemplate: 'https://example.org/product/{value}', nullPolicy: 'skipRow',
      },
      literal('product_name', 'string', 'name'),
      literal('category', 'string'),
      literal('price', 'decimal'),
      literal('stock_quantity', 'integer', 'stock'),
    ],
    sparqlTemplate: `PREFIX schema: <https://schema.org/>

CONSTRUCT {
  ?product a schema:Product ;
    schema:name ?name ;
    schema:category ?category ;
    schema:offers [ a schema:Offer ; schema:price ?price ; schema:priceCurrency "USD" ; schema:inventoryLevel ?stock ] .
}
WHERE {
  VALUES (?product ?name ?category ?price ?stock) { (UNDEF UNDEF UNDEF UNDEF UNDEF) }
}`,
  },
  {
    name: 'NZ greenhouse gas emissions (remote CSV)',
    description: 'Reads a CSV from stats.govt.nz over HTTP: emissions by region and industry, totals only.',
    needs: 'http',
    sql: `SELECT Region AS region, Anzsic_descriptor AS industry, Gas AS gas, Year AS year,
       Data_value AS value, Units AS units
FROM read_csv('https://www.stats.govt.nz/assets/Uploads/Greenhouse-gas-emissions-by-region-industry-and-household/Greenhouse-gas-emissions-by-region-industry-and-household-Year-ended-2024/Download-data/greenhouse-gas-emissions-by-region-industry-and-household-year-ended-2024.csv')
WHERE Sub_industry = 'Total' AND Household_category = 'Total'`,
    columns: [
      literal('region', 'string'),
      literal('industry', 'string'),
      literal('gas', 'string'),
      literal('year', 'gYear'),
      literal('value', 'decimal'),
      literal('units', 'string'),
    ],
    sparqlTemplate: `PREFIX sosa: <http://www.w3.org/ns/sosa/>
PREFIX schema: <https://schema.org/>

CONSTRUCT {
  _:observation a sosa:Observation ;
    sosa:hasFeatureOfInterest [ schema:name ?region ] ;
    schema:industry ?industry ;
    sosa:observedProperty [ schema:name ?gas ] ;
    sosa:phenomenonTime ?year ;
    sosa:hasSimpleResult ?value ;
    schema:unitText ?units .
}
WHERE {
  VALUES (?region ?industry ?gas ?year ?value ?units) { (UNDEF UNDEF UNDEF UNDEF UNDEF UNDEF) }
}`,
  },
  {
    name: 'CrossRef RAG/LLM paper facets (remote JSON)',
    description: 'Reads the CrossRef works API over HTTP: counts of papers on retrieval augmented generation by year and type.',
    needs: 'http',
    sql: `SELECT facet_name, facet_value, facet_count
FROM (
  SELECT 'published' AS facet_name, p.key AS facet_value, CAST(p.value AS BIGINT) AS facet_count
  FROM read_json_auto(
    'https://api.crossref.org/works?query.title=retrieval%20augmented%20generation%20RAG%20LLM&filter=from-pub-date:2022-01-01,until-pub-date:2025-12-31,type:journal-article&rows=0&facet=published:10,type-name:10'
  ) r,
  json_each(to_json(r.message.facets.published.values)) p

  UNION ALL

  SELECT 'type-name' AS facet_name, t.key AS facet_value, CAST(t.value AS BIGINT) AS facet_count
  FROM read_json_auto(
    'https://api.crossref.org/works?query.title=retrieval%20augmented%20generation%20RAG%20LLM&filter=from-pub-date:2022-01-01,until-pub-date:2025-12-31,type:journal-article&rows=0&facet=published:10,type-name:10'
  ) r,
  json_each(to_json(r.message.facets."type-name".values)) t
) x
WHERE facet_value IS NOT NULL`,
    columns: [
      literal('facet_name', 'string', 'facet'),
      literal('facet_value', 'string', 'value'),
      literal('facet_count', 'integer', 'count'),
    ],
    sparqlTemplate: `PREFIX ex: <https://example.org/crossref/>

CONSTRUCT {
  _:count a ex:FacetCount ;
    ex:facet ?facet ;
    ex:value ?value ;
    ex:count ?count .
}
WHERE {
  VALUES (?facet ?value ?count) { (UNDEF UNDEF UNDEF) }
}`,
  },
];
