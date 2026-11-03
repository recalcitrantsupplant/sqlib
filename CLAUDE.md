# Instructions for agents

## On-screen text in the web app and in mocks

These rules apply to every screen in `packages/web` and to every mock or
design page you make for it.

The design must explain itself. Do not put notes on the screen that explain
the screen.

Do not show:

- Sentences that explain what a control, badge or state means
  ("X marks Y", "This moves now because you hold...").
- Server internals: environment variable names, API routes, HTTP status
  codes, response headers, grant or mode names, entity or field names from
  the code.
- Design rationale, or notes on what a later phase will change.
- Reassurance or filler ("Nothing changes yet", "You can change this later").

Make the meaning clear with design instead:

- A short, exact label or button text ("Move prod to v4", "Delete prod").
- Placement and grouping, an icon, a pill, a colour for state.
- A control that is hidden or disabled when the user cannot use it.

When the design still cannot make something clear, add a tooltip. Use the
`title` attribute, as the rest of the app does. Keep it to one short
sentence.

Text that is allowed on the screen:

- Labels, values and data (names, versions, dates, who did what).
- An error that says what went wrong and the one action that fixes it.
- Before an action that cannot be undone, a short list of its effects in
  the user's terms ("2 published tools stop working").
- An empty state: one line that names what is missing, and the button that
  adds it.

Put explanation and rationale in the design document or the pull request,
next to the mock. Never put it inside the mocked screen.
