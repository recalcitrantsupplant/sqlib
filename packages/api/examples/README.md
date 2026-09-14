# API Examples

This directory contains realistic, executable examples for the SPARQL Query Library API.

## Structure

- `workflows/` - Complete workflow examples that chain together
- `individual/` - Individual endpoint examples
- `README.md` - This file explaining the structure

## Workflow Examples

The examples are designed to be executable in sequence, with outputs from one request used as inputs to the next. This demonstrates the complete lifecycle of:

1. **Backend** - Create a SPARQL endpoint backend
2. **Library** - Create a library to organise queries
3. **Query** - Create a query definition
4. **QueryVersion** - Create a versioned query with SPARQL
5. **QueryGroup** - Create a group to orchestrate queries
6. **QueryGroupVersion** - Create a workflow version with nodes and edges
7. **Execute** - Execute the complete query workflow

## Usage

Each JSON file contains a realistic example that can be used directly in the Swagger UI or API testing tools. The examples use placeholder IDs that would be replaced with actual IDs returned from previous requests in a real workflow.