---
name: artifact
description: Manually invoked design pass that builds one self-contained HTML page (explainer, report, dashboard, tool, or diagram) with deliberate type, color, layout, both themes, and diagrams that show mechanisms. Use only when the user explicitly invokes artifact.
disable-model-invocation: true
---

# Artifact

Run this workflow only when the user explicitly invokes `/skill:artifact`, `/artifact`,
or asks to use the artifact skill. A request for a page, a report, or a diagram is not
an invocation by itself, and neither is an agent's suggestion. Do not load or delegate
this workflow on your own initiative.

The output is one HTML file that opens straight from disk and reads well on a phone and
a desktop, in light and dark themes. Write it where the user asks. If they name no
location, use the session's scratch or temporary directory and report the path.

Precedence never changes: the user's own words, then the project's existing design
system, then your choices. Everything below fills gaps and never overrides the first two.

## The pass

These steps run in order. Steps 1 through 5 are decisions, step 7 is the only one that
writes the page, and step 8 is the only look you get.

1. **Read the request.** Pin one concrete subject, its audience, and the page's single
   job. Then pick the treatment. A plan, memo, explainer, or demo is *utilitarian*:
   real typographic hierarchy, considered spacing, a proper palette, few flourishes. A
   landing page, game, or tool people keep or share is *editorial*: a distinct point of
   view and one real aesthetic risk. Every request gets designed; the treatment only
   sets where the craft goes. When unsure, a well-composed utilitarian page is never
   wrong and an over-designed one sometimes is.
2. **Ask what the viewer does.** If they only read, skip ahead. If they enter input,
   need state kept between visits, see live data, or share state with other viewers,
   use whatever persistence or data capability the host provides and design around it.
   Browser storage (`localStorage`, IndexedDB) is per viewer and can vanish or throw, so
   wrap every access in try/catch, render correctly without it, and use it only for
   conveniences such as a remembered tab.
3. **Honor what's already there.** Look for a design system before choosing anything:
   project instructions, a tokens or theme file, existing component styles, brand
   assets. Check whether it applies to this page's subject. A product's brand on a page
   that isn't about the product is the wrong system.
4. **Ground it in the subject.** Distinctive choices come from the subject's own world:
   its materials, instruments, vernacular, units, and document conventions. Carry at
   least one detail only this subject would have, as content and not ornament. Use real
   content throughout, never lorem ipsum.
5. **Write the design plan and show it to the user before any code.**
   - Color: 4 to 6 named hex values, plus the dark-theme counterparts.
   - Type: a characterful display face used with restraint, a body face, and a utility
     face for captions, code, or data if needed.
   - Layout: one or two sentences.
   - Name the one place the page spends its boldness.
6. **Editorial treatment only: review the plan against the defaults.** Check every part
   against the AI-default looks listed below and anything you would produce for any
   similar page. Revise what's generic, say what changed and why, then build from the
   revised plan exactly. Utilitarian pages skip this step.
7. **Build from the tokens.** Every color and type decision in the code derives from
   the plan. Load any separate diagram guidance before drawing the first figure; the
   rules in the Diagrams section below apply to every figure on the page.
8. **Look once.** Render the page one time (a screenshot or preview), make one pass of
   fixes for what it shows, and do not look again. For a page that charts real numbers,
   spend the look on the chart. Do not build a test loop around your own file: no
   repeated screenshots, no DOM-probing scripts, no running the page's script through
   another runtime.
9. **Deliver, then stop.** Give the path (or link), say what the page contains, name any
   place you departed from this skill and why, and say what the one look did and did not
   cover. Further polish is the user's to ask for. If they report something visibly
   broken, fix it and deliver once more.

## Fundamentals

### File and skeleton

- Write a complete document (`<!doctype html>`, `<html lang>`, `<head>` with
  `<meta charset="utf-8">` and `<meta name="viewport" content="width=device-width,
  initial-scale=1, viewport-fit=cover">`). A page opened from disk has nothing else to
  supply those. Omit the skeleton only when the host documents that it wraps the page.
- Put `<title>` and `<style>` at the top of `<head>`.
- Keep the page self-contained. Inline your CSS, JS, data, and images (`data:` URIs).
  Load fonts from Google Fonts with a real fallback stack on every face. Load a library
  only when it carries real weight, as one pinned UMD build from a major CDN placed
  before the inline script that uses it. If the host enforces a content security
  policy, its allowlist wins.
- Do not rely on `alert`, `confirm`, `prompt`, `window.print`, `mailto:` links, or
  iframes of other sites working; hosts often block them. Build confirmations into the
  page and show contact details as selectable text.

### Naming

The `<title>` is a name, not a caption: a short noun phrase of two to four words that
picks this page out of a list of many. No explainer after a dash or colon. When a
candidate pairs a specific name with a generic word, keep the specific half.

### Type

Pair faces deliberately; avoid the "safe" defaults (Inter, Space Grotesk). Keep running
text near 65 characters wide. Set a type scale and stay on it. Give headings
`text-wrap: balance`, uppercase labels a little letter-spacing, and aligned digits
`font-variant-numeric: tabular-nums`.

### Color

Choose neutrals; don't inherit them. Bias greys slightly toward the accent hue. Spend
boldness in one place and keep everything around it quiet. Semantic color (good,
warning, critical) is separate from the accent.

### Both themes

Define the complete light palette as custom properties on bare `:root`, then redefine
only the tokens for dark. If the host may stamp an explicit theme attribute on the root
element, guard the media query so an explicit light choice beats a dark OS, and repeat
the dark tokens under the stamp so an explicit dark choice beats a light OS:

```css
:root { color-scheme: light; --paper: #F4F7F9; --ink: #18212B; --acc: #1F70A3; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; --paper: #10161D; --ink: #E3EAF0; --acc: #69BFE8; }
}
:root[data-theme="dark"] { color-scheme: dark; --paper: #10161D; --ink: #E3EAF0; --acc: #69BFE8; }
body { background: var(--paper); color: var(--ink); }
```

- Declare every token on bare `:root` first. A color defined only inside a media or
  attribute block is the classic unreadable-page bug.
- Style components through tokens, never inside the theme blocks.
- Give `body` an explicit background; a transparent body borrows the host's ground.
- Design the dark theme with the same care; don't invert naively. Check that the accent
  reads on both grounds.
- A page that commits to one look (an arcade screen, a letterpress card) may stay
  single-theme, but it still paints every background and color explicitly.

### Layout

- Lay out siblings with flex or grid and `gap`, not per-element margins.
- Keep a side gutter of at least 16px at every width, set once as `padding-inline` on
  `body` or one wrapper. Use `padding-block` for vertical padding so a shorthand never
  zeroes the sides.
- At about 400px wide, rows wrap or stack to one column. Images and `aspect-ratio` boxes
  get `max-width: 100%`. Only tables, code, and diagrams may be wider than the screen,
  each inside its own `overflow-x: auto` container. The body never scrolls sideways.
- Size a hero to what it holds, never `100vh`.

### Composition

- Repeated things read as one object: same edges, baselines, and inner padding, with a
  recurring element in the same place on each.
- Not everything is a card. Border, fill, radius, and shadow each say "separate object";
  spend them on the one thing that needs lifting.
- Structure encodes truth. Number things only when order carries information (a real
  process, a log, a timeline). Eyebrows, dividers, and labels must say something true.
- Lead with big-number tiles only when those figures are the point of the page.

### At rest

Everything meant to be read is visible on load without scrolling or interaction to
trigger it. Animate from a visible resting state, never from `opacity: 0`. A tool opens
in a realistic working state, using the user's real data or plainly labeled examples.
Reference material too long to show at rest (source listings, full logs) goes last, in
its own scroll box capped near `70vh`, and the page says so.

### Avoid the AI-default looks

Unless the user asks for one: warm cream (#F4F1EA) with a serif display and terracotta
accent; near-black with a lone acid-green or vermilion pop; broadsheet hairline rules
with dense columns; a purple-to-blue gradient hero; Inter or Space Grotesk; emoji as
section markers; everything centered; one large radius on every block; an accent rail
on rounded cards. If your first instinct matches one of these, ask what the subject's
own world would use instead.

### Copy

Write from the reader's side: name things by what people recognize, not how the system
is built. Use active voice. A control says exactly what it does. Errors say what went
wrong and how to fix it. Specific beats clever.

### Build cleanly

Close every non-void element and double-quote attributes. Give keyboard focus a visible
state, respect `prefers-reduced-motion`, and give every form control a stable `id`.
Watch selector specificity so a type selector and a class don't silently cancel each
other's spacing. For generative or decorative graphics, use Canvas or WebGL rather than
long hand-written SVG paths.

## Diagrams

Draw as the engineer who has to live with the decision. A figure earns its place when it
shows a mechanism a cold reader would otherwise assemble from prose: where data flows,
which components talk, what changes between two options, what states a request passes
through. If a sentence says it faster, write the sentence.

- **Depict the mechanism, not its name.** Show the boundary crossed, the hop added, the
  data that moves. Leave out parts the point doesn't hinge on.
- **Comparing options? Draw the difference,** such as the edge each option adds or
  removes. Unconnected boxes per option are a restated list, not a comparison.
- **Match complexity to the stakes.** A one-hop question is three boxes.
- **Label the arrows** with what happens (`writes`, `polls every 30s`). Use a legend only
  when an encoding (dashed, colored) repeats.
- **Encode the path that matters.** One accent color marks the route taken or the option
  favored; everything else stays neutral.

Inline SVG mechanics:

- Size with `viewBox="0 0 W H"`, scale with CSS (`width: 100%; height: auto`). Give the
  SVG a `min-width` that keeps 11px text legible and wrap it in an `overflow-x: auto`
  container so phones scroll the figure instead of shrinking it.
- Color through the page tokens (CSS classes from the page stylesheet, or
  `currentColor`), never literals that only work in one theme. Give every shape an
  explicit fill.
- Arrowheads are `<marker>` elements or small polygons. Marker ids must be unique
  across every figure on the page, and a marker's color comes from its own path, so
  define one marker per arrow color.
- Keep text about 11 to 13px at drawn scale, labels a word or three. Sentences belong
  in the `<figcaption>`.
- Lay out on a grid. Write the coordinates down (column x positions, row pitch) before
  drawing, and leave room in the viewBox for the outermost labels.
- Place arrow labels clear of every line. Labels on a diagonal at its midpoint collide
  with the line itself; put them in open space beside the arrow's start.
- Route lines so they don't cross. Reordering boxes usually removes a crossing.
- One figure, one claim: wrap it in `<figure>` with a `<figcaption>` stating the claim,
  and give the `<svg>` `role="img"` and an `aria-label` carrying the same claim.
- Keep SVGs self-contained: no `<script>`, `<style>`, or `<foreignObject>` inside.

## Pitfalls

- **The look sees one theme.** A headless or automated render follows the OS theme.
  Say which theme you checked. The other one ships on the token structure alone, which
  is why that structure must be exact.
- **Browser tools may refuse `file://`.** A headless browser screenshot of the file
  counts as the one look. Discover the browser executable rather than hard-coding a
  path, then run, for example,
  `<chrome> --headless=new --hide-scrollbars --window-size=1100,4000 --screenshot=look.png file://<path>`.
- **Embedding source text verbatim.** Never retype it. Extract it programmatically from
  the source, HTML-escape it into a `<pre>` with `white-space: pre-wrap`, and verify
  that unescaping the embedded text matches the source byte for byte.
- **Build steps beat hand edits for large inserts.** Keep a template with placeholders
  and a small build step that writes the final file, so the one fix pass edits the
  template and rebuilds.
- **Report deviations.** When the page departs from this skill for a good reason, say
  so in the delivery message. If the page is itself about its own construction, mark
  the deviations on the page too.
