import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapQueryGroupCanvas,
  GROUP_ID,
  GROUP_NAME,
  LIBRARY_NAME,
  openCanvasEditorTab,
  selectSidebarQueryGroup,
} from './query-group-test-helpers';

/*
 * The canvas features that came out of the query groups review: undo and redo,
 * a draft that outlives the page, and Run on a canvas with unsaved edits.
 */

const openGroupCanvas = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
  await openCanvasEditorTab(page);
};

const draftNodes = (page: Page) => page.locator('.vue-flow__node[data-id^="urn:ui-temp:node-"]');
const addQueryNode = (page: Page) => page.locator('.add-node-toolbar button[title="Add Query Node"]').click();

test.beforeEach(async ({ page }) => {
  await bootstrapQueryGroupCanvas(page);
});

test('undo takes an added node back, and redo puts it back', async ({ page }) => {
  await openGroupCanvas(page);
  const undo = page.getByTestId('canvas-undo');
  const redo = page.getByTestId('canvas-redo');
  await expect(undo).toBeDisabled();

  await addQueryNode(page);
  await expect(draftNodes(page)).toHaveCount(1);
  await expect(undo).toBeEnabled();

  await undo.click();
  await expect(draftNodes(page)).toHaveCount(0);
  await expect(redo).toBeEnabled();

  await redo.click();
  await expect(draftNodes(page)).toHaveCount(1);
});

test('unsaved edits are kept as a draft across a reload, and Discard drops them', async ({ page }) => {
  await openGroupCanvas(page);
  await addQueryNode(page);
  await expect(page.getByTestId('discard-draft')).toBeVisible();
  // The draft is written once the canvas has been still for a moment.
  await page.waitForTimeout(1000);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openGroupCanvas(page);
  await expect(draftNodes(page)).toHaveCount(1);
  await expect(page.getByTestId('discard-draft')).toBeVisible();

  await page.getByTestId('discard-draft').click();
  await expect(draftNodes(page)).toHaveCount(0);
  await expect(page.getByTestId('discard-draft')).toHaveCount(0);
});

test('Run with unsaved edits sends the canvas as a draft and saves nothing', async ({ page }) => {
  await openGroupCanvas(page);
  await page.locator('.vue-flow__node').first().waitFor();
  await page.getByTestId('canvas-undo').waitFor();

  // Move a node: an edit that keeps the group runnable.
  const node = page.locator('.vue-flow__node').last();
  const box = await node.boundingBox();
  await page.mouse.move(box!.x + 4, box!.y + 4);
  await page.mouse.down();
  await page.mouse.move(box!.x + 60, box!.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('discard-draft')).toBeVisible();

  const requests: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/execute') && request.method() === 'POST') {
      requests.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  const executed = page.waitForResponse((response) => response.url().endsWith('/execute'));
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await executed;

  expect(requests).toHaveLength(1);
  expect(requests[0]!.draftVersion).toBeTruthy();
  expect(requests[0]!.targetId).toBe(GROUP_ID);
});
