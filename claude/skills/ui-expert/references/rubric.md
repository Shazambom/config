# UI and UX evaluation rubric

Judge interfaces using concrete, observable traits rather than vague taste. Score each of the 8 factors from 0 to 10, assign relevancy weights that sum to 100% for the target interface type, and compute the weighted composite score.

## Scoring scale (0 to 10 per factor)

- **9 to 10 (Excellent):** Clear on first glance, zero jargon or visual strain, supports expert speed without confusing first-time users.
- **7 to 8 (Solid):** Main task works cleanly with minor friction or small polish gaps.
- **5 to 6 (Mixed):** Usable after trial and error, but forces guessing, squinting, extra clicks, or mental math.
- **3 to 4 (Poor):** Frequent confusion, misleading labels, broken visual hierarchy, or contrast/navigation failures that slow real work.
- **0 to 2 (Broken):** Actively misleads users, blocks core tasks, or fails basic readability/accessibility.

Weighted composite score:
- Out of 10: `sum(weight_i * score_i) / 100`
- Out of 100: `sum(weight_i * score_i) / 10`

---

## The 8 evaluation factors

### 1. Mental model and domain fit (UX)
- **Good UX:** Structure, grouping, and concepts match how real users think about their job. Surfaces the questions users actually ask in the order they ask them.
- **Bad UX:** Leaks internal database columns, developer abstractions, or finance/engineering formulas directly into the UI. Groups items by backend properties instead of user decisions.

### 2. Actionability and decision clarity (UX)
- **Good UX:** Tells the user what needs attention and what to do next in under 2 seconds. Translates raw signals into clear, plain-language verdicts or primary next steps.
- **Bad UX:** Dumps raw numbers, percentages, or repeated macro stats on every row and forces the user to do mental math to figure out whether to act. Flags high-value and worthless items with identical urgency or backwards priority.

### 3. Copy, terminology, and information scent (UX / UI)
- **Good UI/UX:** Uses the exact vocabulary real users speak. Labels units explicitly alongside icons (`1 div`, `2c`, `50 ex`, `$12/mo`). Button text names the real user outcome (`Find in tab`, `Price check`). Metric labels match real-world meaning honestly.
- **Bad UI/UX:** Collides with domain terms (using a combat/domain word to mean a finance metric). Puts raw code or regex syntax (`Copy ^Name$`) or unrelated slang (`Check floor`) on buttons. Relies on tiny unlabeled 14px icons for critical values. Mislabels speculative numbers as realized or pending money.

### 4. Visual hierarchy, scannability, and signal-to-noise (UI)
- **Good UI:** Guides the eye cleanly from highest priority to secondary detail. Uses **icon + color + text** for actionable statuses (about 37% faster scanning per NN/g). Keeps nominal/healthy states visually quiet (plain text or small neutral dot) so urgent items pop. Balances density with whitespace and clean column alignment (left-align text, right-align tabular numbers).
- **Bad UI:** Creates a "rainbow table" or wall of identical bright pills where every row screams equally and nothing stands out. Repeats one global/macro warning on dozens of rows. Leaves large dead voids in drawers or expanded panels while cramming key context into hover-only tooltips.

### 5. Workflow continuity, controls, and batch efficiency (UX)
- **Good UX:** Lets users inspect details, compare options, or price-check without losing scroll position or hijacking top-level navigation. Provides sorting, filtering, and search tailored to real cleanup/work tasks. Surfaces highest-value or most urgent records first. Supports both single-record actions (1 to 2 inline controls) and bulk workflows (checkboxes + contextual batch bar + undo) for repetitive chores.
- **Bad UX:** Forces full-page navigation jumps with no back path. Pollutes unrelated saved workspaces or sidebars as a side effect of one-off inspection. Hides critical row actions behind hover-only states or forces 30 individual clicks for a batch job. Leaves global controls (like timeframe pickers) visually disconnected from the view.

### 6. Affordances, states, and transparency (UI / UX)
- **Good UI/UX:** Interactive elements look interactive (expand chevrons, clear button hierarchy, focus states). Empty/setup states explain what the screen does and present one clear primary CTA. Partial data, caps, and pagination are explicit and honest (`Showing 50 of 164`, with a clear way to load more or change sort). Toasts confirm *what* happened and how to use it.
- **Bad UI/UX:** Clickable rows have zero expand affordance. Duplicate competing primary buttons appear on setup screens. Premature empty filters clutter unconfigured screens. Silent truncation hides records without explaining which slice is shown. Auth walls or errors trap users with no recovery path.

### 7. Accessibility, contrast, and theme integrity (UI)
- **Good UI:** Passes WCAG 2.2 AA contrast across every supported theme (`>= 4.5:1` body text, `>= 3:1` large text, icons, borders, and focus indicators) and feels comfortably legible under APCA perceptual checks. Never relies on color alone to convey rarity, status, or errors. Keeps interactive targets `>= 24x24` CSS px (WCAG 2.2 SC 2.5.8) and preserves crisp keyboard focus rings.
- **Bad UI:** Breaks on light themes (yellow/gold text or 4px dots vanishing on cream/white surfaces, washed-out muted labels, inverted badge salience). Uses tiny color-only dots to separate critical item tiers. Omits keyboard navigation, `aria-expanded`, or accessible button labels.

### 8. Progressive disclosure and restraint (UX / UI)
- **Good UI/UX:** Shows decision essentials on the main surface, moves deeper inspection and secondary controls into an expanded panel, side drawer, or compact popover, and avoids unnecessary settings sprawl. Uses both sides of wide detail drawers purposefully.
- **Bad UI/UX:** Either overloads every row with secondary metadata or hides essential decision rationale where users cannot discover it. Adds knobs for problems that should be solved by better defaults.

---

## Relevancy weighting profiles (must sum to 100%)

Pick the closest archetype below and adjust weights to match the product's real risks. State the final weight table in the audit report.

| Factor | Triage / Data Dashboard | Form / Onboarding Flow | Workspace / Power Tool | Content / Marketing |
| :--- | :---: | :---: | :---: | :---: |
| 1. Mental model & domain fit | 18% | 15% | 18% | 15% |
| 2. Actionability & decision clarity | 20% | 15% | 14% | 15% |
| 3. Copy, terminology & scent | 14% | 18% | 12% | 22% |
| 4. Visual hierarchy & scannability | 14% | 12% | 14% | 20% |
| 5. Workflow continuity & efficiency | 14% | 12% | 20% | 6% |
| 6. Affordances, states & transparency | 8% | 14% | 10% | 8% |
| 7. Accessibility, contrast & themes | 8% | 8% | 8% | 10% |
| 8. Progressive disclosure & restraint | 4% | 6% | 4% | 4% |
| **Total** | **100%** | **100%** | **100%** | **100%** |

When auditing a themed app where light/dark contrast is a known risk, or an accessibility-critical flow, raise Factor 7 to 12% to 15% and trim lower-relevancy weights proportionally.
