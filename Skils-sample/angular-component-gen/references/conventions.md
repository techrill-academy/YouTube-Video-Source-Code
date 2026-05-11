# Angular component conventions (this repo)

Targets **Angular 20**, standalone-by-default, signal-based.

## Folder + file layout

```
src/app/components/<kebab-name>/
├── <kebab-name>.ts
├── <kebab-name>.html
└── <kebab-name>.scss
```

- One folder per component, kebab-case.
- No `.spec.ts` files (this repo does not generate them).
- Always separate `.html` and `.scss` files (no inline templates/styles).

## Component decorator

- Standalone is implicit (Angular 20 default). Do not set `standalone: true` explicitly.
- `selector: 'app-<kebab-name>'`.
- Use `templateUrl` + `styleUrl` (singular).
- Set `changeDetection: ChangeDetectionStrategy.OnPush`.
- Add `host: { class: 'block' }` (or appropriate display) so the host element is laid out predictably.

## Class

- Class name: `<Pascal>Component` (e.g. `FeatureCardComponent`).
- Inputs: `readonly title = input.required<string>();` or `input<string>('default')`.
- Outputs: `readonly clicked = output<void>();`.
- State: `signal()`; derived: `computed()`; side effects: `effect()`.
- Avoid constructors for DI; use `inject()`.

## Templates

- Use control-flow blocks: `@if`, `@else`, `@for (item of items; track item.id)`, `@switch`, `@let`.
- Never use `*ngIf`, `*ngFor`, `*ngSwitch` (legacy structural directives).
- Use `class.is-active` / `[class.is-active]` bindings; avoid string concatenation in `[ngClass]`.
- Use `@defer` for non-critical sub-trees when relevant.

## Imports

Add only what the template uses:
- `RouterLink`, `RouterLinkActive` from `@angular/router` for nav
- `FormsModule` / `ReactiveFormsModule` from `@angular/forms` for inputs
- Other shared standalone components in `src/app/components/` directly

`CommonModule` is rarely needed with the new control-flow syntax.

## Accessibility

- Use semantic elements (`<section>`, `<nav>`, `<button>`, `<h2>`…).
- Always provide `aria-label` on landmark sections without a visible heading.
- `<button type="button">` unless inside a form submit.
- Honour `prefers-reduced-motion` for animations.

## SCSS

- Component styles are scoped (`ViewEncapsulation.Emulated`, the default).
- Use BEM-ish class names matching the kebab folder name (e.g. `.feature-card__title`).
- Put `:host { display: block; }` (or appropriate) at the top.

## Routing / wiring

This skill does **not** edit `app.routes.ts` or parent components. The agent must wire the new component into its parent after scaffolding, based on the compressed spec.
