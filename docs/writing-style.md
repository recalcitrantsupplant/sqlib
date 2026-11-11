# Writing style

These rules apply to the documentation of sqlib: the files under `docs/`, the README of each package, commit messages, issues, pull requests and code comments. Code, quoted text and data keep their own form. On-screen text in the web app follows [CLAUDE.md](../CLAUDE.md) also.

## Voice

Write like an engineer who writes a specification or the methods section of a paper. Put the fact, the action or the answer first. Then give the reason, with the evidence or the condition that supports it. Stop when the reader has what they need.

Give evidence: counts, timings before and after a change, a link to the line of code, or a query that shows the result. Say how sure you are. Write "I think X, because Y" or "I have not tested X". Say what you have not checked.

Write about 80% of the way to ASD-STE100 Simplified Technical English:

- Use sentences of at most 20 words for instructions and 25 words for descriptions.
- Give one instruction per sentence, in the imperative.
- Use the active voice and simple tenses.
- Use one word for one meaning. Keep the same term for the same thing in the whole text.
- Use common words. Keep a technical term when it names the thing exactly.
- Do not use noun clusters of more than three words.
- Keep paragraphs to six sentences or fewer, with one topic each.
- Keep every fact, number, condition and caveat. A shorter text must keep all of the information.

## Contrasts

Say what a thing is and what it does. Do not define it by what it is not.

- A contrast is correct only when both sides are real: two options the reader can choose, a mistake the reader is likely to make, or a reading that someone has stated. Name both sides and the result of each.
- Test each contrast: delete the negated half. If the reader loses nothing, leave it deleted.
- The rule applies to every form of the pattern: "not X but Y", "X, not Y", "not just X, it is Y", "Y rather than X", "Y instead of X", "less X, more Y", "no X, no Y, just Z", "is not A; it is B".

Example. Write: "The runtime rejects a bundle with a newer major version. Its fields are offsets into the query text, so a partial read would edit the wrong text." Do not write: "The runtime refuses it rather than reading the half it recognises, so it is wrong rather than broken."

## Hooks and reveals

Give the point in the first sentence about it. Do not build up to it.

- Do not use hook phrases: "the catch", "here's the thing", "the trick", "the key insight", "gotcha", "what bites people", "it turns out", "the short version".
- Do not ask rhetorical questions, and do not answer your own question.
- Do not use a colon to reveal a result, as in "The fix: ...". Write a full sentence.
- Do not end a paragraph with a maxim that restates it, such as "a test, not an intention".
- Put a warning next to the step it affects. State the condition and its effect.

Example. Write: "A screen that still moves after 2 s has a layout loop. The total-shift metric hides it, because one large shift and many small repeated shifts can give the same total." Do not write: "A screen still relaying itself out two seconds in is not loading, it is looping."

## Other habits to avoid

- Em dashes and en dashes between clauses. Use a full stop, a comma, a colon before a list, or parentheses.
- Sales and importance words: powerful, seamless, robust, elegant, crucial, key, simply, just, easy.
- Filler: "it's worth noting", "importantly", "in fact", "as you can see".
- Telling the reader how to feel or what they expected.
- Groups of three by habit. Use the number of items that exist.
- Bold for emphasis in prose. Use bold only for a term where you define it, or for a list label.
- Claims without scope: "always", "never", "safe", "free". Give the condition or the evidence.
- A guessed reason stated as a fact. Say which reasons are recorded and which are your inference.

## References

Make each definite reference clear on its own. Give the file name, path, command, URL or value once, then use a short form. A commit message, issue title, table row or tooltip has no context, so treat it as a first mention.

## Structure

Use literal headings in sentence case. Use numbered lists for steps, tables for comparisons, and paragraphs for reasons. For status, give two lists: done, and to do. For a design reason, state the need first, then list the considerations. Ask a question only when you need the answer, and name who must answer it. When a structure, flow or comparison is easier to see than to read, use a diagram or an HTML page.

## Before you send

Read the draft once against these rules. Rewrite each contrast, hook, reveal, dash and maxim that you find. Do not replace a pattern with another form of the same pattern.
