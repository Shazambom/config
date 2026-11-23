# Recorded UI and UX findings and sources

Last refreshed: 2026-11-22

The Phase 1 research subagent reads this file, checks live industry sources for updates relevant to the target interface and domain, and updates stale entries before Phase 2 starts.

---

## Core usability and interaction standards

### Nielsen Norman Group (NN/g)
- **10 Usability Heuristics for User Interface Design** (updated Jan 2024)
  `https://www.nngroup.com/articles/ten-usability-heuristics/`
  Core rules: visibility of system status, match between system and real world (speak the user's language, follow real-world conventions), user control and freedom (clear exits and undo), consistency and standards, error prevention, recognition rather than recall, flexibility and efficiency of use, aesthetic and minimalist design, error diagnosis and recovery, and task-focused help.
- **10 Usability Heuristics Applied to Complex Applications** (Aug 2021)
  `https://www.nngroup.com/articles/usability-heuristics-complex-applications/`
  Key finding: in dense enterprise or specialist apps, competing visual signals slow visual search dramatically. Critical exceptions must stand out while routine/healthy items stay quiet.
- **Data Tables: Four Major User Tasks** (Apr 2022)
  `https://www.nngroup.com/articles/data-tables/`
  Enterprise and operational tables must directly support four tasks: (1) find records matching criteria (search, quick filters, sort), (2) compare data across aligned columns, (3) view/edit a single record in context (inline expansion or side drawer, never breaking scroll context), and (4) act on single records (1 to 2 inline actions, never hover-only) or batches (checkboxes + contextual bulk bar + explicit selection scope + undo).
- **Visual Indicators to Differentiate Items in a List** (Aug 2016)
  `https://www.nngroup.com/articles/visual-indicators/`
  Quantitative finding: users locate target items roughly **37% faster** when visual indicators combine **color and icon** compared to text alone, and icons with clear information scent outperform color alone.
- **Indicators, Validations, and Notifications: Pick the Correct Communication Option** (Jan 2024)
  `https://www.nngroup.com/articles/indicators-validations-notifications/`
  Distinguish passive status indicators from inline validations and transient notifications; match interruption level to urgency.
- **Progressive Disclosure** & **Few Guesses, More Success: 4 Principles to Reduce Cognitive Load in Forms** (Jul 2025)
  `https://www.nngroup.com/articles/progressive-disclosure/`
  Keep the primary screen focused on default decision essentials; move secondary details, advanced thresholds, and rare actions into expandable panels, drawers, or popovers so both novices and experts move faster.
- **Designing Empty States in Complex Applications: 3 Guidelines** (Sep 2021)
  `https://www.nngroup.com/articles/empty-state-interface-design/`
  Empty and setup states must communicate system status, teach what the screen does, and provide one clear direct path to start. Avoid showing dead filter chrome or duplicate competing buttons before setup completes.

---

## Accessibility, contrast, and visual readability

- **W3C WCAG 2.2** (W3C Recommendation)
  `https://www.w3.org/TR/WCAG22/`
  - **SC 1.4.3 Contrast (Minimum):** at least `4.5:1` for normal text and `3:1` for large text (`>= 18pt` or `>= 14pt` bold).
  - **SC 1.4.11 Non-text Contrast:** at least `3:1` for UI control boundaries, icons carrying meaning, and graphical status indicators against adjacent surfaces.
  - **SC 1.4.1 Use of Color:** never use color as the sole means of conveying status, rarity, or errors.
  - **SC 2.4.11 / 2.4.13 Focus Not Obscured & Focus Appearance:** keyboard focus must stay visible with high contrast.
  - **SC 2.5.8 Target Size (Minimum):** pointer targets at least `24x24` CSS px (or adequately spaced).
- **APCA (Accessible Perceptual Contrast Algorithm, WCAG 3 working draft)**
  `https://git.apcacontrast.com/`
  Perceptual lightness polarity matters across themes: yellow/gold text or muted gray captions that look fine on dark charcoal often become unreadable on warm cream or light backgrounds even when hues match. Always verify light and dark themes separately.

---

## Triage dashboards, badges, and bulk workflows

- **Badges vs Chips / Tags** (Atlassian Design System, Dell Design System)
  - `https://atlassian.design/`
  - `https://www.delldesignsystem.com/`
  Keep **status badges** strictly read-only and **filter chips/tags** interactive. Rank visual weight by urgency: bold/filled or high-contrast badge for urgent actions, lighter tint/outline for secondary actions, and plain text + subtle neutral dot for healthy/nominal rows to avoid the "rainbow table" trap.
- **Triage defaults and non-destructive inspection** (NN/g, Pencil & Paper enterprise table patterns)
  - Default sort operational queues by urgency or highest value at risk rather than alphabetical order or oldest low-value clutter.
  - Inspect details or run one-off comparisons in an inline drawer or side panel so the user keeps their place in the queue and never pollutes saved workspaces.
  - Avoid repeating one global/macro fact on every row; surface macro alerts once in a compact top banner and reserve row badges for record-specific decisions.

---

## Domain workflow research benchmark (Example: Game economy and inventory triage)

Always pair generic UX standards with live research into how real users perform the job in-domain (Reddit, wikis, community tools). Recorded findings from Path of Exile 2 Merchant Tab / async trade research (2026-11-22):
- **Real user mental model beats raw metrics:** Players cleaning unsold listings ask "what do I vendor/disenchant, what do I cut hard, what is at risk of getting sniped, and what is fresh?" rather than "what is my soft-currency bleed percentage?"
- **In-game constraints shape UX wins:** PoE 2 Ange Merchant Tabs lack in-game listing age and whole-tab buyout pricing, use `Ctrl+Right-Click` to relist at the last typed price, and since Patch 0.5.0 (May 2026) support **250-character** search textboxes (up from 50 chars), enabling 10 to 15 item batch highlight regexes in one paste.
- **Proven community tool patterns:**
  - **WealthyExile:** separates low-value "dust" from meaningful value so cleanup starts where money actually sits.
  - **Auctionator:** runs comparable price checks inline without destroying the user's cancel/reprice table position.
  - **PoEMarcut:** accelerates steep waterfall price cuts instead of tiny incremental tweaks.

---

## How Phase 1 refreshes this file

When the Phase 1 research subagent checks current industry standards:
1. Verify whether any standard above changed (for example: WCAG 2.2 / WCAG 3 APCA guidance, new NN/g research on tables, AI/dashboard UX, or platform-specific HIG/Material shifts).
2. Research current user workflows for the specific domain being audited.
3. Update this file only with verified, durable findings and concrete URLs (never speculative trends or unverified blog fluff), and update `Last refreshed` to the current date.
