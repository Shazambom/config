# Lessons from UI Expert runs

Condensed and general, newest first. Added during the Phase 8 post-run audit whenever a run surfaces a reusable rule, rubric gap, or failure mode.

- **2026-11-22: Keep the auditor blind to source code during Phase 2.** Reading domain formulas or component variable names first hides jargon collisions (such as "Bleed" colliding with a game combat ailment). Always feed the blank-slate auditor screenshots and domain user context only, then let independent verifiers inspect code in Phase 3.
- **2026-11-22: Audit both dark and light themes every time.** Light themes (especially warm parchment/cream palettes) frequently break gold/yellow rarity headings, mute secondary metadata, and invert badge prominence even when dark mode looks crisp.
- **2026-11-22: Never repeat a macro metric as a per-row alert.** Repeating one global currency or market drift percentage across dozens of rows creates a loud wall of noise and pushes low-value clutter above high-value items needing action. Put macro context in one top banner and reserve row badges for item-level verdicts.
- **2026-11-22: Verify live platform caps before designing workflow helpers.** Older community guides often cite stale limits (for example, PoE 2 raised stash/merchant search bars from 50 to 250 characters in Patch 0.5.0). Verifiers must check current platform and API limits so batch tools use real headroom.
- **2026-11-22: Keep inspection actions non-destructive.** Clicking "price check" or "inspect" on a triage table must not hijack top-level navigation or write permanent entries into an unrelated saved workspace sidebar. Prefer inline drawers or temporary previews with an explicit opt-in save action.
