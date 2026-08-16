---
version: alpha
name: Retake Whiteboard
description: An open infinite-canvas workspace for AI-assisted image, video, document, Agent, and Workflow creation with a calm neutral canvas and saturated violet identity.
colors:
  primary: "#7056EF"
  primary-hover: "#7655EB"
  primary-pressed: "#6048D5"
  primary-highlight: "#8A63FF"
  secondary-highlight: "#6F91FF"
  on-primary: "#FFFFFF"
  light-background: "#F4F5F7"
  light-navigation: "#F8F8FA"
  light-surface: "#FFFFFF"
  light-surface-subtle: "#F6F6F9"
  light-canvas: "#EEEFF2"
  light-border: "#E1E2E7"
  light-border-strong: "#C9CAD2"
  light-on-surface: "#202126"
  light-on-surface-muted: "#6D707A"
  light-on-surface-faint: "#9396A1"
  light-primary-container: "#ECE9FF"
  light-on-primary-container: "#4A32A0"
  light-error: "#C84055"
  light-warning: "#A66316"
  light-success: "#2F7D62"
  dark-background: "#141417"
  dark-navigation: "#1B1A1F"
  dark-surface: "#232228"
  dark-surface-subtle: "#2A2930"
  dark-canvas: "#18181C"
  dark-border: "#3B3943"
  dark-border-strong: "#56525F"
  dark-on-surface: "#F3F1F6"
  dark-on-surface-muted: "#B5B0BC"
  dark-on-surface-faint: "#8F8997"
  dark-primary-container: "#33285A"
  dark-on-primary-container: "#E8E1FF"
  dark-primary-highlight: "#927FFF"
  dark-secondary-highlight: "#7898FF"
  dark-error: "#F17382"
  dark-warning: "#E2A258"
  dark-success: "#65B596"
typography:
  headline-md:
    fontFamily: Inter, Geist, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.444
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter, Geist, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.429
    letterSpacing: 0em
  body-md:
    fontFamily: Inter, Geist, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.429
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter, Geist, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  label-lg:
    fontFamily: Inter, Geist, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.429
    letterSpacing: 0em
  label-sm:
    fontFamily: Inter, Geist, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0em
rounded:
  none: 0px
  sm: 8px
  md: 10px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  none: 0px
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
  xxxl: 40px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: 40px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: 40px
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: 40px
  button-secondary-light:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-on-surface}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: 40px
  button-secondary-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: 40px
  button-icon-light:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-on-surface}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.sm}"
    size: 36px
    height: 36px
    width: 36px
  button-icon-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.sm}"
    size: 36px
    height: 36px
    width: 36px
  navigation-active-light:
    backgroundColor: "{colors.light-primary-container}"
    textColor: "{colors.light-on-primary-container}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
    height: 40px
  navigation-active-dark:
    backgroundColor: "{colors.dark-primary-container}"
    textColor: "{colors.dark-on-primary-container}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
    height: 40px
  input-light:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
    height: 40px
  input-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
    height: 40px
  app-shell-light:
    backgroundColor: "{colors.light-background}"
    textColor: "{colors.light-on-surface}"
    typography: "{typography.body-md}"
  app-shell-dark:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.body-md}"
  navigation-light:
    backgroundColor: "{colors.light-navigation}"
    textColor: "{colors.light-on-surface}"
    typography: "{typography.body-md}"
  navigation-dark:
    backgroundColor: "{colors.dark-navigation}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.body-md}"
  surface-subtle-light:
    backgroundColor: "{colors.light-surface-subtle}"
    textColor: "{colors.light-on-surface}"
    typography: "{typography.body-md}"
  surface-subtle-dark:
    backgroundColor: "{colors.dark-surface-subtle}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.body-md}"
  canvas-light:
    backgroundColor: "{colors.light-canvas}"
  canvas-dark:
    backgroundColor: "{colors.dark-canvas}"
  divider-light:
    backgroundColor: "{colors.light-border}"
    height: 1px
  divider-strong-light:
    backgroundColor: "{colors.light-border-strong}"
    height: 1px
  divider-dark:
    backgroundColor: "{colors.dark-border}"
    height: 1px
  divider-strong-dark:
    backgroundColor: "{colors.dark-border-strong}"
    height: 1px
  text-muted-light:
    textColor: "{colors.light-on-surface-muted}"
    typography: "{typography.body-sm}"
  text-faint-light:
    textColor: "{colors.light-on-surface-faint}"
    typography: "{typography.body-sm}"
  text-muted-dark:
    textColor: "{colors.dark-on-surface-muted}"
    typography: "{typography.body-sm}"
  text-faint-dark:
    textColor: "{colors.dark-on-surface-faint}"
    typography: "{typography.body-sm}"
  selection-highlight-light:
    backgroundColor: "{colors.primary-highlight}"
  secondary-highlight-light:
    backgroundColor: "{colors.secondary-highlight}"
  selection-highlight-dark:
    backgroundColor: "{colors.dark-primary-highlight}"
  secondary-highlight-dark:
    backgroundColor: "{colors.dark-secondary-highlight}"
  status-error-light:
    textColor: "{colors.light-error}"
    typography: "{typography.label-sm}"
  status-warning-light:
    textColor: "{colors.light-warning}"
    typography: "{typography.label-sm}"
  status-success-light:
    textColor: "{colors.light-success}"
    typography: "{typography.label-sm}"
  status-error-dark:
    textColor: "{colors.dark-error}"
    typography: "{typography.label-sm}"
  status-warning-dark:
    textColor: "{colors.dark-warning}"
    typography: "{typography.label-sm}"
  status-success-dark:
    textColor: "{colors.dark-success}"
    typography: "{typography.label-sm}"
---

# Retake Whiteboard

## Overview

Retake Whiteboard is an open infinite-canvas creative workspace. Image creation and editing are the current product focus, but
the visual system must continue to support Text, Document, Image, Video, Operation, Result, Group, Agent, and Workflow
experiences without turning the product into a single-image editor.

The Canvas remains the dominant visual area. Navigation, creation controls, contextual editing, Agent, History, and execution
details form restrained product chrome around the same Board facts. Saturated violet carries brand and interaction emphasis;
neutral surfaces protect media fidelity and keep long sessions comfortable.

The machine-readable tokens in this file are normative for Whiteboard UI. Product mockups and Figma frames define page intent
and flow, but they do not override these tokens or authorize removal of existing capabilities.

## Colors

The palette uses one saturated violet interaction family, a restrained blue highlight, and neutral surfaces that do not compete
with Canvas content.

- **Primary (`#7056EF`):** Accessible solid interaction color for primary buttons, focus emphasis, and selected Canvas objects.
- **Primary Highlight (`#8A63FF`):** Brighter violet for decorative highlights, selection glow, and large visual accents; not a
  normal white-text button background.
- **Secondary Highlight (`#6F91FF`):** Cool blue glint used sparingly in focus, illustration, and gradient transitions; never a
  competing second action color.
- **Light Neutrals:** Soft gray app and Canvas foundations with white working surfaces and light navigation.
- **Dark Neutrals:** Layered charcoal surfaces rather than purple-black or blue-black backgrounds. Media is never recolored by
  the theme.
- **Semantic Colors:** Error, warning, and success communicate state together with text or icons, never by color alone.

The one allowed AI-action gradient is `linear-gradient(110deg, #6550E4 0%, #7655EB 58%, #536AE0 100%)`. Components that
cannot consume gradients use `primary` as the machine-readable fallback.

## Typography

Typography is compact, neutral, and optimized for a dense creative workspace.

- **Headlines:** `headline-md` is reserved for the current Board or major workspace title.
- **Section Titles:** `title-sm` labels Workbench groups, History, candidates, and settings sections.
- **Body:** `body-md` is default interface copy; `body-sm` is metadata and supporting information.
- **Labels:** `label-lg` is used for buttons and active navigation; `label-sm` for compact controls and status labels.
- **Typeface:** Use Inter or Geist when available, then the native system sans-serif and PingFang SC for Chinese text.

Do not use serif families for workspace headings. Text smaller than `11px` is not allowed for actionable or meaningful
information.

## Layout

The desktop workspace uses three regions at the `1440 × 1024` reference size:

```text
248px collapsible navigation | minmax(640px, 1fr) Canvas | 320px contextual Workbench
```

- Navigation collapses to `48px`. User and settings remain anchored at the bottom; the collapse control stays in the brand
  header rather than consuming a permanent bottom row.
- Canvas occupies the majority of the workspace and preserves visible Block, Edge, selection, and lineage context.
- The top toolbar is `56px` high. Candidate navigation belongs at the bottom of the Canvas rather than in a permanent rail.
- The single right Workbench switches between Inspector, Task, Compare, Deliverable, Agent, History, and Plugin surfaces. It is
  normally `320px` and may widen to `410px` for Agent on wide screens; it never creates a fourth column.
- At `1024–1279px`, navigation collapses by default and Workbench uses the compact width. Below `1024px`, Workbench becomes a
  drawer; mobile-first editing is outside V0.
- Use 4px-based spacing tokens. Prefer separators and tonal surfaces over nested cards.

Selection, Agent, Task, and Focus edit may change Workbench content, but never reorder the project tree, move account/settings,
or replace the current Board authority.

## Elevation & Depth

Depth comes primarily from tonal layers, borders, and spatial separation. Fixed navigation and Workbench panels do not use
large shadows.

Use subtle shadows only for floating Canvas tools, popovers, dialogs, and elevated candidate previews. A typical light-theme
floating shadow is `0 8px 24px rgb(18 18 28 / 0.08)`. Dark mode relies more on border contrast and less on shadow opacity.

Avoid glassmorphism, persistent glow, and blurred decorative layers behind working content.

## Shapes

The shape language is softly rectangular and precise.

- Primary buttons use the `lg` radius (`12px`); compact controls use `md` (`10px`); icon tools use `sm` (`8px`).
- Pills are reserved for passive status, counts, and avatars. Primary actions and navigation actions are never pills.
- Panels align to the workspace grid. Avoid irregular decorative containers or excessive card nesting.
- Focus-visible uses a `2px` ring with a `2px` offset and remains visible in both themes.

## Components

- **Primary Button:** `40px` high, `lg` radius, `label-lg`, and `primary` background. Hover uses `primary-hover`; pressed uses
  `primary-pressed` and removes lift.
- **AI Primary Button:** Uses the approved violet-to-blue gradient and otherwise follows Primary Button geometry. Only one AI
  primary action should dominate a view.
- **Secondary Button:** Uses the current theme surface, on-surface text, a visible border, and no brand gradient.
- **Icon Button:** `36 × 36px` with `sm` radius. Use consistent linear icons around `1.75px` stroke; do not use emoji as UI
  icons.
- **Navigation Item:** Active items use the theme primary container and on-primary-container colors. Hover remains neutral.
- **Inputs:** `40px` minimum height, `md` radius, theme surface, and a visible focus ring. Multiline prompts may grow vertically.
- **Workbench:** Uses one visible contextual surface, organized with sections and separators rather than one card per field.
- **Image Context Toolbar:** Shows frequent intent with icon and short label, while all Plugin commands remain available through
  registry-driven overflow and real availability reasons.
- **Canvas Selection:** Uses violet outline and handles without recoloring or filtering selected media.
- **Status:** Error, warning, success, disabled, queued, running, partial, and completed states include text or icon semantics in
  addition to color.

Theme selection supports `system`, `light`, and `dark`. Changing theme updates semantic tokens only; it must not rebuild the
Host session, Plugin runtime, Canvas scope, Agent session, or Workflow run.

## Do's and Don'ts

- Do keep the Canvas and visible Block graph as the primary workspace context.
- Do use `primary` for the most important solid action and the AI gradient for at most one dominant AI action.
- Do meet WCAG AA for normal text and preserve visible keyboard focus.
- Do use the same shell and tokens for local Whiteboard and hosted Workspace variants.
- Do project Agent, Workflow, History, candidates, and Plugin panels from their current canonical facts.
- Don't simplify Whiteboard into a single-image Studio or hide Text, Video, Document, Group, Agent, and Workflow capability.
- Don't hardcode a closed list of Image Studio commands in Host UI; respect Plugin surfaces, order, and availability.
- Don't duplicate Asset, Candidate, selected, History, Execution, or Deliverable authority in component-local state.
- Don't require login, Token, Plan, or cloud storage to use the open shared workspace.
- Don't use royal blue, fixture green, pink-purple, magenta, neon glow, large purple-black backgrounds, or persistent glass.
- Don't turn every action into a pill, gradient, or card.
- Don't copy or restyle Plugin editor internals by duplicating their UI.
