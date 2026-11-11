<!--
The handoff note (docs/handoffs/<ID>.md) is the PR body. Open with:
  gh pr create --body-file docs/handoffs/<ID>.md
Format: docs/impl/README.md §6. Delete any section that doesn't apply, except Acceptance.
-->

# <ID> <title>

Status: done | blocked | partial

## What changed

- one line per module or file

## Acceptance

- [ ] each acceptance item from the card, with the test or command that proves it

## Decisions

- OPEN choices made, one line each with the reason (the orchestrator copies these to `docs/decisions.md`)

## New dependencies

- name@version: why, gzip size

## Notes for downstream tasks

- anything a later task must know (APIs beyond the contract, gotchas, TODOs left on purpose)

## Contract change request / Questions

- (empty if none)

Closes #<issue>
