/**
 * Route and response JSON Schemas owned by the API.
 *
 * Provenance: snapshotted verbatim from `packages/contracts`' generated
 * `produceJsonSchema()` output during Phase C1 (issue #65), then edited
 * deliberately where that round-trip had *lost* a constraint the zod source
 * carried. Snapshotted rather than retyped so the starting point is provably
 * byte-identical to what shipped, with every subsequent change visible as a diff.
 *
 * These are literal `as const` so `FromSchema` can infer request types
 * (route-helpers.ts) — which the round-tripped versions could never be, because
 * they were function return values with no literal type.
 *
 * Phase B/C folds these back into generation from the entity model. Until then
 * they are hand-owned: edit them here.
 *
 * **Backend and RuleSet are gone from this file (Phase B2).** Both now register
 * the documents `routes.generated.ts` emits from the entity model, so the
 * duplicate `backend` `$id` no longer exists and neither does the risk that
 * whichever fastify saw first decided what every `$ref: 'backend#'` meant. What
 * is left is the benchmark family (whose entity-model counterparts are *not*
 * equivalent — see `routes.ts`), the three request bodies with no entity behind
 * them at all (detection, execution, playground), and the response documents.
 */

export const benchmarkRouteSchemas = {
  "list": {
    "tags": [
      "Benchmark"
    ],
    "summary": "List benchmark experiments",
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
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "get": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Get benchmark experiment",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
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
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "create": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Create benchmark experiment",
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1
        },
        "description": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "status": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "id": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false,
      "$id": "benchmarkexperiment.create"
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
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "422": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "update": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Update benchmark experiment",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1
        },
        "description": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "status": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "currentVersion": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false,
      "$id": "benchmarkexperiment.update",
      "minProperties": 1
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
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "412": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "delete": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Delete benchmark experiment",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "response": {
      "204": {
        "type": "null"
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "listVersions": {
    "tags": [
      "Benchmark"
    ],
    "summary": "List benchmark experiment versions",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "response": {
      "200": {
        "type": "array",
        "items": {
          "$ref": "benchmarkexperimentversion#"
        }
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "createVersion": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Create benchmark experiment version",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "subjectSpecs": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "subject": {
                "type": "string",
                "minLength": 1
              },
              "inputs": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "backends": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1
                }
              }
            },
            "required": [
              "subject"
            ],
            "additionalProperties": false
          }
        },
        "repeats": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "executionStrategy": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "timeWindow": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "maxConcurrency": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "warmupRuns": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "cooldownMs": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "timeoutMs": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "retryCount": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "retryDelayMs": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "randomizeOrder": {
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "abortOnError": {
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "subjectSpecs"
      ],
      "additionalProperties": false,
      "$id": "benchmarkexperimentversion.create"
    },
    "response": {
      "201": {
        "$ref": "benchmarkexperimentversion#"
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "getVersion": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Get benchmark experiment version",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "version": {
          "type": "string"
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
        "$ref": "benchmarkexperimentversion#"
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "updateVersion": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Update benchmark experiment version",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "version": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "version"
      ],
      "additionalProperties": false
    },
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "subjectSpecs": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "subject": {
                "type": "string",
                "minLength": 1
              },
              "inputs": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "backends": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1
                }
              }
            },
            "required": [
              "subject"
            ],
            "additionalProperties": false
          }
        },
        "repeats": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "executionStrategy": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "timeWindow": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "maxConcurrency": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "warmupRuns": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "cooldownMs": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "timeoutMs": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "retryCount": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "retryDelayMs": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "randomizeOrder": {
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "abortOnError": {
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false,
      "$id": "benchmarkexperimentversion.update",
      "minProperties": 1
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
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "409": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "412": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "freezeVersion": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Freeze benchmark experiment version",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "version": {
          "type": "string"
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
        "$ref": "benchmarkexperimentversion#"
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "409": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "runVersion": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Execute benchmark experiment version",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "version": {
          "type": "string"
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
        "$ref": "benchmark.run.response#"
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "409": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "listRuns": {
    "tags": [
      "Benchmark"
    ],
    "summary": "List benchmark runs for an experiment version",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "version": {
          "type": "string"
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
        "type": "array",
        "items": {
          "$ref": "benchmarkrun#"
        }
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "getRun": {
    "tags": [
      "Benchmark"
    ],
    "summary": "Get benchmark run",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "response": {
      "200": {
        "$ref": "benchmarkrun#"
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "listRunObservations": {
    "tags": [
      "Benchmark"
    ],
    "summary": "List benchmark observations for a run",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "response": {
      "200": {
        "type": "array",
        "items": {
          "$ref": "benchmarkobservation#"
        }
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "listRunNodeObservations": {
    "tags": [
      "Benchmark"
    ],
    "summary": "List benchmark node observations for a run",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "response": {
      "200": {
        "type": "array",
        "items": {
          "$ref": "benchmarknodeobservation#"
        }
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "listRunIterationObservations": {
    "tags": [
      "Benchmark"
    ],
    "summary": "List benchmark iteration observations for a run",
    "params": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "response": {
      "200": {
        "type": "array",
        "items": {
          "$ref": "benchmarkiterationobservation#"
        }
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  }
} as const;






export const benchmarkRunResponseJsonSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "run": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "runStatus": {
          "type": "string"
        },
        "tasksTotal": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "tasksCompleted": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "id",
        "runStatus",
        "tasksTotal",
        "tasksCompleted"
      ],
      "additionalProperties": {}
    },
    "nodeRun": {
      "anyOf": [
        {
          "type": "object",
          "additionalProperties": {}
        },
        {
          "type": "null"
        }
      ]
    },
    "observations": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": {}
      }
    },
    "nodeObservations": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": {}
      }
    },
    "iterationRun": {
      "anyOf": [
        {
          "type": "object",
          "additionalProperties": {}
        },
        {
          "type": "null"
        }
      ]
    },
    "iterationObservations": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": {}
      }
    }
  },
  "required": [
    "run",
    "nodeRun",
    "observations",
    "nodeObservations",
    "iterationRun",
    "iterationObservations"
  ],
  "additionalProperties": false,
  "$id": "benchmark.run.response"
} as const;

export const detectionRouteSchemas = {
  "detectInputsPost": {
    "tags": [
      "Utility"
    ],
    "summary": "Detect query inputs (POST)",
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false,
      "$id": "detection.query.request"
    },
    "response": {
      "200": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "valuesInputs": {
            "default": [],
            "type": "array",
            "items": {
              "minItems": 1,
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "limitParameters": {
            "default": [],
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "offsetParameters": {
            "default": [],
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "correlatedExistsInputs": {
            "default": [],
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "parameters": {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "correlatedVariables": {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "parameters",
                "correlatedVariables"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "valuesInputs",
          "limitParameters",
          "offsetParameters",
          "correlatedExistsInputs"
        ],
        "additionalProperties": false,
        "$id": "detection.inputs.response"
      },
      "400": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "detectInputsGet": {
    "tags": [
      "Utility"
    ],
    "summary": "Detect query inputs (GET)",
    "querystring": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    },
    "response": {
      "200": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "valuesInputs": {
            "default": [],
            "type": "array",
            "items": {
              "minItems": 1,
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "limitParameters": {
            "default": [],
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "offsetParameters": {
            "default": [],
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "correlatedExistsInputs": {
            "default": [],
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "parameters": {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "correlatedVariables": {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "parameters",
                "correlatedVariables"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "valuesInputs",
          "limitParameters",
          "offsetParameters",
          "correlatedExistsInputs"
        ],
        "additionalProperties": false,
        "$id": "detection.inputs.response"
      },
      "400": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "detectOutputsPost": {
    "tags": [
      "Utility"
    ],
    "summary": "Detect query outputs (POST)",
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false,
      "$id": "detection.query.request"
    },
    "response": {
      "200": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "array",
        "items": {
          "type": "string"
        },
        "$id": "detection.outputs.response"
      },
      "400": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "detectOutputsGet": {
    "tags": [
      "Utility"
    ],
    "summary": "Detect query outputs (GET)",
    "querystring": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    },
    "response": {
      "200": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "array",
        "items": {
          "type": "string"
        },
        "$id": "detection.outputs.response"
      },
      "400": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "validateQueryPost": {
    "tags": [
      "Utility"
    ],
    "summary": "Validate query syntax (POST)",
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false,
      "$id": "detection.query.request"
    },
    "response": {
      "200": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "valid": {
            "type": "boolean",
            "const": true
          }
        },
        "required": [
          "valid"
        ],
        "additionalProperties": false,
        "$id": "detection.validate.response"
      },
      "400": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
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
        ],
        "additionalProperties": false,
        "$id": "detection.validate.error.response"
      }
    }
  },
  "validateRuleDataPost": {
    "tags": [
      "Utility"
    ],
    "summary": "Validate RULE/DATA syntax (POST)",
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "ruleOrData": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "ruleOrData"
      ],
      "additionalProperties": false,
      "$id": "detection.ruledata.request"
    },
    "response": {
      "200": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "valid": {
            "type": "boolean",
            "const": true
          },
          "normalized": {
            "type": "string"
          },
          "primaryGrammar": {
            "type": "string",
            "enum": [
              "srl",
              "sparql"
            ]
          },
          "validations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "grammar": {
                  "type": "string",
                  "enum": [
                    "srl",
                    "sparql"
                  ]
                },
                "valid": {
                  "type": "boolean"
                },
                "normalized": {
                  "type": "string"
                },
                "error": {
                  "type": "string"
                }
              },
              "required": [
                "grammar",
                "valid"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "valid",
          "normalized"
        ],
        "additionalProperties": false,
        "$id": "detection.ruledata.response"
      },
      "400": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "valid": {
            "type": "boolean",
            "const": false
          },
          "error": {
            "type": "string"
          },
          "validations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "grammar": {
                  "type": "string",
                  "enum": [
                    "srl",
                    "sparql"
                  ]
                },
                "valid": {
                  "type": "boolean"
                },
                "normalized": {
                  "type": "string"
                },
                "error": {
                  "type": "string"
                }
              },
              "required": [
                "grammar",
                "valid"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "valid",
          "error"
        ],
        "additionalProperties": false,
        "$id": "detection.ruledata.error.response"
      }
    }
  },
  "formatPost": {
    "tags": [
      "Utility"
    ],
    "summary": "Format SPARQL or RULE/DATA (POST)",
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "code": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "code"
      ],
      "additionalProperties": false,
      "$id": "detection.format.request"
    },
    "response": {
      "200": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "formatted": {
            "type": "string"
          }
        },
        "required": [
          "formatted"
        ],
        "additionalProperties": false,
        "$id": "detection.format.response"
      },
      "400": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  }
} as const;

/**
 * The inline arguments an execution request carries: one entry per VALUES input,
 * each naming its variables and the rows to bind them to.
 *
 * Named rather than inline because two routes take it. `POST /execute` runs a
 * stored query with these substituted in; `POST /sparql` runs an ad-hoc query
 * string the same way, which is what lets an unsaved draft run with the
 * values on screen (see `applyExecutionArguments`). One definition, so the two
 * cannot drift into accepting different payloads for the same operation.
 */
export const executionArgumentsJsonSchema = {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "head": {
        "type": "object",
        "properties": {
          "vars": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "vars"
        ],
        "additionalProperties": false
      },
      "arguments": {
        "type": "object",
        "properties": {
          "bindings": {
            "type": "array",
            "items": {
              "anyOf": [
                {
                  "type": "object",
                  "additionalProperties": {
                    "anyOf": [
                      {
                        "type": "object",
                        "properties": {
                          "type": {
                            "type": "string",
                            "enum": [
                              "uri",
                              "literal"
                            ]
                          },
                          "value": {
                            "type": "string"
                          },
                          "xml:lang": {
                            "type": "string"
                          },
                          "datatype": {
                            "type": "string",
                            "minLength": 1
                          }
                        },
                        "required": [
                          "type",
                          "value"
                        ],
                        "additionalProperties": false
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "required": [
          "bindings"
        ],
        "additionalProperties": false
      },
      "whenEmpty": {
        "type": "string",
        "enum": [
          "unconstrained",
          "propagateEmpty",
          "require"
        ]
      }
    },
    "required": [
      "head",
      "arguments"
    ],
    "additionalProperties": false
  }
} as const;

/**
 * A LIMIT or OFFSET parameter list: `{ name, value }` per parameter the query
 * declares. Identical for both, hence one schema used twice.
 */
export const executionParametersJsonSchema = {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string"
      },
      "value": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      }
    },
    "required": [
      "name",
      "value"
    ],
    "additionalProperties": false
  }
} as const;

/**
 * The data graphs a run hands to a query group's start node.
 *
 * The RDF counterpart of `executionArgumentsJsonSchema`: tuple inputs and data
 * graph inputs are separate slots on the same start node, so a run may carry
 * both. Graphs fill the declared inputs in the order they are given here —
 * nothing names a port, because where each one goes is the group's to say.
 */
export const executionDataGraphsJsonSchema = {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "dataGraphVersionId": {
        "type": "string",
        "minLength": 1,
        "format": "iri"
      },
      "dataGraphInline": {
        "type": "string"
      },
      "dataGraphInlineFormat": {
        "type": "string",
        "minLength": 1
      }
    },
    "additionalProperties": false
  }
} as const;

export const executionRouteSchemas = {
  "post": {
    "tags": [
      "Execution"
    ],
    "summary": "Execute a query or query group (POST)",
    "body": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "targetId": {
          "type": "string",
          "minLength": 1,
          "format": "iri"
        },
        "backendId": {
          "type": "string",
          "minLength": 1,
          "format": "iri"
        },
        "arguments": executionArgumentsJsonSchema,
        "limits": executionParametersJsonSchema,
        "offsets": executionParametersJsonSchema,
        "argumentSetIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "dataGraphs": executionDataGraphsJsonSchema,
        "nodeDetail": {
          "type": "string",
          "enum": [
            "timings",
            "results"
          ]
        }
      },
      "required": [
        "targetId"
      ],
      "additionalProperties": false,
      "$id": "execution.request"
    },
    "headers": {
      "type": "object",
      "properties": {
        "accept": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    "response": {
      "200": {},
      "400": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "501": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "502": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "504": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  },
  "get": {
    "tags": [
      "Execution"
    ],
    "summary": "Execute a query or query group (GET)",
    "querystring": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "targetId": {
          "type": "string",
          "minLength": 1,
          "format": "iri"
        },
        "backendId": {
          "type": "string",
          "minLength": 1,
          "format": "iri"
        },
        "arguments": {
          "type": "string"
        },
        "limits": {
          "type": "string"
        },
        "offsets": {
          "type": "string"
        },
        "argumentSetIds": {
          "type": "string"
        },
        "nodeDetail": {
          "type": "string",
          "enum": [
            "timings",
            "results"
          ]
        }
      },
      "required": [
        "targetId"
      ],
      "additionalProperties": false,
      "$id": "execution.querystring"
    },
    "headers": {
      "type": "object",
      "properties": {
        "accept": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    "response": {
      "200": {},
      "400": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "404": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "500": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "501": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "502": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      },
      "504": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "failedNodeId": {
            "type": "string"
          },
          "failedNodeName": {
            "type": "string"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "error"
        ],
        "additionalProperties": false
      }
    }
  }
} as const;

export const ruleSetExecutionResponseJsonSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "converged",
        "cycle",
        "maxIterations",
        "failed"
      ]
    },
    "iterations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "index": {
            "type": "number"
          },
          "signature": {
            "type": "string"
          },
          "tripleCount": {
            "type": "number"
          },
          "tupleCount": {
            "type": "number"
          },
          "delta": {
            "type": "number"
          },
          "rules": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "ruleVersionId": {
                  "type": "string"
                },
                "ruleIri": {
                  "type": "string"
                },
                "programSource": {
                  "type": "string",
                  "enum": [
                    "normalized",
                    "raw"
                  ]
                },
                "durationMs": {
                  "type": "number"
                },
                "triplesInserted": {
                  "type": "number"
                },
                "triplesDeleted": {
                  "type": "number"
                },
                "quadSamples": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "insertedQuads": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "deletedQuads": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "insertedTuples": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "stratum": {
                  "type": "number"
                },
                "timedOut": {
                  "type": "boolean"
                },
                "error": {
                  "anyOf": [
                    {
                      "type": "object",
                      "properties": {
                        "message": {
                          "type": "string"
                        },
                        "stack": {
                          "type": "string"
                        }
                      },
                      "required": [
                        "message"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              },
              "required": [
                "ruleVersionId",
                "programSource",
                "durationMs",
                "triplesInserted",
                "triplesDeleted",
                "quadSamples",
                "insertedQuads",
                "deletedQuads",
                "timedOut"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "index",
          "signature",
          "tripleCount",
          "delta",
          "rules"
        ],
        "additionalProperties": false
      }
    },
    "dataBlocks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "dataBlockVersionId": {
            "type": "string"
          },
          "programSource": {
            "type": "string",
            "enum": [
              "normalized",
              "raw"
            ]
          },
          "durationMs": {
            "type": "number"
          },
          "tripleDelta": {
            "type": "number"
          },
          "error": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "message": {
                    "type": "string"
                  },
                  "stack": {
                    "type": "string"
                  }
                },
                "required": [
                  "message"
                ],
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "dataBlockVersionId",
          "programSource",
          "durationMs",
          "tripleDelta"
        ],
        "additionalProperties": false
      }
    },
    "seededQuads": {
      "anyOf": [
        {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        {
          "type": "null"
        }
      ]
    },
    "finalGraphNQuads": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "finalGraphContent": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "finalGraphContentType": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "finalTuples": {
      "anyOf": [
        {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        {
          "type": "null"
        }
      ]
    },
    "cycle": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "startIteration": {
              "type": "number"
            },
            "endIteration": {
              "type": "number"
            }
          },
          "required": [
            "startIteration",
            "endIteration"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "maxIterations": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ]
    },
    "ruleNames": {
      "anyOf": [
        {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "status",
    "iterations",
    "dataBlocks"
  ],
  "additionalProperties": false,
  "$id": "ruleset.execution.response"
} as const;

/**
 * `POST /sparql` — the request body. `GET /sparql` takes the same fields minus
 * the arguments; see `sparqlQuerystringJsonSchema` below.
 *
 * The fourth request body with no entity behind it, alongside detection,
 * execution and playground. It lived as a module-local literal in
 * `packages/api/src/routes/sparql.ts` with a byte-identical copy in
 * `packages/mcp-server/src/tool-schemas.ts`, guarded by a test that read the
 * API's source text and asserted the two matched. Both now import this.
 *
 * `anyOf` carries the "backendId or endpoint is required" rule. It previously
 * lived only in the zod schema's `.superRefine`, which `produceJsonSchema()`
 * silently dropped — so POST accepted a body its own published contract called
 * valid and then threw inside the handler (a 500), while GET, whose querystring
 * schema was hand-written with this rule, correctly returned 400.
 *
 * It was `oneOf` until Phase C3, which reads as *exactly* one — so a request
 * naming both a backend and an endpoint was rejected, although the zod rule it
 * came from is `backendId || endpoint` and `resolveExecutor` handles both being
 * present (endpoint wins). `anyOf` is the rule as written.
 *
 * `minLength: 1` on `query` was likewise present on the POST body but missing
 * from the hand-written GET querystring, so `?query=` reached the handler.
 */
/**
 * `POST /patches/preview` — derive the diff an update would produce.
 *
 * Owned here rather than in the route because the MCP `patches.previewUpdate`
 * tool publishes the same document: the shape an agent is told to send and the
 * shape the API enforces are one object, not two that a drift test has to keep
 * equal.
 */
export const patchPreviewJsonSchema = {
  type: 'object',
  properties: {
    updateString: { type: 'string', minLength: 1 },
    backendId: { type: 'string', minLength: 1, format: 'iri' },
    /*
     * Turn `CLEAR`/`DROP`/`COPY`/`MOVE`/`ADD` into the quads they move, instead
     * of reporting an affected count. Off by default because `DROP GRAPH <g>`
     * should not silently become a full scan of `g` — and on, it is what makes
     * such a patch applicable and revertible rather than a record of what
     * happened. `LOAD` is never enumerable: its document is outside the dataset.
     */
    enumerateGraphOps: { type: 'boolean' },
    /* Refuse rather than enumerate past this many triples per operation. */
    enumerationCap: { type: 'integer', minimum: 0 },
  },
  required: ['updateString', 'backendId'],
  additionalProperties: false,
} as const;

/**
 * `POST /patches/apply` — apply a previewed patch, or derive and apply.
 *
 * `anyOf` carries the rule the handler enforces: either a `patchId` (a diff
 * somebody already approved) or an `updateString` with a `backendId` (a caller
 * asserting it needs no approval step). Written into the document rather than
 * left to the handler so a client is told which of the two it forgot, instead
 * of being accepted and then refused.
 */
export const patchApplyJsonSchema = {
  type: 'object',
  properties: {
    patchId: { type: 'string', minLength: 1, format: 'iri' },
    updateString: { type: 'string', minLength: 1 },
    backendId: { type: 'string', minLength: 1, format: 'iri' },
    expectedHash: { type: 'string' },
    force: { type: 'boolean' },
    /* As on preview. Applying a stored patch defaults to however it was derived. */
    enumerateGraphOps: { type: 'boolean' },
    enumerationCap: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
  anyOf: [{ required: ['patchId'] }, { required: ['updateString', 'backendId'] }],
} as const;

export const sparqlRequestJsonSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1 },
    backendId: { type: 'string', minLength: 1, format: 'iri' },
    endpoint: { type: 'string', format: 'uri' },
    queryMethod: { type: 'string', enum: ['get', 'post'] },
    /*
     * The same three fields `POST /execute` takes, applied by the same code to
     * an ad-hoc query string instead of a stored version. Without them an
     * unsaved query — or one with unsaved edits — could only ever run
     * unparameterised, because there is no version for `/execute` to name: the
     * arguments the editor was showing were dropped on the way out.
     */
    arguments: executionArgumentsJsonSchema,
    limits: executionParametersJsonSchema,
    offsets: executionParametersJsonSchema,
    /*
     * Stored sets, so a raw run can name one instead of the client flattening
     * it into `arguments` first. Same completion rule as `/execute`: a set may
     * be combined with inline values for the parameters it leaves open, and an
     * overlap is refused naming the parameter.
     */
    argumentSetIds: { type: 'array', items: { type: 'string', minLength: 1, format: 'iri' } },
  },
  required: ['query'],
  additionalProperties: false,
  anyOf: [{ required: ['backendId'] }, { required: ['endpoint'] }],
} as const;

/**
 * `POST /substitute` — the substituted query, without running it.
 *
 * The one piece a browser-side executor cannot do for itself. Applying
 * arguments is "serialise a VALUES block, splice it over a span", which the
 * parser-free runtime does happily; deciding *where* those spans are needs a
 * parser, and naming a stored argument set needs the store. So the server does
 * the substitution and hands the text back, and whoever asked runs it —
 * against an endpoint sqlib never sees, if that is where they want it to go.
 *
 * It is the read-only half of `POST /sparql`: the same body minus the backend,
 * because a caller that wanted sqlib to execute it would have said so there.
 * `operation` comes back too, since the caller needs it to choose a request
 * shape and has just paid for the parse that knows.
 */
export const substituteRouteSchemas = {
  substitutePost: {
    tags: ['Utility'],
    summary: 'Apply arguments to a query and return the text, without executing it',
    body: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        arguments: executionArgumentsJsonSchema,
        limits: executionParametersJsonSchema,
        offsets: executionParametersJsonSchema,
        argumentSetIds: { type: 'array', items: { type: 'string', minLength: 1, format: 'iri' } },
      },
      required: ['query'],
      additionalProperties: false,
      $id: 'substitute.request',
    },
    response: {
      200: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          operation: { type: 'string', enum: ['query', 'update'] },
        },
        required: ['query', 'operation'],
        additionalProperties: false,
        $id: 'substitute.response',
      },
      400: {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error'],
        additionalProperties: false,
      },
    },
  },
} as const;

/**
 * `?record=patch` — the proxy's one opt-in.
 *
 * A raw update through the proxy is a passthrough: sqlib hands the string to
 * the backend and keeps nothing. With `record=patch` the ground diff is derived
 * from the pre-update store first and persisted against the backend once the
 * update has run, so the write appears in `GET /backends/:id/patches` like any
 * other. It is an enum of one because the alternative spellings that might
 * exist later (`record=none`, `record=preview`) are decisions this does not
 * make; an unknown value is rejected rather than silently ignored, since the
 * whole point of asking is not wanting the write to go unrecorded.
 *
 * See `docs/explanation/rdf-patch.md`.
 */
export const sparqlRecordJsonSchema = { type: 'string', enum: ['patch'] } as const;

/**
 * `GET /sparql` — the querystring, which is the POST body minus the arguments.
 *
 * The two shared one schema until arguments arrived. A querystring carries
 * strings, so the structured payload has no spelling here; `/execute` gives its
 * GET the same fields as JSON-encoded strings, but nothing asks that of raw
 * SPARQL — a caller with arguments to send is sending a body.
 */
export const sparqlQuerystringJsonSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1 },
    backendId: { type: 'string', minLength: 1, format: 'iri' },
    endpoint: { type: 'string', format: 'uri' },
    queryMethod: { type: 'string', enum: ['get', 'post'] },
    record: sparqlRecordJsonSchema,
  },
  required: ['query'],
  additionalProperties: false,
  anyOf: [{ required: ['backendId'] }, { required: ['endpoint'] }],
} as const;

/**
 * `POST /sparql`'s querystring, which carries nothing but the record opt-in.
 *
 * The switch lives in the query string for both verbs rather than in the POST
 * body, so a caller flips recording on the same way whichever verb it uses, and
 * the body stays the SPARQL request the MCP tool publishes.
 */
export const sparqlRecordQuerystringJsonSchema = {
  type: 'object',
  properties: {
    record: sparqlRecordJsonSchema,
  },
  additionalProperties: false,
} as const;

export const playgroundRulesExecuteRequestJsonSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    /*
     * The rule set as one SRL document — prologue, DATA blocks and rules. This
     * is what the editor sends; the server splits it into the parts below,
     * which remain for callers that already hold split ones.
     */
    "srl": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "tupleSeeds": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "tuples": {
      "anyOf": [
        {
          "type": "boolean"
        },
        {
          "type": "null"
        }
      ]
    },
    "dataBlocks": {
      "anyOf": [
        {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        {
          "type": "null"
        }
      ]
    },
    "rules": {
      "anyOf": [
        {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        {
          "type": "null"
        }
      ]
    },
    "inferenceFormat": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "maxIterations": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        {
          "type": "null"
        }
      ]
    },
    /*
     * The data graph — the base graph the rules run against, and the input side
     * of the ledger. DATA blocks in `srl` are part of the rule set and appear
     * in the inferred output; this never does.
     *
     * `dataGraphVersionId` names a saved DataGraphVersion, so the run is
     * reproducible. `dataGraphInline` is raw RDF, ephemeral — what the
     * playground and unsaved drafts send. Sending both is rejected.
     */
    "dataGraphVersionId": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "dataGraphInline": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "dataGraphInlineFormat": {
      "anyOf": [
        {
          "type": "string",
          "enum": [
            "text/turtle",
            "application/n-triples",
            "application/n-quads"
          ]
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "additionalProperties": false,
  "$id": "ruleset.execution.request"
} as const;

export const playgroundRulesExecuteResponseJsonSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "converged",
        "cycle",
        "maxIterations",
        "failed"
      ]
    },
    "iterations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "index": {
            "type": "number"
          },
          "signature": {
            "type": "string"
          },
          "tripleCount": {
            "type": "number"
          },
          "tupleCount": {
            "type": "number"
          },
          "delta": {
            "type": "number"
          },
          "rules": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "ruleVersionId": {
                  "type": "string"
                },
                "ruleIri": {
                  "type": "string"
                },
                "programSource": {
                  "type": "string",
                  "enum": [
                    "normalized",
                    "raw"
                  ]
                },
                "durationMs": {
                  "type": "number"
                },
                "triplesInserted": {
                  "type": "number"
                },
                "triplesDeleted": {
                  "type": "number"
                },
                "quadSamples": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "insertedQuads": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "deletedQuads": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "insertedTuples": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "stratum": {
                  "type": "number"
                },
                "timedOut": {
                  "type": "boolean"
                },
                "error": {
                  "anyOf": [
                    {
                      "type": "object",
                      "properties": {
                        "message": {
                          "type": "string"
                        },
                        "stack": {
                          "type": "string"
                        }
                      },
                      "required": [
                        "message"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              },
              "required": [
                "ruleVersionId",
                "programSource",
                "durationMs",
                "triplesInserted",
                "triplesDeleted",
                "quadSamples",
                "insertedQuads",
                "deletedQuads",
                "timedOut"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "index",
          "signature",
          "tripleCount",
          "delta",
          "rules"
        ],
        "additionalProperties": false
      }
    },
    "dataBlocks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "dataBlockVersionId": {
            "type": "string"
          },
          "programSource": {
            "type": "string",
            "enum": [
              "normalized",
              "raw"
            ]
          },
          "durationMs": {
            "type": "number"
          },
          "tripleDelta": {
            "type": "number"
          },
          "error": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "message": {
                    "type": "string"
                  },
                  "stack": {
                    "type": "string"
                  }
                },
                "required": [
                  "message"
                ],
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "dataBlockVersionId",
          "programSource",
          "durationMs",
          "tripleDelta"
        ],
        "additionalProperties": false
      }
    },
    "seededQuads": {
      "anyOf": [
        {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        {
          "type": "null"
        }
      ]
    },
    "finalGraphNQuads": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "finalGraphContent": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "finalGraphContentType": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "finalTuples": {
      "anyOf": [
        {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        {
          "type": "null"
        }
      ]
    },
    "cycle": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "startIteration": {
              "type": "number"
            },
            "endIteration": {
              "type": "number"
            }
          },
          "required": [
            "startIteration",
            "endIteration"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "maxIterations": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ]
    },
    "ruleNames": {
      "anyOf": [
        {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "status",
    "iterations",
    "dataBlocks"
  ],
  "additionalProperties": false,
  "$id": "ruleset.execution.response"
} as const;
