# Example CSV Data for ETL Playground

This directory contains example CSV files for testing the ETL playground.

## Files

### books.csv
Book catalog dataset:
- `isbn` - ISBN number (text)
- `title` - Book title (text)
- `author` - Author name (text)
- `publication_year` - Year published (integer)
- `genre` - Literary genre (text)
- `pages` - Number of pages (integer)

**Example DuckDB queries:**
```sql
-- All books
SELECT * FROM read_csv('data/examples/books.csv')

-- Books by George Orwell
SELECT title, publication_year
FROM read_csv('data/examples/books.csv')
WHERE author = 'George Orwell'

-- Average pages by genre
SELECT genre, AVG(pages) as avg_pages, COUNT(*) as book_count
FROM read_csv('data/examples/books.csv')
GROUP BY genre
ORDER BY avg_pages DESC
```

### people.csv
Simple dataset with person information:
- `id` - Person ID (integer)
- `name` - Full name (text)
- `age` - Age in years (integer)
- `city` - City of residence (text)
- `country` - Country of residence (text)

**Example DuckDB queries:**
```sql
-- All people
SELECT * FROM read_csv('data/examples/people.csv')

-- People over 30
SELECT name, age, city
FROM read_csv('data/examples/people.csv')
WHERE age > 30

-- Count by country
SELECT country, COUNT(*) as count
FROM read_csv('data/examples/people.csv')
GROUP BY country
```

### products.csv
Product catalog dataset:
- `product_id` - Product identifier (text)
- `product_name` - Product name (text)
- `category` - Product category (text)
- `price` - Price in USD (decimal)
- `stock_quantity` - Units in stock (integer)

**Example DuckDB queries:**
```sql
-- All products
SELECT * FROM read_csv('data/examples/products.csv')

-- Electronics only
SELECT product_name, price
FROM read_csv('data/examples/products.csv')
WHERE category = 'Electronics'

-- Total value by category
SELECT category,
       COUNT(*) as product_count,
       SUM(price * stock_quantity) as total_value
FROM read_csv('data/examples/products.csv')
GROUP BY category
```

## Usage in ETL Playground

1. **SQL Query** - Use DuckDB's `read_csv()` function:
   ```sql
   SELECT * FROM read_csv('data/examples/people.csv')
   ```

2. **Column Mappings** - Map CSV columns to SPARQL variables:
   - `id` → `?personId` (Literal: xsd:integer)
   - `name` → `?name` (Literal: xsd:string)
   - `city` → `?city` (Literal: xsd:string)

3. **SPARQL Template** - Transform to RDF:
   ```sparql
   PREFIX ex: <http://example.org/>
   PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

   CONSTRUCT {
     ?person a ex:Person ;
       ex:name ?name ;
       ex:age ?age ;
       ex:city ?city .
   }
   WHERE {
     VALUES (?personId ?name ?age ?city) {
       (UNDEF UNDEF UNDEF UNDEF)
     }
     BIND(IRI(CONCAT("http://example.org/person/", STR(?personId))) AS ?person)
   }
   ```

## Path Notes

- Paths are relative to the repository root
- When running locally, DuckDB resolves paths from where the API server is running
- In production, you might need to adjust paths or use absolute paths
