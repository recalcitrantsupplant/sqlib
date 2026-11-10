/**
 * Two layouts of one JSON text, for an `rdf:JSON` literal.
 *
 * Both work on the characters rather than on `JSON.parse` output, so the
 * tokens survive exactly as typed: `1.0` stays `1.0` and `é` stays an
 * escape. Only the whitespace between tokens changes, and JSON gives that
 * whitespace no meaning, so the compact and the expanded text are the same
 * value to anything that reads it.
 */

export type JsonLayout = 'compact' | 'expanded';

export type JsonCheck = { ok: true } | { ok: false; message: string };

export function parseJson(text: string): JsonCheck {
  try {
    JSON.parse(text);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

const WHITESPACE = /\s/;

/** Every token, in order, with the whitespace between them dropped. */
function tokens(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (WHITESPACE.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out.push(text.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if ('{}[]:,'.includes(ch)) {
      out.push(ch);
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && !WHITESPACE.test(text[j]) && !'{}[]:,"'.includes(text[j])) j += 1;
    out.push(text.slice(i, j));
    i = j;
  }
  return out;
}

export function compactJson(text: string): string {
  return tokens(text).join('');
}

export function expandJson(text: string, indent = '  '): string {
  const list = tokens(text);
  let depth = 0;
  let out = '';
  const newline = () => `\n${indent.repeat(depth)}`;
  list.forEach((token, index) => {
    if (token === '{' || token === '[') {
      const next = list[index + 1];
      // `{}` and `[]` stay on one line: an empty object is not a block.
      if (next === '}' || next === ']') {
        out += token;
        return;
      }
      depth += 1;
      out += token + newline();
    } else if (token === '}' || token === ']') {
      const previous = list[index - 1];
      if (previous === '{' || previous === '[') {
        out += token;
        return;
      }
      depth = Math.max(0, depth - 1);
      out += newline() + token;
    } else if (token === ',') {
      out += `,${newline()}`;
    } else if (token === ':') {
      out += ': ';
    } else {
      out += token;
    }
  });
  return out;
}

export function layoutJson(text: string, layout: JsonLayout): string {
  return layout === 'expanded' ? expandJson(text) : compactJson(text);
}
