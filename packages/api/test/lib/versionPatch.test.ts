/**
 * The version PATCH allowlist, on its own.
 *
 * Eight routes share this classifier, so the rule it encodes — comment yes,
 * freeze yes, content no, unfreeze never — is worth stating once here rather
 * than eight times through HTTP.
 */
import { describe, it, expect } from 'vitest';
import { classifyVersionPatch } from '../../src/lib/versionPatch.js';

describe('classifyVersionPatch', () => {
  it('lets the comment through', () => {
    expect(classifyVersionPatch({ comment: 'the one that fixed the timeout' })).toEqual({
      annotations: { comment: 'the one that fixed the timeout' },
      rejection: null,
    });
  });

  it('lets a null comment through, because clearing one is still annotating', () => {
    expect(classifyVersionPatch({ comment: null }).annotations).toEqual({ comment: null });
  });

  it('refuses content and names every offending field', () => {
    const { annotations, rejection } = classifyVersionPatch({
      queryString: 'SELECT * {}',
      canvasData: '{}',
    });

    expect(annotations).toEqual({});
    expect(rejection).toEqual({
      status: 409,
      error: 'Version is immutable; create a new version instead.',
      fields: ['canvasData', 'queryString'],
    });
  });

  it('refuses the whole body when content rides along with an annotation', () => {
    // Partly applying it would leave the caller unable to tell what happened.
    const { annotations, rejection } = classifyVersionPatch({ comment: 'fine', queryString: 'SELECT * {}' });
    expect(annotations).toEqual({});
    expect(rejection?.fields).toEqual(['queryString']);
  });

  it('allows the freeze transition and refuses its reverse', () => {
    expect(classifyVersionPatch({ immutable: true }).annotations).toEqual({ immutable: true });
    expect(classifyVersionPatch({ immutable: false }).rejection).toEqual({
      status: 409,
      error: 'A version cannot be unfrozen; create a new version instead.',
      fields: ['immutable'],
    });
  });

  it('answers a system field with 400 rather than the immutability 409', () => {
    // Renumbering or re-parenting a version is a different mistake from trying
    // to edit one, and saying "immutable" would misdescribe it.
    const { rejection } = classifyVersionPatch({ version: 2 });
    expect(rejection?.status).toBe(400);
    expect(rejection?.error).toContain("Cannot update system field 'version'");
  });

  it('skips absent values and the keys a route declares are not its content', () => {
    const { annotations, rejection } = classifyVersionPatch(
      { comment: undefined, dateModified: 'now' },
      { ignore: ['dateModified'] }
    );
    expect(rejection).toBeNull();
    expect(annotations).toEqual({});
  });

  it('treats an unrecognised field as content rather than dropping it', () => {
    expect(classifyVersionPatch({ notAField: 1 }).rejection?.fields).toEqual(['notAField']);
  });
});
