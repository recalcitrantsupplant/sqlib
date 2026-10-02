# Design: where the assistant runs, and who pays for it

**Status: decided, mostly unbuilt.** The MCP connector exists and is shipped.
The in-app assistant's server half exists (`packages/api/src/routes/assistant.ts`)
and has no way to obtain a credential, which is why its screen was removed. The
Agent SDK lane is not started. This page records why the lanes are what they
are, so the reasoning is not re-derived from scratch in three months.

## The question

sqlib can put a Claude conversation in front of a user in more than one place,
and the places differ in who supplies the credential rather than in what the
model can do. The credential decides everything else: what can be hosted, what
has to run on the user's machine, what costs sqlib money, and what is allowed
by Anthropic's terms. This page fixes the lanes and says which code serves
each.

## The lanes

| Lane | Where the agent runs | Whose credential | Serving code |
| --- | --- | --- | --- |
| A. MCP connector | Claude or ChatGPT | Their subscription | `packages/mcp-server`. Shipped |
| B. In-app, bring your own key | sqlib, local or hosted | Their API key | `/assistant`. Built, needs a key field |
| C. In-app, hosted | sqlib's servers | sqlib's API key, billed on | `/assistant` plus metering |
| D. In-app, local | The user's machine | Their Claude subscription | Claude Agent SDK. Unbuilt |

B and C are the same code path and differ only in whose key is passed. That is
the single most useful fact on this page: the paid hosted offer is a billing
problem, not an engineering one.

## Why hosted-on-a-subscription is not a lane

It is the option everyone reaches for first, and it does not exist. A Claude
subscription authenticates a person on a machine they control; the credentials
live under `~/.claude` and a hosted server has no path to them. The only way to
get one server-side is to have users hand over a token, and the
[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) closes
that:

> Unless previously approved, Anthropic does not allow third party developers to
> offer claude.ai login or rate limits for their products, including agents
> built on the Claude Agent SDK. Use the API key authentication methods
> described in the Quickstart instead.

The permitted pattern and the prohibited one differ by where the code runs, not
by how the token is stored. An application on the user's machine using the login
they already have is lane D and is explicitly covered: Anthropic's help centre
lists "third-party apps that authenticate with your Claude subscription through
the Agent SDK" among the things a plan covers. A service that brokers that login
is not a lane at all.

Lane A is how a hosted sqlib reaches a subscription, and it does so by inverting
the direction: Claude calls sqlib rather than sqlib calling Claude. Anything
that feels like "hosted plus subscription" is lane A wearing a different hat.

## Why the Agent SDK is only for lane D

The Claude Agent SDK is Claude Code as a library: it runs the Claude Code binary
as a subprocess, with that binary's built-in tools, sessions, permissions and
context management. Three consequences decide its place here.

Its distinguishing advantage is the credential. On the user's own machine it
reaches a subscription that nothing else can reach, which is the whole of lane
D's value.

With an API key in hand that advantage is gone, and what remains is a harness
whose built-in Read, Write, Edit and Bash tools are things sqlib would have to
switch off, running as a subprocess per session. In a multi-tenant host that is
an operational and security cost paid for capabilities the product does not
want.

It is also not a drop-in provider. `packages/api/src/assistant/service.ts` owns
the loop, the tool registry and the session; the Agent SDK owns all three
itself. Lane D is therefore a second path that streams the SDK's events into the
existing SSE shape, not a third entry beside `anthropic` and `openai` in
`assistant/model.ts`. Anyone who plans it as the latter will discover this
several days in.

## What lane D also requires, and will get wrong

An `ANTHROPIC_API_KEY` in the environment silently takes precedence over a
subscription login. The session works, the user is billed API rates, and nothing
in the product says so. Lane D needs to detect that and say which credential it
is about to use, rather than documenting it.

Usage draws on the user's ordinary plan limits. A separate monthly Agent SDK
credit was announced for 15 June 2026 and then paused, so as of this writing
there is no separate allowance (see
[Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)).

Branding is constrained: "Claude Agent" or "Powered by Claude" are permitted,
"Claude Code" is not.

## What lane C requires before it is priced

The system prompt is the catalogue guide plus the tool definitions, it is
identical on every request, and it is large. Cached and uncached reads of it
differ by roughly an order of magnitude on the input side, which is enough to
change what the product would have to charge. Prompt caching is therefore a
prerequisite of pricing lane C, not an optimisation to do afterwards.

## Ordering

1. **Lane B.** A key field on the existing assistant. Close to no new code,
   works local and hosted, and it is the cheapest way to learn whether anyone
   wants in-app chat before paying to build the other two.
2. **Lane C**, if B shows demand. Metering, quotas and abuse controls on the
   same path, with caching in place first.
3. **Lane D** as a local perk, and only if the "stay in sqlib" feeling turns out
   to matter to people who could already use lane A.

Lane A is done, and it narrows the others. MCP Apps puts the query bench inside
Claude, so the editor, the arguments and the result table are already there.
What is outside is the library tree, the notebook view and everything
multi-pane. That remainder is the whole value of lanes B through D, and it is
smaller than it was before the bench existed.

## The components that are waiting

`packages/web/src/components/build/` holds the assistant chat and the callable
table from the removed Build screen. They are unreferenced and kept
deliberately: they are lane B's front end. If lane B is abandoned, they should
go with it rather than sit there indefinitely.
