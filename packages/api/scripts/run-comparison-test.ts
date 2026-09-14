#!/usr/bin/env ts-node

/**
 * Deprecated comparison script. Runs LDKit validation instead.
 * Usage: npx ts-node scripts/run-comparison-test.ts
*/
import { Phase2Validator } from './validate-phase2';

async function main() {
  console.log('🚀 Starting LDKit validation (EntityManager comparison deprecated)...\n');
  
  try {
    const validator = new Phase2Validator();
    await validator.runAllValidations();
    console.log('\n🎉 LDKit validation completed successfully!');
  } catch (error) {
    console.error('\n💥 Validation failed:', error);
    process.exit(1);
  }
}

main();
