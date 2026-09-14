# Playwright Tests Setup Guide

## Quick Start - Simple Test

The simplest way to run a basic test (just the frontend):

```bash
cd packages/web
npm run test:simple
```

This runs a super simple test that just loads the page. **No backend API needed.**

## Running All Tests (With Backend API)

Most tests need both the backend API (port 3000) and frontend (port 3001) running.

### Option 1: Manual (2 terminals)

**Terminal 1 - Start Backend API:**
```bash
cd <repo-root>
npm run dev
```

**Terminal 2 - Run Tests:**
```bash
cd packages/web
npm test
```

### Option 2: Using the helper script

```bash
cd packages/web
./run-tests.sh
```

This script:
- Starts the backend API automatically
- Runs the simple test
- Cleans up when done

## Test Scripts

- `npm test` - Run all Playwright tests
- `npm run test:simple` - Run only the simple smoke test
- `npm run test:headed` - Run tests with browser visible
- `npm run test:ui` - Open Playwright UI mode
- `npm run test:debug` - Run tests in debug mode

## Configuration

Key settings in `playwright.config.ts`:

- **Frontend URL**: `http://localhost:3001` (Nuxt dev server)
- **Backend API**: `http://localhost:3000` (expected by most tests)
- **Test directory**: `./tests/e2e`
- **Timeout**: 60 seconds
- **Workers**: 1 (sequential)

## Troubleshooting

### Tests timeout waiting for elements

**Problem**: Tests can't find elements on the page.

**Solution**: Make sure the backend API is running on port 3000.

```bash
# Check if API is running
curl http://localhost:3000/docs

# If not, start it:
cd <repo-root>
npm run dev
```

### Port already in use

**Problem**: Port 3000 or 3001 already in use.

**Solution**: Kill existing processes:
```bash
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

### Playwright browsers not installed

**Problem**: `Executable doesn't exist` error.

**Solution**: Install Playwright browsers:
```bash
cd packages/web
npx playwright install chromium
```

## Writing New Tests

Start with the simple test template:

```typescript
import { test, expect } from '@playwright/test';

test('my new test', async ({ page }) => {
  await page.goto('/');
  
  // Your test code here
  const element = page.locator('.my-element');
  await expect(element).toBeVisible();
});
```

Save in `tests/e2e/` directory with `.spec.ts` extension.
