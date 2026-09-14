# Playwright Testing Guide

This guide documents the testing patterns and best practices for writing Playwright tests in this project.

## Table of Contents
- [Quick Start](#quick-start)
- [Test Structure Pattern](#test-structure-pattern)
- [Mock Data Best Practices](#mock-data-best-practices)
- [Common Patterns](#common-patterns)
- [Running Tests](#running-tests)
- [Troubleshooting](#troubleshooting)

## Quick Start

### Running Tests

```bash
# Run all tests
cd packages/web
npm test

# Run a specific test file
npx playwright test library-backend-selection.spec.ts

# Run with UI (see what's happening)
npx playwright test library-backend-selection.spec.ts --headed

# Run in debug mode
npx playwright test library-backend-selection.spec.ts --debug

# Run in UI mode (interactive)
npx playwright test --ui
```

### Prerequisites

- Backend API running on port 3000 (for non-mocked tests)
- Frontend dev server on port 3001
- Playwright browsers installed: `npx playwright install chromium`

## Test Structure Pattern

### Standard Test Template

```typescript
import { test, expect, type Route } from '@playwright/test';

// 1. Define mock data with VALID values
const mockBackends = [
  {
    id: 'urn:sqlib:backend:test-1',
    name: 'Test Backend 1',
    description: 'HTTP SPARQL backend',
    backendType: 'http',
    endpoint: 'http://localhost:7878/sparql', // ✅ MUST be valid IRI
    authEnvKey: null,
    oxigraphConfig: null,
    dateCreated: '2024-01-01T00:00:00Z',
    dateModified: '2024-01-01T00:00:00Z',
  },
];

const mockLibraries: any[] = [];
const mockQueries: any[] = [];
const mockQueryGroups: any[] = [];

// 2. Test suite with beforeEach setup
test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Mock all required API endpoints
    await page.route('**/backends', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockBackends),
      });
    });

    await page.route('**/libraries', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLibraries),
      });
    });

    await page.route('**/queries', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockQueries),
      });
    });

    await page.route('**/query-groups', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockQueryGroups),
      });
    });

    // Navigate to home page (NOT /wireframe - that's legacy!)
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should do something', async ({ page }) => {
    // Your test code here
  });
});
```

## Mock Data Best Practices

### ✅ DO: Use Valid Data

```typescript
// Valid backend with proper IRI endpoint
{
  id: 'urn:sqlib:backend:test-1',
  name: 'Test Backend',
  backendType: 'http',
  endpoint: 'http://localhost:7878/sparql', // ✅ Valid IRI
  authEnvKey: null,
  oxigraphConfig: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
}
```

### ❌ DON'T: Use Invalid/Empty Data

```typescript
// Invalid backend - will cause validation errors
{
  id: 'urn:sqlib:backend:test-1',
  name: 'Test Backend',
  backendType: 'oxigraphEphemeral',
  endpoint: '', // ❌ Empty string fails IRI validation
}
```

### Mock Data Validation Rules

1. **Backend `endpoint`**: Must be a valid IRI (non-empty string, RFC 3987 compliant)
2. **IDs**: Use URN format: `urn:sqlib:type:uuid`
3. **Dates**: Use ISO 8601 format: `2024-01-01T00:00:00Z`
4. **Nullable fields**: Use `null` (not `undefined` or empty string)

## Common Patterns

### Opening a Dialog

```typescript
async function openAddLibraryDialog(page: any) {
  // Expand section if needed
  const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
  const sectionToggle = librariesSection.locator('.section-toggle');
  await sectionToggle.click();
  await page.waitForTimeout(200);

  // Click the add button
  const addButton = librariesSection.locator('.add-button');
  await addButton.click();

  // Wait for dialog to appear
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
}
```

### Selecting from Dropdown

```typescript
// Select by value (when you know the exact value)
await page.locator('#defaultBackend').selectOption('urn:sqlib:backend:test-1');

// Select by label (useful for "None" options with null values)
await page.locator('#defaultBackend').selectOption({ label: 'None' });

// Select by index
await page.locator('#defaultBackend').selectOption({ index: 1 });
```

### Filling Forms

```typescript
// Fill text input
await page.locator('#name').fill('My Library');

// Fill textarea
await page.locator('#description').fill('Description text');

// Clear and fill
await page.locator('#name').clear();
await page.locator('#name').fill('New value');
```

### Waiting for Elements

```typescript
// Wait for element to be visible
await expect(page.locator('.my-element')).toBeVisible();

// Wait for element to be hidden
await expect(page.locator('.my-element')).not.toBeVisible();

// Wait for specific timeout (use sparingly!)
await page.waitForTimeout(200);

// Wait for network to be idle
await page.waitForLoadState('networkidle');
```

### Testing Button States

```typescript
// Check button text
const submitButton = page.getByRole('button', { name: 'Create Library' });
await expect(submitButton).toBeVisible();
await expect(submitButton).toHaveText('Create Library');

// Check button is enabled/disabled
await expect(submitButton).toBeEnabled();
await expect(submitButton).toBeDisabled();

// Check button does NOT have certain text (important!)
await expect(page.getByRole('button', { name: 'Creating...' })).not.toBeVisible();
```

### Mocking API Responses with Delays

```typescript
// Useful for testing loading states
await page.route('**/libraries', async (route: Route) => {
  if (route.request().method() === 'POST') {
    // Add delay to see loading state
    await new Promise(resolve => setTimeout(resolve, 1000));

    const body = route.request().postDataJSON();
    const newLibrary = {
      id: `urn:sqlib:library:new-${Date.now()}`,
      ...body,
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
    };

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: {
        'etag': '"test-etag"',
      },
      body: JSON.stringify(newLibrary),
    });
  } else {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockLibraries),
    });
  }
});
```

### Testing Form Validation

```typescript
test('should require name field', async ({ page }) => {
  await openAddLibraryDialog(page);

  const nameField = page.locator('#name');

  // Try to submit without filling name
  await nameField.clear();
  await nameField.blur();

  const submitButton = page.getByRole('button', { name: 'Create Library' });
  await submitButton.click();

  // Dialog should still be visible (HTML5 validation prevents submit)
  await expect(page.locator('[role="dialog"]')).toBeVisible();
});
```

### Testing No Auto-Submit Behavior

```typescript
test('should not auto-submit when selecting dropdown', async ({ page }) => {
  await openAddLibraryDialog(page);

  await page.locator('#name').fill('Test Library');

  const submitButton = page.getByRole('button', { name: 'Create Library' });
  const backendSelect = page.locator('#defaultBackend');

  // Select a backend
  await backendSelect.selectOption('urn:sqlib:backend:test-1');

  // Wait to ensure no auto-submit
  await page.waitForTimeout(500);

  // Button should still show "Create Library" (not "Creating...")
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toHaveText('Create Library');

  // Dialog should still be open
  await expect(page.locator('[role="dialog"]')).toBeVisible();
});
```

## Running Tests

### Development Workflow

```bash
# Terminal 1: Start backend API
cd <repo-root>
npm run dev

# Terminal 2: Run tests
cd packages/web
npm test
```

### Test Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run all Playwright tests |
| `npm run test:simple` | Run only smoke tests (no backend needed) |
| `npm run test:headed` | Run tests with browser visible |
| `npm run test:ui` | Open Playwright UI mode |
| `npm run test:debug` | Run tests in debug mode |

### Running Specific Tests

```bash
# Run one test file
npx playwright test library-backend-selection.spec.ts

# Run tests matching a pattern
npx playwright test --grep "should not auto-submit"

# Run in headed mode (see the browser)
npx playwright test library-backend-selection.spec.ts --headed

# Run with specific reporter
npx playwright test library-backend-selection.spec.ts --reporter=line

# Run and generate HTML report
npx playwright test
npx playwright show-report
```

## Troubleshooting

### Tests Timeout Waiting for Elements

**Problem**: Test times out looking for UI elements.

**Solution**: Make sure you're navigating to `/` (home page), not `/wireframe` (legacy).

```typescript
// ✅ Correct
await page.goto('/');

// ❌ Wrong (legacy route)
await page.goto('/wireframe');
```

### Validation Errors in Console

**Problem**: Seeing validation errors like "IRI must be a non-empty string".

**Solution**: Check your mock data. All backends must have valid `endpoint` values.

```typescript
// ✅ Correct
endpoint: 'http://localhost:7878/sparql'

// ❌ Wrong
endpoint: ''
```

### Dialog Not Opening

**Problem**: `waitForSelector('[role="dialog"]')` times out.

**Solution**: Check that:
1. You clicked the correct button/section
2. The section is expanded before clicking add button
3. Mock data is properly set up

```typescript
// Ensure section is expanded first
const sectionToggle = librariesSection.locator('.section-toggle');
await sectionToggle.click();
await page.waitForTimeout(200); // Give it time to expand

// Then click add button
const addButton = librariesSection.locator('.add-button');
await addButton.click();
```

### Cannot Select Null Option

**Problem**: `selectOption('')` or `selectOption(null)` doesn't work.

**Solution**: Use label selector instead.

```typescript
// ✅ Correct - select by label
await backendSelect.selectOption({ label: 'None' });

// ❌ Wrong - can't select null value directly
await backendSelect.selectOption('');
await backendSelect.selectOption(null);
```

### Port Already in Use

**Problem**: Port 3000 or 3001 is already in use.

**Solution**: Kill existing processes.

```bash
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

### Playwright Browsers Not Installed

**Problem**: "Executable doesn't exist" error.

**Solution**: Install Playwright browsers.

```bash
cd packages/web
npx playwright install chromium
```

## Best Practices Summary

### ✅ DO

- Use valid mock data (proper IRIs, dates, etc.)
- Navigate to `/` (not `/wireframe`)
- Mock all required API endpoints
- Wait for `networkidle` after navigation
- Use semantic selectors (`getByRole`, `getByText`)
- Test for absence of loading states (e.g., "Creating..." should NOT appear)
- Use `waitForTimeout` sparingly (only when necessary)
- Add delays to API mocks when testing loading states
- Test both success and error cases

### ❌ DON'T

- Use empty strings for IRI fields
- Navigate to `/wireframe` (it's legacy)
- Forget to mock required endpoints
- Use hardcoded waits instead of proper expectations
- Try to select null values directly (use label instead)
- Skip testing that forms don't auto-submit
- Use `endpoint: ''` in mock backends

## Example: Complete Test File

See [library-backend-selection.spec.ts](../tests/e2e/library-backend-selection.spec.ts) for a complete, working example that demonstrates:

- Proper mock data setup
- Testing form behavior without auto-submission
- Testing multiple backend selections
- Testing loading states
- Testing state reset after dialog reopens
- Preventing Enter key from triggering submission

## Configuration

Key settings in `playwright.config.ts`:

- **Frontend URL**: `http://localhost:3001` (Nuxt dev server)
- **Backend API**: `http://localhost:3000` (expected by most tests)
- **Test directory**: `./tests/e2e`
- **Timeout**: 60 seconds per test
- **Workers**: 1 (sequential execution to avoid conflicts)
- **Browser**: Chromium only (fastest, sufficient for most testing)

## Additional Resources

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [PLAYWRIGHT_SETUP.md](../PLAYWRIGHT_SETUP.md) - Quick setup guide
