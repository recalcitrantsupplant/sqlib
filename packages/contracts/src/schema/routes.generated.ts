/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */

import { backendSchema, librarySchema, querySchema, querygroupSchema, queryversionSchema, argumentgraphbindingSchema, argumentscalarbindingSchema, argumentsetSchema, argumentsetversionSchema, argumenttuplebindingSchema, benchmarkexperimentSchema, benchmarkexperimentversionSchema, benchmarkiterationobservationSchema, benchmarkiterationrunSchema, benchmarknodeobservationSchema, benchmarknoderunSchema, benchmarkobservationSchema, benchmarkrunSchema, booleanioSchema, datablockSchema, datablockversionSchema, datagraphSchema, datagraphversionSchema, duckdbetlnodeSchema, dynamicquerynodeSchema, endnodeSchema, etlcolumnmappingSchema, etlcolumnmappingversionSchema, etlexecutionSchema, etljobSchema, etljobversionSchema, limitparameterSchema, offsetparameterSchema, patchnodeSchema, patchSchema, queryedgeSchema, querygroupversionSchema, queryidinputSchema, queryinputtupleSchema, queryinputvariableSchema, querynodeSchema, queryoutputtupleSchema, queryoutputvariableSchema, ruleSchema, rulesetnodeSchema, rulesetSchema, rulesetversionSchema, ruleversionSchema, startnodeSchema, tagSchema, testcasedatagraphSchema, testcaseSchema, testruncaseSchema, testrunSchema, testSchema, testversionSchema, triplesquadsioSchema, tuplememberSchema, tuplesetSchema, tuplesetversionSchema } from './entities.generated.js';

// Route Validation Schemas

// Route schemas for Backend
export const getBackendsSchema = {
  "tags": [
    "Backend"
  ],
  "summary": "Get all backends",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "backend#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getBackendSchema = {
  "tags": [
    "Backend"
  ],
  "summary": "Get backend by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "backend#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createBackendSchema = {
  "tags": [
    "Backend"
  ],
  "summary": "Create new backend",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "backendType": {
        "type": "string",
        "enum": [
          "http",
          "oxigraphEphemeral",
          "oxigraphMemory"
        ]
      },
      "endpoint": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "authEnvKey": {
        "type": "string",
        "nullable": true,
        "pattern": "^[A-Z0-9_]+$"
      },
      "queryMethod": {
        "type": [
          "string",
          "null"
        ],
        "enum": [
          "post",
          "get",
          null
        ],
        "nullable": true
      },
      "oxigraphConfig": {
        "type": "string",
        "nullable": true
      }
    },
    "required": [
      "name",
      "backendType"
    ],
    "additionalProperties": false,
    "examples": [
      {
        "id": "urn:example:backend:dbpedia",
        "name": "DBpedia SPARQL Endpoint",
        "description": "Public DBpedia SPARQL endpoint for example queries",
        "backendType": "http",
        "endpoint": "https://dbpedia.org/sparql"
      }
    ]
  },
  "response": {
    "201": {
      "$ref": "backend#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateBackendSchema = {
  "tags": [
    "Backend"
  ],
  "summary": "Update backend",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "backendType": {
        "type": "string",
        "enum": [
          "http",
          "oxigraphEphemeral",
          "oxigraphMemory"
        ]
      },
      "endpoint": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "authEnvKey": {
        "type": "string",
        "nullable": true,
        "pattern": "^[A-Z0-9_]+$"
      },
      "queryMethod": {
        "type": [
          "string",
          "null"
        ],
        "enum": [
          "post",
          "get",
          null
        ],
        "nullable": true
      },
      "oxigraphConfig": {
        "type": "string",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "backend#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const deleteBackendSchema = {
  "tags": [
    "Backend"
  ],
  "summary": "Delete backend",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "204": {},
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for Library
export const getLibrarysSchema = {
  "tags": [
    "Library"
  ],
  "summary": "Get all librarys",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "library#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getLibrarySchema = {
  "tags": [
    "Library"
  ],
  "summary": "Get library by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "library#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createLibrarySchema = {
  "tags": [
    "Library"
  ],
  "summary": "Create new library",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "defaultBackend": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "allowedBackends": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name"
    ],
    "additionalProperties": false,
    "examples": [
      {
        "id": "urn:example:library:dbpedia",
        "name": "Example Queries for DBpedia",
        "description": "A collection of example queries for exploring DBpedia"
      }
    ]
  },
  "response": {
    "201": {
      "$ref": "library#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateLibrarySchema = {
  "tags": [
    "Library"
  ],
  "summary": "Update library",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "defaultBackend": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "allowedBackends": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "library#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const deleteLibrarySchema = {
  "tags": [
    "Library"
  ],
  "summary": "Delete library",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "204": {},
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for Query
export const getQuerysSchema = {
  "tags": [
    "Query"
  ],
  "summary": "Get all querys",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "query#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getQuerySchema = {
  "tags": [
    "Query"
  ],
  "summary": "Get query by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "examples": [
          "urn:example:query:cities-by-population"
        ]
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "query#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createQuerySchema = {
  "tags": [
    "Query"
  ],
  "summary": "Create new query",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "defaultBackend": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "argumentSets": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name",
      "isPartOf"
    ],
    "additionalProperties": false,
    "examples": [
      {
        "id": "urn:example:query:cities-by-population",
        "name": "Find Cities by Population",
        "description": "Query to find cities with population greater than a specified threshold",
        "isPartOf": [
          "urn:example:library:dbpedia"
        ],
        "comment": "This query demonstrates parameterized SPARQL with population filtering"
      }
    ]
  },
  "response": {
    "201": {
      "$ref": "query#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateQuerySchema = {
  "tags": [
    "Query"
  ],
  "summary": "Update query",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "examples": [
          "urn:example:query:cities-by-population"
        ]
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "defaultBackend": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "argumentSets": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "query#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const deleteQuerySchema = {
  "tags": [
    "Query"
  ],
  "summary": "Delete query",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "examples": [
          "urn:example:query:cities-by-population"
        ]
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "204": {},
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for QueryGroup
export const getQueryGroupsSchema = {
  "tags": [
    "QueryGroup"
  ],
  "summary": "Get all querygroups",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "querygroup#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getQueryGroupSchema = {
  "tags": [
    "QueryGroup"
  ],
  "summary": "Get querygroup by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "querygroup#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createQueryGroupSchema = {
  "tags": [
    "QueryGroup"
  ],
  "summary": "Create new querygroup",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "string",
        "format": "iri"
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "argumentSets": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name",
      "isPartOf"
    ],
    "additionalProperties": false,
    "examples": [
      {
        "id": "urn:example:querygroup:city-analysis",
        "name": "City Analysis Workflow",
        "description": "A workflow for analyzing cities and their characteristics using multiple related queries",
        "isPartOf": "urn:example:library:knowledge-graphs",
        "comment": "This query group demonstrates chaining queries to build complex analytical workflows"
      }
    ]
  },
  "response": {
    "201": {
      "$ref": "querygroup#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateQueryGroupSchema = {
  "tags": [
    "QueryGroup"
  ],
  "summary": "Update querygroup",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "string",
        "format": "iri"
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "argumentSets": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "querygroup#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const deleteQueryGroupSchema = {
  "tags": [
    "QueryGroup"
  ],
  "summary": "Delete querygroup",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "204": {},
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for QueryVersion
export const getQueryVersionsSchema = {
  "tags": [
    "QueryVersion"
  ],
  "summary": "Get all queryversions",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "queryversion#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getQueryVersionSchema = {
  "tags": [
    "QueryVersion"
  ],
  "summary": "Get queryversion by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "queryversion#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createQueryVersionSchema = {
  "tags": [
    "QueryVersion"
  ],
  "summary": "Create new queryversion",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "string",
        "format": "iri"
      },
      "version": {
        "type": "integer"
      },
      "immutable": {
        "type": "boolean",
        "nullable": true
      },
      "queryString": {
        "type": "string",
        "minLength": 1
      },
      "comment": {
        "type": "string",
        "nullable": true
      },
      "queryType": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "srlImportable": {
        "type": "boolean",
        "nullable": true
      },
      "srlImportRevision": {
        "type": "integer",
        "nullable": true
      },
      "limitParameters": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "offsetParameters": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "inferredInputs": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "inferredOutputs": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "isPartOf",
      "version",
      "queryString"
    ],
    "additionalProperties": false,
    "examples": [
      {
        "queryVersion": {
          "queryString": "PREFIX dbo: <http://dbpedia.org/ontology/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> SELECT ?city ?cityName ?population WHERE { VALUES ?minPopulation { UNDEF } ?city a dbo:City ; rdfs:label ?cityName ; dbo:populationTotal ?population . FILTER(?population > ?minPopulation) FILTER(LANG(?cityName) = \"en\")}ORDER BY DESC(?population) LIMIT 10",
          "queryType": "SELECT",
          "defaultBackend": "urn:example:backend:dbpedia",
          "comment": "Version 1 - Basic city population query with parameterization"
        }
      }
    ]
  },
  "response": {
    "201": {
      "$ref": "queryversion#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const detectInputsQueryVersionSchema = {
  "tags": [
    "QueryVersion"
  ],
  "summary": "Detect input groups in a SPARQL query",
  "response": {
    "200": {
      "type": "object",
      "description": "Detected inputs including VALUES groups, LIMIT placeholders, and OFFSET placeholders.",
      "properties": {
        "valuesInputs": {
          "type": "array",
          "description": "An array of input groups (from VALUES clauses), where each group is an array of variable names.",
          "items": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "limitParameters": {
          "type": "array",
          "description": "An array of detected LIMIT parameter placeholder names.",
          "items": {
            "type": "string"
          }
        },
        "offsetParameters": {
          "type": "array",
          "description": "An array of detected OFFSET parameter placeholder names.",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "valuesInputs",
        "limitParameters",
        "offsetParameters"
      ]
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  },
  "body": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The SPARQL query string to analyze."
      }
    },
    "required": [
      "query"
    ],
    "additionalProperties": false,
    "examples": [
      null
    ]
  }
} as const;

export const detectOutputsQueryVersionSchema = {
  "tags": [
    "QueryVersion"
  ],
  "summary": "Detect output variables in a SELECT query",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  },
  "body": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The SPARQL query string to analyze."
      }
    },
    "required": [
      "query"
    ],
    "additionalProperties": false,
    "examples": [
      {
        "query": "PREFIX dbo: <http://dbpedia.org/ontology/>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n\nSELECT ?city ?cityName ?population WHERE {\n  ?city a dbo:City ;\n        rdfs:label ?cityName ;\n        dbo:populationTotal ?population .\n  \n  FILTER(?population > 1000000)\n  FILTER(LANG(?cityName) = \"en\")\n}\nORDER BY DESC(?population)\nLIMIT 10"
      }
    ]
  }
} as const;

export const validateQueryQueryVersionSchema = {
  "tags": [
    "QueryVersion"
  ],
  "summary": "Validate SPARQL query syntax",
  "response": {
    "200": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "valid": {
          "type": "boolean",
          "const": true
        }
      },
      "required": [
        "valid"
      ]
    },
    "400": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "valid": {
          "type": "boolean",
          "const": false
        },
        "error": {
          "type": "string"
        }
      },
      "required": [
        "valid",
        "error"
      ]
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  },
  "body": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The SPARQL query string to validate."
      }
    },
    "required": [
      "query"
    ],
    "additionalProperties": false
  }
} as const;

// Route schemas for BenchmarkExperiment
export const getBenchmarkExperimentsSchema = {
  "tags": [
    "BenchmarkExperiment"
  ],
  "summary": "Get all benchmarkexperiments",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "benchmarkexperiment#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getBenchmarkExperimentSchema = {
  "tags": [
    "BenchmarkExperiment"
  ],
  "summary": "Get benchmarkexperiment by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "benchmarkexperiment#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createBenchmarkExperimentSchema = {
  "tags": [
    "BenchmarkExperiment"
  ],
  "summary": "Create new benchmarkexperiment",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "status": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      }
    },
    "required": [
      "name"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "benchmarkexperiment#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateBenchmarkExperimentSchema = {
  "tags": [
    "BenchmarkExperiment"
  ],
  "summary": "Update benchmarkexperiment",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "status": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "benchmarkexperiment#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const deleteBenchmarkExperimentSchema = {
  "tags": [
    "BenchmarkExperiment"
  ],
  "summary": "Delete benchmarkexperiment",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "204": {},
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for BenchmarkExperimentVersion
export const getBenchmarkExperimentVersionsSchema = {
  "tags": [
    "BenchmarkExperimentVersion"
  ],
  "summary": "Get all benchmarkexperimentversions",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "benchmarkexperimentversion#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getBenchmarkExperimentVersionSchema = {
  "tags": [
    "BenchmarkExperimentVersion"
  ],
  "summary": "Get benchmarkexperimentversion by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "benchmarkexperimentversion#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createBenchmarkExperimentVersionSchema = {
  "tags": [
    "BenchmarkExperimentVersion"
  ],
  "summary": "Create new benchmarkexperimentversion",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "string",
        "format": "iri"
      },
      "version": {
        "type": "integer"
      },
      "immutable": {
        "type": "boolean",
        "nullable": true
      },
      "subjectSpecs": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "subject": {
              "type": "string",
              "format": "iri"
            },
            "inputs": {
              "type": "array",
              "items": {
                "type": "string",
                "format": "iri"
              },
              "nullable": true
            },
            "backends": {
              "type": "array",
              "items": {
                "type": "string",
                "format": "iri"
              },
              "nullable": true
            },
            "dataGraphs": {
              "type": "array",
              "items": {
                "type": "string",
                "format": "iri"
              },
              "nullable": true
            }
          },
          "required": [
            "subject"
          ]
        }
      },
      "repeats": {
        "type": "integer",
        "nullable": true
      },
      "executionStrategy": {
        "type": "string",
        "nullable": true
      },
      "timeWindow": {
        "type": "string",
        "nullable": true
      },
      "maxConcurrency": {
        "type": "integer",
        "nullable": true
      },
      "warmupRuns": {
        "type": "integer",
        "nullable": true
      },
      "cooldownMs": {
        "type": "integer",
        "nullable": true
      },
      "timeoutMs": {
        "type": "integer",
        "nullable": true
      },
      "retryCount": {
        "type": "integer",
        "nullable": true
      },
      "retryDelayMs": {
        "type": "integer",
        "nullable": true
      },
      "randomizeOrder": {
        "type": "boolean",
        "nullable": true
      },
      "abortOnError": {
        "type": "boolean",
        "nullable": true
      }
    },
    "required": [
      "isPartOf",
      "version",
      "subjectSpecs"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "benchmarkexperimentversion#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateBenchmarkExperimentVersionSchema = {
  "tags": [
    "BenchmarkExperimentVersion"
  ],
  "summary": "Update benchmarkexperimentversion",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "isPartOf": {
        "type": "string",
        "format": "iri"
      },
      "version": {
        "type": "integer"
      },
      "immutable": {
        "type": "boolean",
        "nullable": true
      },
      "subjectSpecs": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "subject": {
              "type": "string",
              "format": "iri"
            },
            "inputs": {
              "type": "array",
              "items": {
                "type": "string",
                "format": "iri"
              },
              "nullable": true
            },
            "backends": {
              "type": "array",
              "items": {
                "type": "string",
                "format": "iri"
              },
              "nullable": true
            },
            "dataGraphs": {
              "type": "array",
              "items": {
                "type": "string",
                "format": "iri"
              },
              "nullable": true
            }
          },
          "required": [
            "subject"
          ]
        }
      },
      "repeats": {
        "type": "integer",
        "nullable": true
      },
      "executionStrategy": {
        "type": "string",
        "nullable": true
      },
      "timeWindow": {
        "type": "string",
        "nullable": true
      },
      "maxConcurrency": {
        "type": "integer",
        "nullable": true
      },
      "warmupRuns": {
        "type": "integer",
        "nullable": true
      },
      "cooldownMs": {
        "type": "integer",
        "nullable": true
      },
      "timeoutMs": {
        "type": "integer",
        "nullable": true
      },
      "retryCount": {
        "type": "integer",
        "nullable": true
      },
      "retryDelayMs": {
        "type": "integer",
        "nullable": true
      },
      "randomizeOrder": {
        "type": "boolean",
        "nullable": true
      },
      "abortOnError": {
        "type": "boolean",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "benchmarkexperimentversion#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const deleteBenchmarkExperimentVersionSchema = {
  "tags": [
    "BenchmarkExperimentVersion"
  ],
  "summary": "Delete benchmarkexperimentversion",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "204": {},
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for DataBlock
export const createDataBlockSchema = {
  "tags": [
    "DataBlock"
  ],
  "summary": "Create new datablock",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "rulesetMembership": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name",
      "isPartOf"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "datablock#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateDataBlockSchema = {
  "tags": [
    "DataBlock"
  ],
  "summary": "Update datablock",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "rulesetMembership": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "datablock#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for DataGraph
export const createDataGraphSchema = {
  "tags": [
    "DataGraph"
  ],
  "summary": "Create new datagraph",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "mintedFrom": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name",
      "isPartOf"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "datagraph#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateDataGraphSchema = {
  "tags": [
    "DataGraph"
  ],
  "summary": "Update datagraph",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "mintedFrom": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "datagraph#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for EtlJob
export const getEtlJobsSchema = {
  "tags": [
    "EtlJob"
  ],
  "summary": "Get all etljobs",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "etljob#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getEtlJobSchema = {
  "tags": [
    "EtlJob"
  ],
  "summary": "Get etljob by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "etljob#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createEtlJobSchema = {
  "tags": [
    "EtlJob"
  ],
  "summary": "Create new etljob",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        }
      },
      "argumentSets": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name",
      "isPartOf"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "etljob#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateEtlJobSchema = {
  "tags": [
    "EtlJob"
  ],
  "summary": "Update etljob",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        }
      },
      "argumentSets": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "etljob#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const deleteEtlJobSchema = {
  "tags": [
    "EtlJob"
  ],
  "summary": "Delete etljob",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "204": {},
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for EtlJobVersion
export const getEtlJobVersionsSchema = {
  "tags": [
    "EtlJobVersion"
  ],
  "summary": "Get all etljobversions",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "etljobversion#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getEtlJobVersionSchema = {
  "tags": [
    "EtlJobVersion"
  ],
  "summary": "Get etljobversion by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "etljobversion#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createEtlJobVersionSchema = {
  "tags": [
    "EtlJobVersion"
  ],
  "summary": "Create new etljobversion",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "string",
        "format": "iri"
      },
      "version": {
        "type": "integer"
      },
      "immutable": {
        "type": "boolean",
        "nullable": true
      },
      "sql": {
        "type": "string",
        "minLength": 1
      },
      "sparqlTemplate": {
        "type": "string",
        "minLength": 1
      },
      "backendId": {
        "type": "string",
        "format": "iri"
      },
      "currentColumnMappingVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "chunkSize": {
        "type": "integer",
        "nullable": true
      },
      "comment": {
        "type": "string",
        "nullable": true
      }
    },
    "required": [
      "isPartOf",
      "version",
      "sql",
      "sparqlTemplate",
      "backendId"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "etljobversion#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for Rule
export const createRuleSchema = {
  "tags": [
    "Rule"
  ],
  "summary": "Create new rule",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "rulesetMembership": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name",
      "isPartOf"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "rule#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateRuleSchema = {
  "tags": [
    "Rule"
  ],
  "summary": "Update rule",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "rulesetMembership": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "rule#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for RuleSet
export const getRuleSetsSchema = {
  "tags": [
    "RuleSet"
  ],
  "summary": "Get all rulesets",
  "response": {
    "200": {
      "type": "array",
      "items": {
        "$ref": "ruleset#"
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const getRuleSetSchema = {
  "tags": [
    "RuleSet"
  ],
  "summary": "Get ruleset by ID",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "200": {
      "$ref": "ruleset#"
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const createRuleSetSchema = {
  "tags": [
    "RuleSet"
  ],
  "summary": "Create new ruleset",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "rules": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "dataBlocks": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name",
      "isPartOf"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "ruleset#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateRuleSetSchema = {
  "tags": [
    "RuleSet"
  ],
  "summary": "Update ruleset",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "rules": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "dataBlocks": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "ruleset#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const deleteRuleSetSchema = {
  "tags": [
    "RuleSet"
  ],
  "summary": "Delete ruleset",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "response": {
    "204": {},
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for Tag
export const createTagSchema = {
  "tags": [
    "Tag"
  ],
  "summary": "Create new tag",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "color": {
        "type": "string",
        "nullable": true,
        "pattern": "^#[0-9a-fA-F]{6}$"
      },
      "isPartOf": {
        "type": "string",
        "format": "iri"
      }
    },
    "required": [
      "name",
      "isPartOf"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "tag#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateTagSchema = {
  "tags": [
    "Tag"
  ],
  "summary": "Update tag",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "color": {
        "type": "string",
        "nullable": true,
        "pattern": "^#[0-9a-fA-F]{6}$"
      },
      "isPartOf": {
        "type": "string",
        "format": "iri"
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "tag#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for Test
export const createTestSchema = {
  "tags": [
    "Test"
  ],
  "summary": "Create new test",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "subject": {
        "type": "string",
        "format": "iri"
      },
      "criterion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "subjectKind": {
        "type": "string",
        "minLength": 1
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name",
      "subject",
      "subjectKind",
      "isPartOf"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "test#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateTestSchema = {
  "tags": [
    "Test"
  ],
  "summary": "Update test",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "subject": {
        "type": "string",
        "format": "iri"
      },
      "criterion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "subjectKind": {
        "type": "string",
        "minLength": 1
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "test#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Route schemas for TupleSet
export const createTupleSetSchema = {
  "tags": [
    "TupleSet"
  ],
  "summary": "Create new tupleset",
  "body": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "copiedFrom": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "required": [
      "name",
      "isPartOf"
    ],
    "additionalProperties": false
  },
  "response": {
    "201": {
      "$ref": "tupleset#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

export const updateTupleSetSchema = {
  "tags": [
    "TupleSet"
  ],
  "summary": "Update tupleset",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  },
  "body": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1
      },
      "description": {
        "type": "string",
        "nullable": true
      },
      "currentVersion": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "isPartOf": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "minItems": 1
      },
      "copiedFrom": {
        "type": "string",
        "format": "iri",
        "nullable": true
      },
      "tags": {
        "type": "array",
        "items": {
          "type": "string",
          "format": "iri"
        },
        "nullable": true
      }
    },
    "additionalProperties": false,
    "minProperties": 1
  },
  "response": {
    "200": {
      "$ref": "tupleset#"
    },
    "400": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "422": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

// Version route schemas (canonical)

// Query versions
export const listQueryVersionsForQuerySchema = {
  tags: ['Query'],
  summary: 'List versions for a query',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:query:cities-by-population'] } }, required: ['id'] },
  response: { 200: { type: 'array', items: { $ref: 'queryversion#' } }, 500: { type: 'object', properties: { error: { type: 'string' } } } }
} as const;

const __createQueryVersionBodySchema = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^urn:",
      "nullable": true
    },
    "immutable": {
      "type": "boolean",
      "nullable": true
    },
    "queryString": {
      "type": "string",
      "minLength": 1
    },
    "comment": {
      "type": "string",
      "nullable": true
    },
    "queryType": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "srlImportable": {
      "type": "boolean",
      "nullable": true
    },
    "srlImportRevision": {
      "type": "integer",
      "nullable": true
    },
    "inferredInputs": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "inferredOutputs": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "dateModified": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    }
  },
  "required": [
    "queryString"
  ]
} as const;

export const createQueryVersionForQuerySchema = {
  tags: ['Query'],
  summary: 'Create new query version',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:query:cities-by-population'] } }, required: ['id'] },
  body: {
    type: 'object', additionalProperties: false,
    properties: {
      queryVersion: __createQueryVersionBodySchema,
      limitParameters: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "name": {
                  "type": "string",
                  "minLength": 1
            },
            "value": {
                  "type": "integer",
                  "nullable": true
            },
            "defaultValue": {
                  "type": "integer",
                  "nullable": true
            }
      },
      "required": [
            "name"
      ]
} },
      offsetParameters: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "name": {
                  "type": "string",
                  "minLength": 1
            },
            "value": {
                  "type": "integer",
                  "nullable": true
            },
            "defaultValue": {
                  "type": "integer",
                  "nullable": true
            }
      },
      "required": [
            "name"
      ]
} },
      inputs: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "variableName": {
                  "type": "string",
                  "minLength": 1
            },
            "allowedTypes": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            }
      },
      "required": [
            "variableName"
      ]
} },
      outputs: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "variableName": {
                  "type": "string",
                  "minLength": 1
            },
            "description": {
                  "type": "string",
                  "nullable": true
            }
      },
      "required": [
            "variableName"
      ]
} },
      tupleMembers: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "position": {
                  "type": "integer"
            },
            "variable": {
                  "type": "string",
                  "format": "iri"
            }
      },
      "required": [
            "position",
            "variable"
      ]
} },
      inputTuples: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "name": {
                  "type": "string",
                  "nullable": true
            },
            "memberEntries": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  }
            },
            "position": {
                  "type": "integer",
                  "nullable": true
            },
            "variableMappings": {
                  "type": "string",
                  "nullable": true
            }
      },
      "required": [
            "memberEntries"
      ]
} },
      outputTuples: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "name": {
                  "type": "string",
                  "minLength": 1
            },
            "outputType": {
                  "type": "string",
                  "nullable": true
            },
            "memberEntries": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  }
            }
      },
      "required": [
            "name",
            "memberEntries"
      ]
} }
    },
    required: ['queryVersion'],
    examples: [
      {
        "queryVersion": {
          "queryString": "PREFIX dbo: <http://dbpedia.org/ontology/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> SELECT ?city ?cityName ?population WHERE { VALUES ?minPopulation { UNDEF } ?city a dbo:City ; rdfs:label ?cityName ; dbo:populationTotal ?population . FILTER(?population > ?minPopulation) FILTER(LANG(?cityName) = \"en\")}ORDER BY DESC(?population) LIMIT 10",
          "queryType": "SELECT",
          "defaultBackend": "urn:example:backend:dbpedia",
          "comment": "Version 1 - Basic city population query with parameterization"
        }
      }
    ]
  },
  response: {
    201: { type: 'object', additionalProperties: false, properties: {
      queryVersion: { $ref: 'queryversion#' },
      limitParameters: { type: 'array', items: { $ref: 'limitparameter#' } },
      offsetParameters: { type: 'array', items: { $ref: 'offsetparameter#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inferredOutputs: { type: 'array', items: { type: 'object' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      iriMap: { type: 'object', additionalProperties: { type: 'string' } }
    }, required: ['queryVersion', 'iriMap'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const getQueryVersionForQuerySchema = {
  tags: ['Query'],
  summary: 'Get query version',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:query:cities-by-population'] }, version: { type: 'string' } }, required: ['id','version'] },
  response: {
    200: { type: 'object', additionalProperties: false, properties: {
      queryVersion: { $ref: 'queryversion#' },
      limitParameters: { type: 'array', items: { $ref: 'limitparameter#' } },
      offsetParameters: { type: 'array', items: { $ref: 'offsetparameter#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inferredOutputs: { type: 'array', items: { type: 'object' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } }
    }, required: ['queryVersion'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const patchQueryVersionForQuerySchema = {
  tags: ['Query'],
  summary: 'Annotate a query version (comment only; content is immutable)',
  description:
    'A version is a snapshot: POST mints the next one, PATCH annotates an existing one, and there is no PUT. ' +
    'Writable: `comment`, plus `immutable: true` to freeze a version stored before freeze-on-create. ' +
    'Everything else — `queryString` and what is derived from it — is content and answers 409.',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:query:cities-by-population'] }, version: { type: 'string' } }, required: ['id','version'] },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      queryString: { type: 'string' },
      comment: { type: 'string', nullable: true },
      queryType: { type: 'string', nullable: true },
      defaultBackend: { type: 'string', format: 'iri', nullable: true },
      limitParameters: { type: 'array', nullable: true, items: { type: 'string', format: 'iri' } },
      offsetParameters: { type: 'array', nullable: true, items: { type: 'string', format: 'iri' } },
      inputTuples: { type: 'array', nullable: true, items: { type: 'string', format: 'iri' } },
      outputs: { type: 'array', nullable: true, items: { type: 'string', format: 'iri' } },
      immutable: { type: 'boolean', nullable: true }
    },
    minProperties: 1
  },
  response: {
    200: { type: 'object', additionalProperties: false, properties: {
      queryVersion: { $ref: 'queryversion#' },
      limitParameters: { type: 'array', items: { $ref: 'limitparameter#' } },
      offsetParameters: { type: 'array', items: { $ref: 'offsetparameter#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inferredOutputs: { type: 'array', items: { type: 'object' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } }
    }, required: ['queryVersion'] },
    400: { type: 'object', properties: { error: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    409: { type: 'object', properties: { error: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

// QueryGroup versions
const __createQueryGroupVersionBodySchema = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "immutable": {
      "type": "boolean",
      "nullable": true
    },
    "startNode": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "endNode": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "canvasData": {
      "type": "string",
      "nullable": true
    },
    "comment": {
      "type": "string",
      "nullable": true
    },
    "dateModified": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    }
  },
  "required": []
} as const;

export const listQueryGroupVersionsForGroupSchema = {
  tags: ['QueryGroup'],
  summary: 'List versions for a query group',
  params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  response: { 200: { type: 'array', items: { $ref: 'querygroupversion#' } }, 500: { type: 'object', properties: { error: { type: 'string' } } } }
} as const;

export const createQueryGroupVersionForGroupFlatSchema = {
  tags: ['QueryGroup'],
  summary: 'Create new group version',
  params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  body: {
    type: 'object', additionalProperties: false,
    properties: {
      queryGroupVersion: __createQueryGroupVersionBodySchema,
      startNode: { anyOf: [ {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "outputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "dateCreated": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            },
            "dateModified": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            }
      },
      "required": []
}, { type: 'null' } ] },
      endNode: { anyOf: [ {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "inputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "mediaType": {
                  "type": "string",
                  "nullable": true
            },
            "dateCreated": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            },
            "dateModified": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            }
      },
      "required": []
}, { type: 'null' } ] },
      executionNodes: { type: 'array', items: { anyOf: [ {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "queryId": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "backendId": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "backendConfig": {
                  "title": "EphemeralBackendConfig",
                  "type": "object",
                  "properties": {
                        "type": {
                              "type": "string",
                              "enum": [
                                    "ephemeral-oxigraph"
                              ]
                        },
                        "storeId": {
                              "type": "string",
                              "minLength": 1
                        }
                  },
                  "required": [
                        "type",
                        "storeId"
                  ],
                  "additionalProperties": false,
                  "nullable": true
            },
            "inputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "outputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "dateCreated": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            },
            "dateModified": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            },
            "nodeType": {
                  "type": "string",
                  "nullable": true
            }
      },
      "required": []
}, {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "queryId": {
                  "type": "string",
                  "format": "iri"
            },
            "backendId": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "inputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "outputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "backendConfig": {
                  "title": "EphemeralBackendConfig",
                  "type": "object",
                  "properties": {
                        "type": {
                              "type": "string",
                              "enum": [
                                    "ephemeral-oxigraph"
                              ]
                        },
                        "storeId": {
                              "type": "string",
                              "minLength": 1
                        }
                  },
                  "required": [
                        "type",
                        "storeId"
                  ],
                  "additionalProperties": false,
                  "nullable": true
            },
            "nodeType": {
                  "type": "string",
                  "nullable": true
            }
      },
      "required": [
            "queryId"
      ]
}, {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "ruleSetVersion": {
                  "type": "string",
                  "format": "iri"
            },
            "inputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "outputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "nodeType": {
                  "type": "string",
                  "nullable": true
            },
            "ruleSetVersionId": {
                  "type": "string",
                  "format": "iri"
            }
      },
      "anyOf": [
            {
                  "required": [
                        "ruleSetVersion"
                  ]
            },
            {
                  "required": [
                        "ruleSetVersionId"
                  ]
            }
      ]
}, {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "queryId": {
                  "type": "string",
                  "format": "iri"
            },
            "backendId": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "inputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "outputs": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            },
            "deletionsOutput": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "additionsOutput": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "backendConfig": {
                  "title": "EphemeralBackendConfig",
                  "type": "object",
                  "properties": {
                        "type": {
                              "type": "string",
                              "enum": [
                                    "ephemeral-oxigraph"
                              ]
                        },
                        "storeId": {
                              "type": "string",
                              "minLength": 1
                        }
                  },
                  "required": [
                        "type",
                        "storeId"
                  ],
                  "additionalProperties": false,
                  "nullable": true
            },
            "nodeType": {
                  "type": "string",
                  "nullable": true
            }
      },
      "required": [
            "queryId"
      ]
} ] } },
      edges: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "sourceNodeId": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "targetNodeId": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "sourceLocalId": {
                  "type": "string",
                  "nullable": true
            },
            "targetLocalId": {
                  "type": "string",
                  "nullable": true
            },
            "dataFlowType": {
                  "type": "string",
                  "nullable": true
            },
            "sourceOutputId": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "targetInputId": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "variableMappings": {
                  "type": "string",
                  "nullable": true
            },
            "whenEmpty": {
                  "type": "string",
                  "nullable": true
            }
      },
      "required": []
} },
      tupleMembers: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "position": {
                  "type": "integer"
            },
            "variable": {
                  "type": "string",
                  "format": "iri"
            }
      },
      "required": [
            "position",
            "variable"
      ]
} },
      inputTuples: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "name": {
                  "type": "string",
                  "nullable": true
            },
            "memberEntries": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  }
            },
            "position": {
                  "type": "integer",
                  "nullable": true
            },
            "variableMappings": {
                  "type": "string",
                  "nullable": true
            }
      },
      "required": [
            "memberEntries"
      ]
} },
      outputTuples: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "name": {
                  "type": "string",
                  "minLength": 1
            },
            "outputType": {
                  "type": "string",
                  "nullable": true
            },
            "memberEntries": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  }
            }
      },
      "required": [
            "name",
            "memberEntries"
      ]
} },
      inputs: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "variableName": {
                  "type": "string",
                  "minLength": 1
            },
            "allowedTypes": {
                  "type": "array",
                  "items": {
                        "type": "string",
                        "format": "iri"
                  },
                  "nullable": true
            }
      },
      "required": [
            "variableName"
      ]
} },
      outputs: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "variableName": {
                  "type": "string",
                  "minLength": 1
            },
            "description": {
                  "type": "string",
                  "nullable": true
            }
      },
      "required": [
            "variableName"
      ]
} },
      rdfOutputs: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "name": {
                  "type": "string",
                  "nullable": true
            },
            "description": {
                  "type": "string",
                  "nullable": true
            },
            "ioType": {
                  "type": "string",
                  "nullable": true
            },
            "outputType": {
                  "type": "string",
                  "nullable": true
            },
            "triplesOrQuads": {
                  "type": "string",
                  "nullable": true
            },
            "specifiedGraph": {
                  "type": "string",
                  "format": "iri",
                  "nullable": true
            },
            "position": {
                  "type": "integer",
                  "nullable": true
            },
            "dateCreated": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            },
            "dateModified": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            }
      },
      "required": []
} }
      ,booleanOutputs: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "name": {
                  "type": "string",
                  "nullable": true
            },
            "description": {
                  "type": "string",
                  "nullable": true
            },
            "ioType": {
                  "type": "string",
                  "nullable": true
            },
            "outputType": {
                  "type": "string",
                  "nullable": true
            },
            "dateCreated": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            },
            "dateModified": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            }
      },
      "required": []
} }
      ,queryIdInputs: { type: 'array', items: {
      "type": "object",
      "additionalProperties": false,
      "properties": {
            "id": {
                  "type": "string",
                  "pattern": "^urn:",
                  "nullable": true
            },
            "name": {
                  "type": "string",
                  "nullable": true
            },
            "description": {
                  "type": "string",
                  "nullable": true
            },
            "dateCreated": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            },
            "dateModified": {
                  "type": "string",
                  "format": "date-time",
                  "nullable": true
            }
      },
      "required": []
} }
    },
    required: ['queryGroupVersion'],
    examples: [
      {
        "queryGroupVersion": {
          "comment": "Version 1.0 of the city analysis workflow with parameterized queries"
        },
        "executionNodes": [
          {
            "id": "urn:ui-temp:node:population-query",
            "queryId": "urn:example:query:cities-by-population",
            "backendId": "urn:example:backend:dbpedia",
            "outputTuples": [
              "urn:ui-temp:output-tuple:city-results"
            ]
          }
        ],
        "edges": [],
        "tupleMembers": [
          {
            "id": "urn:ui-temp:tuple-member:city",
            "position": 0,
            "variable": "urn:ui-temp:output:city"
          },
          {
            "id": "urn:ui-temp:tuple-member:city-name",
            "position": 1,
            "variable": "urn:ui-temp:output:city-name"
          },
          {
            "id": "urn:ui-temp:tuple-member:population",
            "position": 2,
            "variable": "urn:ui-temp:output:population"
          }
        ],
        "inputTuples": [],
        "outputTuples": [
          {
            "id": "urn:ui-temp:output-tuple:city-results",
            "name": "City Results",
            "memberEntries": [
              "urn:ui-temp:tuple-member:city",
              "urn:ui-temp:tuple-member:city-name",
              "urn:ui-temp:tuple-member:population"
            ]
          }
        ],
        "inputs": [],
        "outputs": [
          {
            "id": "urn:ui-temp:output:city",
            "variableName": "city"
          },
          {
            "id": "urn:ui-temp:output:city-name",
            "variableName": "cityName"
          },
          {
            "id": "urn:ui-temp:output:population",
            "variableName": "population"
          }
        ],
        "rdfOutputs": []
      }
    ]
  },
  response: {
    201: { type: 'object', additionalProperties: false, properties: {
      queryGroupVersion: { $ref: 'querygroupversion#' },
      executionNodes: { type: 'array', items: { anyOf: [ { $ref: 'rulesetnode#' }, { $ref: 'patchnode#' }, { $ref: 'querynode#' }, { $ref: 'dynamicquerynode#' } ] } },
      startNode: { anyOf: [ { $ref: 'startnode#' }, { type: 'null' } ] },
      endNode: { anyOf: [ { $ref: 'endnode#' }, { type: 'null' } ] },
      edges: { type: 'array', items: { $ref: 'queryedge#' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      rdfOutputs: { type: 'array', items: { $ref: 'triplesquadsio#' } },
      booleanOutputs: { type: 'array', items: { $ref: 'booleanio#' } },
      queryIdInputs: { type: 'array', items: { $ref: 'queryidinput#' } },
      iriMap: { type: 'object', additionalProperties: { type: 'string' } }
    }, required: ['queryGroupVersion', 'iriMap'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    // The body is well-formed but names entities that do not exist, or that
    // exist with the wrong type. Every offending reference is listed, so one
    // round trip is enough to fix a hand-written payload.
    422: { type: 'object', properties: {
      error: { type: 'string' },
      references: { type: 'array', items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          field: { type: 'string' },
          reference: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['field', 'reference', 'reason']
      } }
    } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const getQueryGroupVersionForGroupSchema = {
  tags: ['QueryGroup'],
  summary: 'Get group version',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:querygroup:city-analysis'] }, version: { type: 'string' } }, required: ['id','version'] },
  response: {
    200: { type: 'object', additionalProperties: false, properties: {
      queryGroupVersion: { $ref: 'querygroupversion#' },
      executionNodes: { type: 'array', items: { anyOf: [ { $ref: 'rulesetnode#' }, { $ref: 'patchnode#' }, { $ref: 'querynode#' }, { $ref: 'dynamicquerynode#' } ] } },
      startNode: { anyOf: [ { $ref: 'startnode#' }, { type: 'null' } ] },
      endNode: { anyOf: [ { $ref: 'endnode#' }, { type: 'null' } ] },
      edges: { type: 'array', items: { $ref: 'queryedge#' } },
      queryNodes: { type: 'array', items: { $ref: 'querynode#' } },
      dynamicQueryNodes: { type: 'array', items: { $ref: 'dynamicquerynode#' } },
      startNodes: { type: 'array', items: { $ref: 'startnode#' } },
      endNodes: { type: 'array', items: { $ref: 'endnode#' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      rdfOutputs: { type: 'array', items: { $ref: 'triplesquadsio#' } },
      booleanOutputs: { type: 'array', items: { $ref: 'booleanio#' } },
      queryIdInputs: { type: 'array', items: { $ref: 'queryidinput#' } },
      queryVersions: { type: 'array', items: { $ref: 'queryversion#' } },
      // The LIMIT / OFFSET names this group accepts: the union of what its
      // member queries declare. Named here for the same reason the map below
      // is — `additionalProperties: false` drops anything the handler computes
      // and this does not list, so an unlisted field is a feature that silently
      // does nothing.
      limitParameters: { type: 'array', items: { type: 'string' } },
      offsetParameters: { type: 'array', items: { type: 'string' } },
      // Query version IRI -> the name of the query it belongs to. The route
      // computed this and `additionalProperties: false` dropped it on the way
      // out, so the canvas had no source for query names and fell back to the
      // literal label "Query Node" (issue #49).
      //
      // Not the same map the create route returns under this key: there it is
      // temp-urn -> minted IRI, so those values are URIs and these are display
      // names. Hence plain `type: 'string'` and no `format: 'uri'`.
      //
      // Not required, unlike on create: the handler falls back to the
      // un-enriched `detailed` payload if `expandGroupVersionDetailed` throws,
      // and that one carries no iriMap. Requiring it would turn that fallback
      // into a serialization failure.
      iriMap: { type: 'object', additionalProperties: { type: 'string' } }
    }, required: ['queryGroupVersion'] },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const patchQueryGroupVersionForGroupSchema = {
  tags: ['QueryGroup'],
  summary: 'Annotate a group version (comment only; content is immutable)',
  description:
    'A version is a snapshot: POST mints the next one, PATCH annotates an existing one, and there is no PUT. ' +
    'Writable: `comment`, plus `immutable: true` to freeze a version stored before freeze-on-create. ' +
    'Everything else — including `canvasData` — is content and answers 409.',
  params: { type: 'object', properties: { id: { type: 'string', examples: ['urn:example:querygroup:city-analysis'] }, version: { type: 'string' } }, required: ['id','version'] },
  body: {
    type: 'object',
    // PATCH accepts both the entity wrapper and the legacy flat/expanded form.
    // The route normalizes these representations before enforcing writable fields.
    additionalProperties: true,
    properties: {
      queryGroupVersion: {
        type: 'object',
        additionalProperties: true,
        properties: { immutable: { type: 'boolean', nullable: true } }
      }
    },
    minProperties: 1
  },
  response: {
    200: { type: 'object', additionalProperties: false, properties: {
      queryGroupVersion: { $ref: 'querygroupversion#' },
      executionNodes: { type: 'array', items: { anyOf: [ { $ref: 'rulesetnode#' }, { $ref: 'patchnode#' }, { $ref: 'querynode#' }, { $ref: 'dynamicquerynode#' } ] } },
      startNode: { anyOf: [ { $ref: 'startnode#' }, { type: 'null' } ] },
      endNode: { anyOf: [ { $ref: 'endnode#' }, { type: 'null' } ] },
      edges: { type: 'array', items: { $ref: 'queryedge#' } },
      queryNodes: { type: 'array', items: { $ref: 'querynode#' } },
      dynamicQueryNodes: { type: 'array', items: { $ref: 'dynamicquerynode#' } },
      startNodes: { type: 'array', items: { $ref: 'startnode#' } },
      endNodes: { type: 'array', items: { $ref: 'endnode#' } },
      tupleMembers: { type: 'array', items: { $ref: 'tuplemember#' } },
      inputTuples: { type: 'array', items: { $ref: 'queryinputtuple#' } },
      outputs: { type: 'array', items: { $ref: 'queryoutputvariable#' } },
      outputTuples: { type: 'array', items: { $ref: 'queryoutputtuple#' } },
      inputs: { type: 'array', items: { $ref: 'queryinputvariable#' } },
      rdfOutputs: { type: 'array', items: { $ref: 'triplesquadsio#' } },
      queryVersions: { type: 'array', items: { $ref: 'queryversion#' } }
    }, required: ['queryGroupVersion'] },
    400: { type: 'object', properties: { error: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } },
    404: { type: 'object', properties: { error: { type: 'string' } } },
    409: { type: 'object', properties: { error: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } },
    412: { type: 'object', additionalProperties: true, properties: { error: { type: 'string' }, expected: { type: 'string' } } },
    500: { type: 'object', properties: { error: { type: 'string' } } }
  }
} as const;

export const validateQueryGroupVersionSchema = {
  "tags": [
    "QueryGroup",
    "Validation"
  ],
  "summary": "Validate a query group version",
  "description": "Performs validation checks on the query group graph structure, including edge connectivity, I/O entity references, and node configuration.",
  "params": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "Query group IRI"
      },
      "version": {
        "type": "string",
        "description": "Version number"
      }
    },
    "required": [
      "id",
      "version"
    ],
    "additionalProperties": false
  },
  "response": {
    "200": {
      "type": "object",
      "properties": {
        "valid": {
          "type": "boolean",
          "description": "Whether the graph is valid (true if no errors)"
        },
        "errors": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Array of error messages (blocking issues)"
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Array of warning messages (non-blocking issues)"
        },
        "issues": {
          "type": "array",
          "description": "Detailed validation issues including structured metadata for each finding",
          "items": {
            "type": "object",
            "properties": {
              "level": {
                "type": "string",
                "enum": [
                  "error",
                  "warning"
                ]
              },
              "message": {
                "type": "string"
              },
              "entityType": {
                "type": "string",
                "nullable": true
              },
              "entityId": {
                "type": "string",
                "nullable": true
              },
              "code": {
                "type": "string",
                "nullable": true
              }
            },
            "required": [
              "level",
              "message"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "valid",
        "errors",
        "warnings"
      ],
      "additionalProperties": false
    },
    "404": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    },
    "500": {
      "type": "object",
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  }
} as const;

