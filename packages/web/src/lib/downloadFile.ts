/**
 * Hand a string to the browser as a file.
 *
 * An object URL rather than a `data:` one: a suite of a few hundred cases makes
 * a report far past the length a URL can safely carry, and the revoke below is
 * what keeps the blob from outliving the click.
 */
export function downloadTextFile(content: string, filename: string, contentType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * The name a `Content-Disposition` asks for, or null when it names none.
 *
 * The server names the file it just rendered, so the SPA does not have to keep
 * a second table of extensions in step with the format registry. A quoted
 * filename is the only form these responses use; anything else falls back to
 * the caller's own name rather than guessing at an encoding.
 */
export function filenameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}
