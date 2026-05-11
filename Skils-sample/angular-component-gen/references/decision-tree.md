# Decision tree: turn a compressed spec into component shape

Apply these rules in order. They map common spec patterns to Angular 20 primitives.

## 1. Inputs

| Spec phrase | Angular primitive |
|---|---|
| "takes a title", "shows the user's name", "accepts X" | `readonly x = input.required<T>();` if always required, else `input<T>('default')` |
| "image url", "src", "href" | `input.required<string>()` (validate non-empty in template) |
| "list of …" | `input<readonly Item[]>([])` |
| "optional …" | `input<T \| null>(null)` |

## 2. Outputs

| Spec phrase | Angular primitive |
|---|---|
| "emits when clicked", "fires X event" | `readonly x = output<void>();` |
| "emits the selected item" | `readonly selected = output<Item>();` |

## 3. State + derived

| Spec phrase | Pattern |
|---|---|
| "tracks expanded/collapsed" | `private readonly expanded = signal(false);` + toggle method |
| "shows count of items" | `protected readonly count = computed(() => this.items().length);` |
| "fetches when X changes" | `effect(() => { ... });` (avoid for trivial cases) |

## 4. Template imports

Add only what the template references.

| Used in template | Import |
|---|---|
| `routerLink` / `routerLinkActive` | `RouterLink, RouterLinkActive` from `@angular/router` |
| `[(ngModel)]` | `FormsModule` from `@angular/forms` |
| reactive forms | `ReactiveFormsModule` from `@angular/forms` |
| another standalone component | the component class itself |

## 5. Control flow

| Need | Use |
|---|---|
| Show if condition | `@if (cond) { ... }` |
| Otherwise | `@else { ... }` |
| List | `@for (item of items(); track item.id) { ... }` |
| Switch | `@switch (state()) { @case ('a') { ... } }` |
| Local alias | `@let total = a() + b();` |

## 6. Accessibility quick map

| Element | Required attrs |
|---|---|
| `<section>` w/o heading | `aria-label` |
| Icon-only `<button>` | `aria-label` |
| Image conveying meaning | non-empty `alt` |
| Decorative image | `alt=""` |
| Custom toggle | `role="button"` + `tabindex="0"` + keyboard handlers |

## 7. Reject patterns

If the (compressed) spec asks for any of these, surface a warning instead of silently scaffolding:

- "with two-way binding to parent state" → prefer `model()` signal, document the parent change
- "with global singleton service" → out of scope for this skill; ask user to confirm service location
- "with its own route" → out of scope; this skill does not edit `app.routes.ts`
- "with unit tests" → out of scope; this repo does not generate `.spec.ts`
