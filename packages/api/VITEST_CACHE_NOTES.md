# Vitest Cache Notes

## Issue Encountered (2025-11-29)

Test `schema-validation.test.ts` was failing with validation error even though the generated schema was correct. The issue was caused by Vitest's module cache holding stale compiled versions of the schema files.

### Root Cause

1. Schemas were regenerated with `npm run generate-schemas`
2. TypeScript source files (`.ts`) were updated correctly
3. Vitest caches transformed modules in `node_modules/.vite/`
4. Test continued to load the stale cached version
5. Clearing the cache with `rm -rf node_modules/.vite` fixed the issue

## Cache Behavior

Vitest uses Vite's transformation layer which caches transformed modules for performance. This is generally beneficial but can cause issues when:

- Generated files are updated (like schema files)
- Dependencies change without changing `package.json`
- Large refactors affect multiple files

## Recommendations

### ❌ DO NOT add automatic cache clearing to test script

**Reasons:**
1. **Performance**: Cache significantly speeds up test runs (especially in watch mode)
2. **Rarely needed**: Cache invalidation usually works correctly
3. **Developer friction**: Forces cold start on every test run
4. **CI/CD**: Most CI environments start with clean state anyway

### ✅ DO document when manual cache clearing is needed

Clear the cache manually when:
- Generated schemas are updated: `npm run generate-schemas`
- Strange validation errors that don't match source code
- After major dependency updates
- Tests pass locally but fail in different environment

### Manual Cache Clear Command

```bash
# Clear Vitest/Vite cache
rm -rf node_modules/.vite

# Or run tests with cache cleared once
rm -rf node_modules/.vite && npm test
```

## Best Practices

1. **After schema generation**, clear cache if tests behave unexpectedly:
   ```bash
   npm run generate-schemas && rm -rf node_modules/.vite && npm test
   ```

2. **In CI/CD**, cache is naturally cleared on each run (fresh environment)

3. **For persistent issues**, check if `vitest.config.ts` needs cache configuration:
   ```typescript
   export default defineConfig({
     test: {
       cache: {
         dir: 'node_modules/.vite'  // Default location
       }
     }
   });
   ```

4. **Consider** adding a convenience script to `package.json` for manual use:
   ```json
   {
     "scripts": {
       "test:clean": "rm -rf node_modules/.vite && vitest run"
     }
   }
   ```

## Related Files

- **Vitest config**: `vitest.config.ts`
- **Cache location**: `node_modules/.vite/`
- **Schema generation**: `scripts/generate-schemas.ts`
- **Test that exposed issue**: `test/routes/schema-validation.test.ts`

## Reference

- [Vitest Caching Documentation](https://vitest.dev/guide/improving-performance.html#caching)
- [Vite Module Graph](https://vitejs.dev/guide/api-hmr.html)
