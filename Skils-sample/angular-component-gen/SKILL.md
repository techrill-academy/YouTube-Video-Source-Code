---
name: angular-component-gen
description: 'Generate a new standalone Angular component (TS + HTML + SCSS) from a plain-English requirement, after compressing the requirement with the project minifier+LLMLingua pipeline to reduce token usage. Use when: create angular component, scaffold component, generate component, new ui component, add angular component, build component from spec, angular feature card, angular form component, angular standalone component.'
argument-hint: '<component-name> "<plain-english requirement>"'
---

# Angular Component Generator (token-optimized)

Generate a new **standalone, signal-based Angular 20** component for this workspace from a free-form requirement, while aggressively compressing the requirement text **before** it is consumed by the agent so token usage is minimized.

## When to Use

- User asks: "create / scaffold / generate / add an Angular component for X"
- A spec/PRD blurb needs to become a component skeleton
- You need to reduce the token footprint of long requirements before sending them to the agent

Do NOT use for: editing existing components, full feature/page generation, routing changes, or non-Angular work.

## Inputs

| Input | Required | Notes |
|------|---|-------|
| `componentName` | yes | kebab-case folder + selector base, e.g. `feature-card` → `app-feature-card` |
| `spec` | yes | Plain-English requirement (markdown OK, comments OK — they will be stripped) |
| `targetDir` | no | Defaults to `src/app/components/` |

## Procedure

1. **Parse the user message** to extract `componentName` and the requirement `spec`. If unclear, ask one short clarifying question listing the 2–3 missing fields.

2. **Compress the spec** using the shared minifier + (optional) LLMLingua model. Run from the workspace root:

   ```sh
   echo "<spec text>" | node .github/skills/angular-component-gen/scripts/compress-spec.mjs
   ```

   Add `--aggressive` for prose-heavy specs (drops filler phrases like "please note that", "the goal is to", normalizes modal verbs, and collapses short bullet lists into comma-lists — typically +5–15 % extra savings).

   The script prints JSON `{ original, compressed, originalTokens, compressedTokens, savedTokens, savedPct, mode, cached, durationMs }` to stdout, caches results by content-hash under `.github/hooks/cache/spec-compress/`, and appends a record to `.github/hooks/logs/skill-spec-compression.log`. **Use `compressed` (not the raw spec) for all subsequent reasoning** — that is the whole point of this skill.

3. **Read** [conventions.md](./references/conventions.md) once per session before scaffolding. It encodes this repo's component conventions (standalone, signals, no spec files, separate `.html`/`.scss`, `Component` suffix).

4. **Decide the component shape** using [decision-tree.md](./references/decision-tree.md):
   - inputs / outputs (signal-based: `input()`, `output()`)
   - internal state (`signal()` vs `computed()`)
   - imports needed (`CommonModule`, `RouterLink`, `FormsModule`, …)
   - heading element + ARIA attributes for accessibility

5. **Scaffold the files** by running the generator script (it uses the templates in `./assets/templates/`):

   ```sh
   node .github/skills/angular-component-gen/scripts/generate-component.mjs \
     --name <component-name> \
     --target src/app/components \
     --spec-file <path-to-compressed-spec.txt>
   ```

   The script:
   - Creates `src/app/components/<name>/<name>.{ts,html,scss}`
   - Refuses to overwrite if files already exist (use `--force` to override)
   - Inserts the compressed spec as a single-line `// Spec:` comment in the `.ts` file (kept short)
   - Echoes the created paths

6. **Fill in the details** by editing the scaffolded files based on the *compressed* spec:
   - Add `input()` signals for each prop the spec mentions
   - Add `output()` for each event
   - Add `computed()` for derived values
   - Wire the template with `@if`, `@for`, `@let` (control-flow syntax — never `*ngIf`/`*ngFor`)
   - Add `host: { class: 'block …' }` if it sits inline in a flex/grid layout

7. **Validate**:
   - `npx tsc --noEmit` passes
   - `npm run lint` passes (if available)
   - The new selector follows `app-<name>` exactly

8. **Report** back to the user with:
   - Created file paths (clickable)
   - The token reduction (e.g., "spec compressed 412 → 138 tokens, -66.5%")
   - Any TODOs left for the user (e.g., "wire `(cardClicked)` into parent")

## Resources

- Templates: [component.ts.tmpl](./assets/templates/component.ts.tmpl), [component.html.tmpl](./assets/templates/component.html.tmpl), [component.scss.tmpl](./assets/templates/component.scss.tmpl)
- Compression: [compress-spec.mjs](./scripts/compress-spec.mjs) (wraps `.github/hooks/scripts/lib/minify.mjs`)
- Generator: [generate-component.mjs](./scripts/generate-component.mjs)
- Conventions: [references/conventions.md](./references/conventions.md)
- Decisions: [references/decision-tree.md](./references/decision-tree.md)

## Why compress first?

Long product requirements often contain markdown decorations, restated goals, blockquotes, and example URLs that consume tokens but contribute almost nothing to code generation. The shared minifier strips these deterministically; LLMLingua-2 (when installed) further reduces tokens semantically. Empirically this skill sees **40–70% token reduction** on typical requirement blurbs before the agent ever reasons about them.
