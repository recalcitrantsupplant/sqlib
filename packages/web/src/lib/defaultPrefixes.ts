import type { PrefixMapping } from '@/types/prefixes';

// Helper to generate IDs for defaults
const generateDefaultId = (prefix: string) => `default-${prefix}`;

const now = Date.now();

export const DEFAULT_PREFIXES: PrefixMapping[] = [
  // Core RDF/RDFS/OWL (enabled by default)
  {
    id: generateDefaultId('rdf'),
    prefix: 'rdf',
    namespace: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('rdfs'),
    prefix: 'rdfs',
    namespace: 'http://www.w3.org/2000/01/rdf-schema#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('owl'),
    prefix: 'owl',
    namespace: 'http://www.w3.org/2002/07/owl#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('xsd'),
    prefix: 'xsd',
    namespace: 'http://www.w3.org/2001/XMLSchema#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },

  // Common vocabularies (enabled)
  {
    id: generateDefaultId('foaf'),
    prefix: 'foaf',
    namespace: 'http://xmlns.com/foaf/0.1/',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('dc'),
    prefix: 'dc',
    namespace: 'http://purl.org/dc/elements/1.1/',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('dcterms'),
    prefix: 'dcterms',
    namespace: 'http://purl.org/dc/terms/',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('skos'),
    prefix: 'skos',
    namespace: 'http://www.w3.org/2004/02/skos/core#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('sh'),
    prefix: 'sh',
    namespace: 'http://www.w3.org/ns/shacl#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },

  // Additional vocabularies (enabled by default)
  {
    id: generateDefaultId('schema'),
    prefix: 'schema',
    namespace: 'http://schema.org/',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('sdo'),
    prefix: 'sdo',
    namespace: 'https://schema.org/',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('geo'),
    prefix: 'geo',
    namespace: 'http://www.opengis.net/ont/geosparql#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('geof'),
    prefix: 'geof',
    namespace: 'http://www.opengis.net/def/function/geosparql/',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('time'),
    prefix: 'time',
    namespace: 'http://www.w3.org/2006/time#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('void'),
    prefix: 'void',
    namespace: 'http://rdfs.org/ns/void#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('prov'),
    prefix: 'prov',
    namespace: 'http://www.w3.org/ns/prov#',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('dbr'),
    prefix: 'dbr',
    namespace: 'http://dbpedia.org/resource/',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('dbo'),
    prefix: 'dbo',
    namespace: 'http://dbpedia.org/ontology/',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
  {
    id: generateDefaultId('dbp'),
    prefix: 'dbp',
    namespace: 'http://dbpedia.org/property/',
    enabled: true,
    isDefault: true,
    source: 'default',
    createdAt: now
  },
];
