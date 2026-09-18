/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */

// Entity Schemas
export const backendSchema = {
  "$id": "backend",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateModified": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "oxigraphConfig": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "id",
    "name",
    "backendType"
  ]
} as const;

export const librarySchema = {
  "$id": "library",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name"
  ]
} as const;

export const querySchema = {
  "$id": "query",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
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
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateModified": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const querygroupSchema = {
  "$id": "querygroup",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateModified": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const queryversionSchema = {
  "$id": "queryversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version",
    "queryString"
  ]
} as const;

export const argumentgraphbindingSchema = {
  "$id": "argumentgraphbinding",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "position": {
      "type": "integer",
      "nullable": true
    },
    "dataGraphVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "contentString": {
      "type": "string",
      "nullable": true
    },
    "contentFormat": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "id"
  ]
} as const;

export const argumentscalarbindingSchema = {
  "$id": "argumentscalarbinding",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "parameterKind": {
      "type": "string",
      "minLength": 1
    },
    "parameterName": {
      "type": "string",
      "minLength": 1
    },
    "numericValue": {
      "type": "integer"
    },
    "parameterIri": {
      "type": "string",
      "format": "iri",
      "nullable": true
    }
  },
  "required": [
    "id",
    "parameterKind",
    "parameterName",
    "numericValue"
  ]
} as const;

export const argumentsetSchema = {
  "$id": "argumentset",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "description": {
      "type": "string",
      "nullable": true
    },
    "argumentScope": {
      "type": "string",
      "nullable": true
    },
    "targetEntity": {
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
    "currentVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
      "nullable": true
    },
    "tupleBindings": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "scalarBindings": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "tupleSignature": {
      "type": "string",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const argumentsetversionSchema = {
  "$id": "argumentsetversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "isPartOf": {
      "type": "string",
      "format": "iri"
    },
    "version": {
      "type": "integer"
    },
    "tupleBindings": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "scalarBindings": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "graphBindings": {
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
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version"
  ]
} as const;

export const argumenttuplebindingSchema = {
  "$id": "argumenttuplebinding",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "position": {
      "type": "integer",
      "nullable": true
    },
    "tupleSignature": {
      "type": "string",
      "minLength": 1
    },
    "fallbackVariables": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "nullable": true
    },
    "contentString": {
      "type": "string",
      "minLength": 1
    },
    "tupleSetVersions": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "provenanceTupleId": {
      "type": "string",
      "format": "iri",
      "nullable": true
    }
  },
  "required": [
    "id",
    "tupleSignature",
    "contentString"
  ]
} as const;

export const benchmarkexperimentSchema = {
  "$id": "benchmarkexperiment",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    },
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name"
  ]
} as const;

export const benchmarkexperimentversionSchema = {
  "$id": "benchmarkexperimentversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version",
    "subjectSpecs"
  ]
} as const;

export const benchmarkiterationobservationSchema = {
  "$id": "benchmarkiterationobservation",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "dataSet": {
      "type": "string",
      "format": "iri"
    },
    "subjectObservation": {
      "type": "string",
      "format": "iri"
    },
    "runIndex": {
      "type": "integer"
    },
    "iterationIndex": {
      "type": "integer"
    },
    "stratum": {
      "type": "integer",
      "nullable": true
    },
    "durationMs": {
      "type": "number"
    },
    "resultCount": {
      "type": "integer"
    },
    "tripleCount": {
      "type": "integer"
    },
    "tupleCount": {
      "type": "integer",
      "nullable": true
    },
    "rulesEvaluated": {
      "type": "integer"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "readOnly": true
    }
  },
  "required": [
    "id",
    "dataSet",
    "subjectObservation",
    "runIndex",
    "iterationIndex",
    "durationMs",
    "resultCount",
    "tripleCount",
    "rulesEvaluated",
    "timestamp"
  ]
} as const;

export const benchmarkiterationrunSchema = {
  "$id": "benchmarkiterationrun",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "name": {
      "type": "string",
      "nullable": true
    },
    "description": {
      "type": "string",
      "nullable": true
    },
    "structure": {
      "type": "string",
      "format": "iri"
    },
    "definedBy": {
      "type": "string",
      "format": "iri"
    },
    "isPartOf": {
      "type": "string",
      "format": "iri"
    },
    "startedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "endedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "structure",
    "definedBy",
    "isPartOf"
  ]
} as const;

export const benchmarknodeobservationSchema = {
  "$id": "benchmarknodeobservation",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "dataSet": {
      "type": "string",
      "format": "iri"
    },
    "groupObservation": {
      "type": "string",
      "format": "iri"
    },
    "node": {
      "type": "string",
      "format": "iri"
    },
    "backend": {
      "type": "string",
      "format": "iri"
    },
    "runIndex": {
      "type": "integer"
    },
    "nodeIndex": {
      "type": "integer",
      "nullable": true
    },
    "durationMs": {
      "type": "number"
    },
    "resultCount": {
      "type": "integer"
    },
    "success": {
      "type": "boolean"
    },
    "errorMessage": {
      "type": "string",
      "nullable": true
    },
    "errorType": {
      "type": "string",
      "nullable": true
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "readOnly": true
    }
  },
  "required": [
    "id",
    "dataSet",
    "groupObservation",
    "node",
    "backend",
    "runIndex",
    "durationMs",
    "resultCount",
    "success",
    "timestamp"
  ]
} as const;

export const benchmarknoderunSchema = {
  "$id": "benchmarknoderun",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "name": {
      "type": "string",
      "nullable": true
    },
    "description": {
      "type": "string",
      "nullable": true
    },
    "structure": {
      "type": "string",
      "format": "iri"
    },
    "definedBy": {
      "type": "string",
      "format": "iri"
    },
    "isPartOf": {
      "type": "string",
      "format": "iri"
    },
    "startedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "endedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "structure",
    "definedBy",
    "isPartOf"
  ]
} as const;

export const benchmarkobservationSchema = {
  "$id": "benchmarkobservation",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "dataSet": {
      "type": "string",
      "format": "iri"
    },
    "subject": {
      "type": "string",
      "format": "iri"
    },
    "backend": {
      "type": "string",
      "format": "iri"
    },
    "argumentSet": {
      "type": "string",
      "format": "iri"
    },
    "argumentSetVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "dataGraph": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "dataGraphVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "runIndex": {
      "type": "integer"
    },
    "durationMs": {
      "type": "number"
    },
    "resultCount": {
      "type": "integer"
    },
    "success": {
      "type": "boolean"
    },
    "errorMessage": {
      "type": "string",
      "nullable": true
    },
    "errorType": {
      "type": "string",
      "nullable": true
    },
    "backendDurationMs": {
      "type": "number",
      "nullable": true
    },
    "queueDelayMs": {
      "type": "number",
      "nullable": true
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "readOnly": true
    }
  },
  "required": [
    "id",
    "dataSet",
    "subject",
    "backend",
    "argumentSet",
    "runIndex",
    "durationMs",
    "resultCount",
    "success",
    "timestamp"
  ]
} as const;

export const benchmarkrunSchema = {
  "$id": "benchmarkrun",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "name": {
      "type": "string",
      "nullable": true
    },
    "description": {
      "type": "string",
      "nullable": true
    },
    "structure": {
      "type": "string",
      "format": "iri"
    },
    "definedBy": {
      "type": "string",
      "format": "iri"
    },
    "runStatus": {
      "type": "string",
      "minLength": 1
    },
    "tasksTotal": {
      "type": "integer"
    },
    "tasksCompleted": {
      "type": "integer"
    },
    "keywords": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "nullable": true
    },
    "startedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "endedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "structure",
    "definedBy",
    "runStatus",
    "tasksTotal",
    "tasksCompleted"
  ]
} as const;

export const booleanioSchema = {
  "$id": "booleanio",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
      "readOnly": true,
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
    "id"
  ]
} as const;

export const datablockSchema = {
  "$id": "datablock",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
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
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const datablockversionSchema = {
  "$id": "datablockversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "dataString": {
      "type": "string",
      "minLength": 1
    },
    "comment": {
      "type": "string",
      "nullable": true
    },
    "normalizedInsertData": {
      "type": "string",
      "nullable": true
    },
    "grammarValid": {
      "type": "boolean",
      "nullable": true
    },
    "validationError": {
      "type": "string",
      "nullable": true
    },
    "grammarType": {
      "type": "string",
      "nullable": true
    },
    "grammarValidations": {
      "type": "string",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version",
    "dataString"
  ]
} as const;

export const datagraphSchema = {
  "$id": "datagraph",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
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
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const datagraphversionSchema = {
  "$id": "datagraphversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "contentString": {
      "type": "string",
      "minLength": 1
    },
    "contentFormat": {
      "type": "string",
      "minLength": 1
    },
    "tripleCount": {
      "type": "integer",
      "nullable": true
    },
    "byteSize": {
      "type": "integer",
      "nullable": true
    },
    "grammarValid": {
      "type": "boolean",
      "nullable": true
    },
    "validationError": {
      "type": "string",
      "nullable": true
    },
    "sourceQueryVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "sourceArgumentSetVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "sourceBackend": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "sourceExecutedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "sourceResultHash": {
      "type": "string",
      "nullable": true
    },
    "comment": {
      "type": "string",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version",
    "contentString",
    "contentFormat"
  ]
} as const;

export const duckdbetlnodeSchema = {
  "$id": "duckdbetlnode",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "etlJobVersionId": {
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
    }
  },
  "required": [
    "id",
    "etlJobVersionId"
  ]
} as const;

export const dynamicquerynodeSchema = {
  "$id": "dynamicquerynode",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
      "readOnly": true,
      "nullable": true
    },
    "dateModified": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "nodeType": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "id"
  ]
} as const;

export const endnodeSchema = {
  "$id": "endnode",
  "type": "object",
  "properties": {
    "id": {
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
    "mediaType": {
      "type": "string",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id"
  ]
} as const;

export const etlcolumnmappingSchema = {
  "$id": "etlcolumnmapping",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
      "nullable": true
    },
    "etlJobVersion": {
      "type": "string",
      "format": "iri"
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "etlJobVersion"
  ]
} as const;

export const etlcolumnmappingversionSchema = {
  "$id": "etlcolumnmappingversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "columns": {
      "type": "string",
      "minLength": 1
    },
    "comment": {
      "type": "string",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version",
    "columns"
  ]
} as const;

export const etlexecutionSchema = {
  "$id": "etlexecution",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "etlJobVersion": {
      "type": "string",
      "format": "iri"
    },
    "columnMappingVersion": {
      "type": "string",
      "format": "iri"
    },
    "status": {
      "type": "string",
      "minLength": 1
    },
    "startedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true
    },
    "completedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "totalChunks": {
      "type": "integer",
      "nullable": true
    },
    "completedChunks": {
      "type": "integer",
      "nullable": true
    },
    "totalRows": {
      "type": "integer",
      "nullable": true
    },
    "errorMessage": {
      "type": "string",
      "nullable": true
    },
    "errorChunk": {
      "type": "integer",
      "nullable": true
    },
    "outputFormat": {
      "type": "string",
      "nullable": true
    },
    "outputLocation": {
      "type": "string",
      "nullable": true
    },
    "outputTupleSetVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "outputReused": {
      "type": "boolean",
      "nullable": true
    },
    "executionConfig": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "id",
    "etlJobVersion",
    "columnMappingVersion",
    "status",
    "startedAt"
  ]
} as const;

export const etljobSchema = {
  "$id": "etljob",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
      "nullable": true
    },
    "isPartOf": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      }
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateModified": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const etljobversionSchema = {
  "$id": "etljobversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version",
    "sql",
    "sparqlTemplate",
    "backendId"
  ]
} as const;

export const limitparameterSchema = {
  "$id": "limitparameter",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "id",
    "name"
  ]
} as const;

export const offsetparameterSchema = {
  "$id": "offsetparameter",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "id",
    "name"
  ]
} as const;

export const patchnodeSchema = {
  "$id": "patchnode",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "id",
    "queryId"
  ]
} as const;

export const patchSchema = {
  "$id": "patch",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "isPartOf": {
      "type": "string",
      "format": "iri"
    },
    "additions": {
      "type": "string",
      "nullable": true
    },
    "deletions": {
      "type": "string",
      "nullable": true
    },
    "additionCount": {
      "type": "integer"
    },
    "deletionCount": {
      "type": "integer"
    },
    "rawInsertCount": {
      "type": "integer",
      "nullable": true
    },
    "rawDeleteCount": {
      "type": "integer",
      "nullable": true
    },
    "graphScope": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "graphOps": {
      "type": "string",
      "nullable": true
    },
    "patchStatus": {
      "type": "string",
      "minLength": 1
    },
    "applyMode": {
      "type": "string",
      "minLength": 1
    },
    "revertible": {
      "type": "boolean"
    },
    "containsBnodes": {
      "type": "boolean",
      "nullable": true
    },
    "netEffectExact": {
      "type": "boolean",
      "nullable": true
    },
    "contentHash": {
      "type": "string",
      "minLength": 1
    },
    "sourceKind": {
      "type": "string",
      "minLength": 1
    },
    "sourceRef": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "updateString": {
      "type": "string",
      "nullable": true
    },
    "inverseOf": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "origin": {
      "type": "string",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateModified": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateApplied": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    }
  },
  "required": [
    "id",
    "isPartOf",
    "additionCount",
    "deletionCount",
    "patchStatus",
    "applyMode",
    "revertible",
    "contentHash",
    "sourceKind"
  ]
} as const;

export const queryedgeSchema = {
  "$id": "queryedge",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
  "required": [
    "id"
  ]
} as const;

export const querygroupversionSchema = {
  "$id": "querygroupversion",
  "type": "object",
  "properties": {
    "id": {
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
    "executionNodes": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
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
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "dateModified": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "isPartOf": {
      "type": "string",
      "format": "iri"
    }
  },
  "required": [
    "id",
    "version",
    "isPartOf"
  ]
} as const;

export const queryidinputSchema = {
  "$id": "queryidinput",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "name": {
      "type": "string",
      "nullable": true
    },
    "description": {
      "type": "string",
      "nullable": true
    },
    "isPartOf": {
      "type": "string",
      "format": "iri"
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf"
  ]
} as const;

export const queryinputtupleSchema = {
  "$id": "queryinputtuple",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "id",
    "memberEntries"
  ]
} as const;

export const queryinputvariableSchema = {
  "$id": "queryinputvariable",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "id",
    "variableName"
  ]
} as const;

export const querynodeSchema = {
  "$id": "querynode",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "id",
    "queryId"
  ]
} as const;

export const queryoutputtupleSchema = {
  "$id": "queryoutputtuple",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "id",
    "name",
    "memberEntries"
  ]
} as const;

export const queryoutputvariableSchema = {
  "$id": "queryoutputvariable",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "id",
    "variableName"
  ]
} as const;

export const ruleSchema = {
  "$id": "rule",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
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
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const rulesetnodeSchema = {
  "$id": "rulesetnode",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    }
  },
  "required": [
    "id",
    "ruleSetVersion"
  ]
} as const;

export const rulesetSchema = {
  "$id": "ruleset",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
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
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const rulesetversionSchema = {
  "$id": "rulesetversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "comment": {
      "type": "string",
      "nullable": true
    },
    "hasRule": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "hasDataBlock": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "stratificationReport": {
      "type": "string",
      "nullable": true
    },
    "tupleSeeds": {
      "type": "string",
      "nullable": true
    },
    "tuplesEnabled": {
      "type": "boolean",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version"
  ]
} as const;

export const ruleversionSchema = {
  "$id": "ruleversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "ruleString": {
      "type": "string",
      "minLength": 1
    },
    "comment": {
      "type": "string",
      "nullable": true
    },
    "normalizedInsert": {
      "type": "string",
      "nullable": true
    },
    "grammarType": {
      "type": "string",
      "nullable": true
    },
    "grammarValid": {
      "type": "boolean",
      "nullable": true
    },
    "validationError": {
      "type": "string",
      "nullable": true
    },
    "grammarValidations": {
      "type": "string",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version",
    "ruleString"
  ]
} as const;

export const startnodeSchema = {
  "$id": "startnode",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
      "readOnly": true,
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
    "id"
  ]
} as const;

export const tagSchema = {
  "$id": "tag",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const testcasedatagraphSchema = {
  "$id": "testcasedatagraph",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "isPartOf": {
      "type": "string",
      "format": "iri"
    },
    "position": {
      "type": "integer"
    },
    "dataGraphVersion": {
      "type": "string",
      "format": "iri"
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "position",
    "dataGraphVersion"
  ]
} as const;

export const testcaseSchema = {
  "$id": "testcase",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "isPartOf": {
      "type": "string",
      "format": "iri"
    },
    "position": {
      "type": "integer"
    },
    "name": {
      "type": "string",
      "nullable": true
    },
    "argumentSetVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "dataGraphVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "dataGraphs": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "tupleSeeds": {
      "type": "string",
      "nullable": true
    },
    "sqlFixture": {
      "type": "string",
      "nullable": true
    },
    "expected": {
      "type": "string",
      "nullable": true
    },
    "expectedFormat": {
      "type": "string",
      "nullable": true
    },
    "ordered": {
      "type": "boolean",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "position"
  ]
} as const;

export const testruncaseSchema = {
  "$id": "testruncase",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "isPartOf": {
      "type": "string",
      "format": "iri"
    },
    "testCase": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "name": {
      "type": "string",
      "nullable": true
    },
    "position": {
      "type": "integer",
      "nullable": true
    },
    "outcome": {
      "type": "string",
      "minLength": 1
    },
    "message": {
      "type": "string",
      "nullable": true
    },
    "detail": {
      "type": "string",
      "nullable": true
    },
    "durationMs": {
      "type": "number",
      "nullable": true
    },
    "argumentSetVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "dataGraphVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "dataGraphVersions": {
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
      "readOnly": true,
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
    "id",
    "isPartOf",
    "outcome"
  ]
} as const;

export const testrunSchema = {
  "$id": "testrun",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
    },
    "test": {
      "type": "string",
      "format": "iri"
    },
    "testVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "subject": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "subjectVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "backend": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "suite": {
      "type": "string",
      "nullable": true
    },
    "outcome": {
      "type": "string",
      "minLength": 1
    },
    "expectationKind": {
      "type": "string",
      "minLength": 1
    },
    "hermetic": {
      "type": "boolean",
      "nullable": true
    },
    "message": {
      "type": "string",
      "nullable": true
    },
    "durationMs": {
      "type": "number",
      "nullable": true
    },
    "passedCount": {
      "type": "integer",
      "nullable": true
    },
    "failedCount": {
      "type": "integer",
      "nullable": true
    },
    "ranAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "test",
    "outcome",
    "expectationKind",
    "ranAt"
  ]
} as const;

export const testSchema = {
  "$id": "test",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
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
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "subject",
    "subjectKind",
    "isPartOf"
  ]
} as const;

export const testversionSchema = {
  "$id": "testversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "subjectVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "cases": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "iri"
      },
      "nullable": true
    },
    "backend": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "expectationKind": {
      "type": "string",
      "minLength": 1
    },
    "maxIterations": {
      "type": "integer",
      "nullable": true
    },
    "timeoutMs": {
      "type": "integer",
      "nullable": true
    },
    "comment": {
      "type": "string",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version",
    "expectationKind"
  ]
} as const;

export const triplesquadsioSchema = {
  "$id": "triplesquadsio",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
      "readOnly": true,
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
    "id"
  ]
} as const;

export const tuplememberSchema = {
  "$id": "tuplemember",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "id",
    "position",
    "variable"
  ]
} as const;

export const tuplesetSchema = {
  "$id": "tupleset",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "currentVersionNumber": {
      "type": "integer",
      "readOnly": true,
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
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "name",
    "isPartOf"
  ]
} as const;

export const tuplesetversionSchema = {
  "$id": "tuplesetversion",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "iri"
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
    "contentString": {
      "type": "string",
      "minLength": 1
    },
    "sourceFormat": {
      "type": "string",
      "nullable": true
    },
    "tupleColumns": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "nullable": true
    },
    "rowCount": {
      "type": "integer",
      "nullable": true
    },
    "byteSize": {
      "type": "integer",
      "nullable": true
    },
    "sourceEtlJobVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "sourceColumnMappingVersion": {
      "type": "string",
      "format": "iri",
      "nullable": true
    },
    "sourceExecutedAt": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
      "nullable": true
    },
    "sourceResultHash": {
      "type": "string",
      "nullable": true
    },
    "comment": {
      "type": "string",
      "nullable": true
    },
    "dateCreated": {
      "type": "string",
      "format": "date-time",
      "readOnly": true,
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
    "id",
    "isPartOf",
    "version",
    "contentString"
  ]
} as const;

// TypeScript Interfaces
export interface BackendRestApi {
  id: string;
  name: string;
  description?: string | null;
  backendType: string;
  endpoint?: string | null;
  authEnvKey?: string | null;
  queryMethod?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  oxigraphConfig?: string | null;
}

export interface LibraryRestApi {
  id: string;
  name: string;
  description?: string | null;
  defaultBackend?: string | null;
  allowedBackends?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface QueryRestApi {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  defaultBackend?: string | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  argumentSets?: string[] | null;
}

export interface QueryGroupRestApi {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  isPartOf: string;
  tags?: string[] | null;
  argumentSets?: string[] | null;
}

export interface QueryVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  queryString: string;
  comment?: string | null;
  queryType?: string | null;
  srlImportable?: boolean | null;
  srlImportRevision?: number | null;
  limitParameters?: string[] | null;
  offsetParameters?: string[] | null;
  inferredInputs?: string[] | null;
  inferredOutputs?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface ArgumentGraphBindingRestApi {
  id: string;
  position?: number | null;
  dataGraphVersion?: string | null;
  contentString?: string | null;
  contentFormat?: string | null;
}

export interface ArgumentScalarBindingRestApi {
  id: string;
  parameterKind: string;
  parameterName: string;
  numericValue: number;
  parameterIri?: string | null;
}

export interface ArgumentSetRestApi {
  id: string;
  name: string;
  description?: string | null;
  argumentScope?: string | null;
  targetEntity?: string | null;
  isPartOf: string;
  tags?: string[] | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  tupleBindings?: string[] | null;
  scalarBindings?: string[] | null;
  tupleSignature?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface ArgumentSetVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  tupleBindings?: string[] | null;
  scalarBindings?: string[] | null;
  graphBindings?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface ArgumentTupleBindingRestApi {
  id: string;
  position?: number | null;
  tupleSignature: string;
  fallbackVariables?: string[] | null;
  contentString: string;
  tupleSetVersions?: string[] | null;
  provenanceTupleId?: string | null;
}

export interface BenchmarkExperimentRestApi {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface BenchmarkExperimentVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  subjectSpecs: string[];
  repeats?: number | null;
  executionStrategy?: string | null;
  timeWindow?: string | null;
  maxConcurrency?: number | null;
  warmupRuns?: number | null;
  cooldownMs?: number | null;
  timeoutMs?: number | null;
  retryCount?: number | null;
  retryDelayMs?: number | null;
  randomizeOrder?: boolean | null;
  abortOnError?: boolean | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface BenchmarkIterationObservationRestApi {
  id: string;
  dataSet: string;
  subjectObservation: string;
  runIndex: number;
  iterationIndex: number;
  stratum?: number | null;
  durationMs: string;
  resultCount: number;
  tripleCount: number;
  tupleCount?: number | null;
  rulesEvaluated: number;
  timestamp: string;
}

export interface BenchmarkIterationRunRestApi {
  id: string;
  name?: string | null;
  description?: string | null;
  structure: string;
  definedBy: string;
  isPartOf: string;
  startedAt?: string | null;
  endedAt?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface BenchmarkNodeObservationRestApi {
  id: string;
  dataSet: string;
  groupObservation: string;
  node: string;
  backend: string;
  runIndex: number;
  nodeIndex?: number | null;
  durationMs: string;
  resultCount: number;
  success: boolean;
  errorMessage?: string | null;
  errorType?: string | null;
  timestamp: string;
}

export interface BenchmarkNodeRunRestApi {
  id: string;
  name?: string | null;
  description?: string | null;
  structure: string;
  definedBy: string;
  isPartOf: string;
  startedAt?: string | null;
  endedAt?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface BenchmarkObservationRestApi {
  id: string;
  dataSet: string;
  subject: string;
  backend: string;
  argumentSet: string;
  argumentSetVersion?: string | null;
  dataGraph?: string | null;
  dataGraphVersion?: string | null;
  runIndex: number;
  durationMs: string;
  resultCount: number;
  success: boolean;
  errorMessage?: string | null;
  errorType?: string | null;
  backendDurationMs?: string | null;
  queueDelayMs?: string | null;
  timestamp: string;
}

export interface BenchmarkRunRestApi {
  id: string;
  name?: string | null;
  description?: string | null;
  structure: string;
  definedBy: string;
  runStatus: string;
  tasksTotal: number;
  tasksCompleted: number;
  keywords?: string[] | null;
  startedAt?: string | null;
  endedAt?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface BooleanIORestApi {
  id: string;
  name?: string | null;
  description?: string | null;
  ioType?: string | null;
  outputType?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface DataBlockRestApi {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface DataBlockVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  dataString: string;
  comment?: string | null;
  normalizedInsertData?: string | null;
  grammarValid?: boolean | null;
  validationError?: string | null;
  grammarType?: string | null;
  grammarValidations?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface DataGraphRestApi {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  isPartOf: string[];
  mintedFrom?: string | null;
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface DataGraphVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  contentString: string;
  contentFormat: string;
  tripleCount?: number | null;
  byteSize?: number | null;
  grammarValid?: boolean | null;
  validationError?: string | null;
  sourceQueryVersion?: string | null;
  sourceArgumentSetVersion?: string | null;
  sourceBackend?: string | null;
  sourceExecutedAt?: string | null;
  sourceResultHash?: string | null;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface DuckDbEtlNodeRestApi {
  id: string;
  etlJobVersionId: string;
  inputs?: string[] | null;
  outputs?: string[] | null;
  nodeType?: string | null;
}

export interface DynamicQueryNodeRestApi {
  id: string;
  queryId?: string | null;
  backendId?: string | null;
  backendConfig?: string | null;
  inputs?: string[] | null;
  outputs?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  nodeType?: string | null;
}

export interface EndNodeRestApi {
  id: string;
  inputs?: string[] | null;
  mediaType?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface EtlColumnMappingRestApi {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  etlJobVersion: string;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface EtlColumnMappingVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  columns: string;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface EtlExecutionRestApi {
  id: string;
  etlJobVersion: string;
  columnMappingVersion: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  totalChunks?: number | null;
  completedChunks?: number | null;
  totalRows?: number | null;
  errorMessage?: string | null;
  errorChunk?: number | null;
  outputFormat?: string | null;
  outputLocation?: string | null;
  outputTupleSetVersion?: string | null;
  outputReused?: boolean | null;
  executionConfig?: string | null;
}

export interface EtlJobRestApi {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  isPartOf: string[];
  dateCreated?: string | null;
  dateModified?: string | null;
  argumentSets?: string[] | null;
}

export interface EtlJobVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  sql: string;
  sparqlTemplate: string;
  backendId: string;
  currentColumnMappingVersion?: string | null;
  chunkSize?: number | null;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface LimitParameterRestApi {
  id: string;
  name: string;
  value?: number | null;
  defaultValue?: number | null;
}

export interface OffsetParameterRestApi {
  id: string;
  name: string;
  value?: number | null;
  defaultValue?: number | null;
}

export interface PatchNodeRestApi {
  id: string;
  queryId: string;
  backendId?: string | null;
  inputs?: string[] | null;
  outputs?: string[] | null;
  deletionsOutput?: string | null;
  additionsOutput?: string | null;
  backendConfig?: string | null;
  nodeType?: string | null;
}

export interface PatchRestApi {
  id: string;
  isPartOf: string;
  additions?: string | null;
  deletions?: string | null;
  additionCount: number;
  deletionCount: number;
  rawInsertCount?: number | null;
  rawDeleteCount?: number | null;
  graphScope?: string[] | null;
  graphOps?: string | null;
  patchStatus: string;
  applyMode: string;
  revertible: boolean;
  containsBnodes?: boolean | null;
  netEffectExact?: boolean | null;
  contentHash: string;
  sourceKind: string;
  sourceRef?: string | null;
  updateString?: string | null;
  inverseOf?: string | null;
  origin?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  dateApplied?: string | null;
}

export interface QueryEdgeRestApi {
  id: string;
  sourceNodeId?: string | null;
  targetNodeId?: string | null;
  sourceLocalId?: string | null;
  targetLocalId?: string | null;
  dataFlowType?: string | null;
  sourceOutputId?: string | null;
  targetInputId?: string | null;
  variableMappings?: string | null;
  whenEmpty?: string | null;
}

export interface QueryGroupVersionRestApi {
  id: string;
  version: number;
  immutable?: boolean | null;
  startNode?: string | null;
  endNode?: string | null;
  executionNodes?: string[] | null;
  edges?: string[] | null;
  canvasData?: string | null;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  isPartOf: string;
}

export interface QueryIdInputRestApi {
  id: string;
  name?: string | null;
  description?: string | null;
  isPartOf: string;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface QueryInputTupleRestApi {
  id: string;
  name?: string | null;
  memberEntries: string[];
  position?: number | null;
  variableMappings?: string | null;
}

export interface QueryInputVariableRestApi {
  id: string;
  variableName: string;
  allowedTypes?: string[] | null;
}

export interface QueryNodeRestApi {
  id: string;
  queryId: string;
  backendId?: string | null;
  inputs?: string[] | null;
  outputs?: string[] | null;
  backendConfig?: string | null;
  nodeType?: string | null;
}

export interface QueryOutputTupleRestApi {
  id: string;
  name: string;
  outputType?: string | null;
  memberEntries: string[];
}

export interface QueryOutputVariableRestApi {
  id: string;
  variableName: string;
  description?: string | null;
}

export interface RuleRestApi {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface RuleSetNodeRestApi {
  id: string;
  ruleSetVersion: string;
  inputs?: string[] | null;
  outputs?: string[] | null;
  nodeType?: string | null;
}

export interface RuleSetRestApi {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface RuleSetVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  comment?: string | null;
  hasRule?: string[] | null;
  hasDataBlock?: string[] | null;
  stratificationReport?: string | null;
  tupleSeeds?: string | null;
  tuplesEnabled?: boolean | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface RuleVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  ruleString: string;
  comment?: string | null;
  normalizedInsert?: string | null;
  grammarType?: string | null;
  grammarValid?: boolean | null;
  validationError?: string | null;
  grammarValidations?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface StartNodeRestApi {
  id: string;
  outputs?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TagRestApi {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  isPartOf: string;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TestCaseDataGraphRestApi {
  id: string;
  isPartOf: string;
  position: number;
  dataGraphVersion: string;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TestCaseRestApi {
  id: string;
  isPartOf: string;
  position: number;
  name?: string | null;
  argumentSetVersion?: string | null;
  dataGraphVersion?: string | null;
  dataGraphs?: string[] | null;
  tupleSeeds?: string | null;
  sqlFixture?: string | null;
  expected?: string | null;
  expectedFormat?: string | null;
  ordered?: boolean | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TestRunCaseRestApi {
  id: string;
  isPartOf: string;
  testCase?: string | null;
  name?: string | null;
  position?: number | null;
  outcome: string;
  message?: string | null;
  detail?: string | null;
  durationMs?: string | null;
  argumentSetVersion?: string | null;
  dataGraphVersion?: string | null;
  dataGraphVersions?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TestRunRestApi {
  id: string;
  test: string;
  testVersion?: string | null;
  subject?: string | null;
  subjectVersion?: string | null;
  backend?: string | null;
  suite?: string | null;
  outcome: string;
  expectationKind: string;
  hermetic?: boolean | null;
  message?: string | null;
  durationMs?: string | null;
  passedCount?: number | null;
  failedCount?: number | null;
  ranAt: string;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TestRestApi {
  id: string;
  name: string;
  description?: string | null;
  subject: string;
  criterion?: string | null;
  subjectKind: string;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TestVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  subjectVersion?: string | null;
  cases?: string[] | null;
  backend?: string | null;
  expectationKind: string;
  maxIterations?: number | null;
  timeoutMs?: number | null;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TriplesQuadsIORestApi {
  id: string;
  name?: string | null;
  description?: string | null;
  ioType?: string | null;
  outputType?: string | null;
  triplesOrQuads?: string | null;
  specifiedGraph?: string | null;
  position?: number | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TupleMemberRestApi {
  id: string;
  position: number;
  variable: string;
}

export interface TupleSetRestApi {
  id: string;
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  currentVersionNumber?: number | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}

export interface TupleSetVersionRestApi {
  id: string;
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  contentString: string;
  sourceFormat?: string | null;
  tupleColumns?: string[] | null;
  rowCount?: number | null;
  byteSize?: number | null;
  sourceEtlJobVersion?: string | null;
  sourceColumnMappingVersion?: string | null;
  sourceExecutedAt?: string | null;
  sourceResultHash?: string | null;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
