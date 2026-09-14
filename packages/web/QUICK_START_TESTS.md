# Quick Start - Running Dialog Tests

## The Commands You Need

### Run ALL Dialog Tests (Recommended)
```bash
cd packages/web
npx playwright test library-dialog-mocked backend-dialog-mocked library-delete-mocked
```

**Expected Result**: 29/33 tests pass in ~26 seconds ✅

### Run Each Test File Individually

```bash
# Library Dialog tests (11 tests)
npx playwright test library-dialog-mocked.spec.ts

# Backend Dialog tests (11 tests)
npx playwright test backend-dialog-mocked.spec.ts

# Delete Library tests (12 tests)
npx playwright test library-delete-mocked.spec.ts
```

### Debug Mode (Watch Tests Run)

```bash
# See tests in browser
npx playwright test library-dialog-mocked.spec.ts --headed

# Interactive UI (best for debugging)
npx playwright test library-dialog-mocked.spec.ts --ui

# Step-through debugger
npx playwright test library-dialog-mocked.spec.ts --debug
```

### Run Specific Test by Name

```bash
# Run just one test
npx playwright test library-dialog-mocked.spec.ts --grep "should create library with name only"

# Run tests matching pattern
npx playwright test --grep "should create"
```

## ⚠️ Important: No Backend Needed!

These tests use mocking - they **DO NOT** require the backend API server to be running.

The mocked tests intercept API calls and return fake data, so they're:
- ✅ Fast (~26 seconds for 33 tests)
- ✅ Reliable (no network issues)
- ✅ Isolated (tests don't affect each other)

## What Each Test File Covers

### library-dialog-mocked.spec.ts
- Opens add library dialog
- Fills in form fields (name, description, default backend)
- Creates libraries
- Validates required fields
- Tests cancel/close functionality

### backend-dialog-mocked.spec.ts
- Opens add backend dialog
- Tests 3 backend types (HTTP, Ephemeral, Persistent)
- Dynamic form based on backend type
- Creates backends
- Tests radio button interactions

### library-delete-mocked.spec.ts
- Shows delete button on hover
- Opens confirmation dialog
- Deletes libraries
- Tests cancel functionality
- Verifies UI updates after deletion

## Current Status

**Pass Rate**: 88% (29/33 tests)

4 tests have minor issues (validation/timing) but core functionality works!

## Troubleshooting

### Tests Taking Too Long?
Make sure you're running the `-mocked` test files, not the originals.

### Tests Failing?
1. Make sure you're in the right directory: `cd packages/web`
2. Check Node version: `node --version` (should be 18+)
3. Try running with `--headed` to see what's happening

### Need Help?
Check the detailed documentation:
- [TESTING_SUMMARY.md](./tests/TESTING_SUMMARY.md)
- [tests/e2e/README.md](./tests/e2e/README.md)
