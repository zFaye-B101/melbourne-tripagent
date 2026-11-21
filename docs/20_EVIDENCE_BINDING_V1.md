# Evidence Binding v1

## Purpose

Evidence Binding v1 is a provider-neutral, fail-closed repair step between
Draft Schema validation and evidence validation. It addresses one mechanical
omission seen in provider output without asking the client to trust a new
interpretation.

## Frozen policy

- The input draft is deep-cloned; the provider draft is never mutated.
- The only allowed binding is `/geography/strength` from
  `/geography/scope`.
- At most one scalar evidence item may be added, by copying the existing
  quote and occurrence exactly. No `itemIndex` is added.
- No raw-text search is performed. The source coordinate must already exist.
- The existing coordinates must pass evidence validation with the target
  field temporarily omitted.
- The source quote and the complete raw request must both parse as textual
  Melbourne geography with exactly the same scope and hard/soft strength as
  the draft. Therefore “CBD” alone cannot prove a soft “主要在市内” claim.
- Dates, preferences, venues, budgets, arrays, unresolved requirements and
  all other paths are intentionally excluded. In particular, destination
  evidence is never in the binding allowlist.
- The repaired draft is run through schema, evidence and semantic validation
  again. Any failure falls back to the existing rules path.

The single local enable switch is provider-independent and defaults to on.
The public parser diagnostics and API shape are unchanged. An internal report
is available for tests and future observability and contains no raw text,
quote, or extracted value.
