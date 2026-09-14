/**
 * Contract Module Emitter
 *
 * Generates TypeScript contract modules (Backend, Library, Query, etc.)
 * using ts-morph for type-safe code generation instead of template strings.
 */

import { Project, SourceFile, VariableDeclarationKind, StructureKind } from 'ts-morph';
import type { ContractDefinition, ZodSchemaDefinition, ZodFieldDefinition } from './contract-types.js';

/**
 * Generates a complete contract module from a ContractDefinition
 */
export function emitContractModule(definition: ContractDefinition): string {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: 99, // ESNext
      module: 99, // ESNext
    },
  });

  const sourceFile = project.createSourceFile('contract.ts');

  // Add file header comment
  addFileHeader(sourceFile);

  // Add imports
  addImports(sourceFile, definition);

  // Add constants
  if (definition.constants) {
    addConstants(sourceFile, definition.constants);
  }

  // Add custom blocks (before schemas)
  addCustomBlocks(sourceFile, definition, 'before-schemas');

  // Add reusable types
  addReusableTypes(sourceFile, definition);

  // Add custom blocks (after reusable types, before schemas)
  addCustomBlocks(sourceFile, definition, 'after-schemas');

  // Add Zod schemas
  addZodSchemas(sourceFile, definition);

  // Add type exports
  addTypeExports(sourceFile, definition);

  // Add custom blocks (before routes)
  addCustomBlocks(sourceFile, definition, 'before-routes');

  // Add custom blocks (after routes)
  addCustomBlocks(sourceFile, definition, 'after-routes');

  // Format and return
  sourceFile.formatText({ indentSize: 2 });
  return sourceFile.getFullText();
}

/**
 * Add file header comment
 */
function addFileHeader(sourceFile: SourceFile): void {
  sourceFile.insertText(
    0,
    `/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */
`
  );
}

/**
 * Add import statements
 */
function addImports(sourceFile: SourceFile, definition: ContractDefinition): void {
  // Add external imports
  for (const importDef of definition.imports.external) {
    sourceFile.addImportDeclaration({
      moduleSpecifier: importDef.from,
      namedImports: importDef.imports,
    });
  }

  // Add type imports
  if (definition.imports.types) {
    for (const importDef of definition.imports.types) {
      sourceFile.addImportDeclaration({
        moduleSpecifier: importDef.from,
        namedImports: importDef.imports.map((name) => ({ name, isTypeOnly: true })),
      });
    }
  }
}

/**
 * Add constant declarations
 */
function addConstants(
  sourceFile: SourceFile,
  constants: Array<{ name: string; value: string; comment?: string }>
): void {
  for (const constant of constants) {
    if (constant.comment) {
      sourceFile.addStatements(`// ${constant.comment}`);
    }
    sourceFile.addVariableStatement({
      declarationKind: VariableDeclarationKind.Const,
      declarations: [
        {
          name: constant.name,
          initializer: constant.value,
        },
      ],
    });
  }
}

/**
 * Add custom code blocks
 */
function addCustomBlocks(
  sourceFile: SourceFile,
  definition: ContractDefinition,
  position: 'before-schemas' | 'after-schemas' | 'before-routes' | 'after-routes'
): void {
  if (!definition.customBlocks) return;

  const blocks = definition.customBlocks.filter((block) => block.position === position);
  for (const block of blocks) {
    sourceFile.addStatements(block.code);
  }
}

/**
 * Add reusable Zod types
 */
function addReusableTypes(sourceFile: SourceFile, definition: ContractDefinition): void {
  for (const type of definition.reusableTypes) {
    if (type.comment) {
      sourceFile.addStatements(`// ${type.comment}`);
    }
    sourceFile.addVariableStatement({
      declarationKind: VariableDeclarationKind.Const,
      isExported: type.exported === true,
      declarations: [
        {
          name: type.name,
          initializer: type.definition,
        },
      ],
    });
  }
}

/**
 * Build Zod schema shape object
 */
function buildSchemaShape(fields: ZodFieldDefinition[]): string {
  const fieldDefinitions = fields.map((field) => {
    let zodType = field.zodType;

    // Apply validators if present
    if (field.validators && field.validators.length > 0) {
      zodType += field.validators.join('');
    }

    return `  ${field.name}: ${zodType}`;
  });

  return `{\n${fieldDefinitions.join(',\n')}\n}`;
}

/**
 * Add Zod schemas
 */
function addZodSchemas(sourceFile: SourceFile, definition: ContractDefinition): void {
  for (const schema of definition.schemas) {
    if (schema.comment) {
      sourceFile.addStatements(`// ${schema.comment}`);
    }

    let schemaInitializer: string;

    // Handle special case: if there's a single field with empty name, use its zodType directly
    if (schema.fields.length === 1 && schema.fields[0].name === '') {
      schemaInitializer = schema.fields[0].zodType;
    } else {
      schemaInitializer = `z.object(${buildSchemaShape(schema.fields)})`;
    }

    // Add .strict() if specified
    if (schema.strict) {
      schemaInitializer += '.strict()';
    }

    // Add refinements
    if (schema.refinements && schema.refinements.length > 0) {
      for (const refinement of schema.refinements) {
        schemaInitializer += `\n  .${refinement.type}(${refinement.code})`;
      }
    }

    sourceFile.addVariableStatement({
      declarationKind: VariableDeclarationKind.Const,
      isExported: true,
      declarations: [
        {
          name: schema.name,
          initializer: schemaInitializer,
        },
      ],
    });
  }
}

/**
 * Add TypeScript type exports from Zod schemas
 */
function addTypeExports(sourceFile: SourceFile, definition: ContractDefinition): void {
  for (const typeExport of definition.typeExports) {
    if (typeExport.comment) {
      sourceFile.addStatements(`// ${typeExport.comment}`);
    }
    sourceFile.addTypeAlias({
      name: typeExport.name,
      type: `z.infer<typeof ${typeExport.zodSchemaName}>`,
      isExported: true,
    });
  }
}

