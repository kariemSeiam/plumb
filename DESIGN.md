---
version: alpha
name: Plumb
description: Silent infrastructure. Brass truth hanging in a slate void.
colors:
  primary: "#0F172A"
  secondary: "#475569"
  tertiary: "#C9A96E"
  neutral: "#F1F5F9"
  cistern: "#0F172A"
  slate: "#475569"
  flow: "#64748B"
  water: "#F1F5F9"
  brass: "#C9A96E"
  warning: "#B45309"
  error: "#7F1D1D"
  success: "#3F6212"
typography:
  heading:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
  code:
    fontFamily: "JetBrains Mono"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  sm: 2px
  md: 4px
  lg: 6px
spacing:
  sm: 4px
  md: 8px
  lg: 16px
  xl: 24px
components:
  card-agent:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  card-agent-border:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md}"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md}"
  log-info:
    textColor: "{colors.flow}"
    typography: "{typography.code}"
  log-success:
    textColor: "{colors.success}"
    typography: "{typography.code}"
  log-warning:
    textColor: "{colors.warning}"
    typography: "{typography.code}"
  log-error:
    textColor: "{colors.error}"
    typography: "{typography.code}"
  pipe-connector:
    backgroundColor: "{colors.secondary}"
    size: "2px"
  pipe-active:
    backgroundColor: "{colors.tertiary}"
    size: "2px"
---

## Overview

Plumb is the pipe, not the water. The design language rejects dashboard culture in favor of industrial utility — every pixel must justify its existence the way every line of code in Plumb justifies its existence. The visual identity draws from brass plumb bobs, slate conduits, and reservoir depth. Nothing decorative. Nothing friendly. Gravity does not ask permission, and neither does the protocol.

The system is built for three surfaces: terminal output, HTTP health endpoints, and documentation. All three share the same constraint — they must be readable at 3 AM by someone whose orchestrator just failed.

## Colors

- **Cistern (#0F172A):** The reservoir. Primary dark surface for agent cards, terminal backgrounds, and any surface that needs depth. Named for the still, dark water at the bottom of a plumbing system. Never used as text color.

- **Slate (#475569):** The pipe material. Secondary text on light backgrounds, borders on dark backgrounds, structural elements. The workhorse color — present everywhere but noticed nowhere.

- **Flow (#64748B):** Water in motion. Muted detail text, timestamps, secondary metadata. Lighter than slate but still subdued. Information that exists but does not demand attention.

- **Water (#F1F5F9):** The surface. Primary light background and primary text on dark surfaces. Clean, slightly cool, never pure white. The visible part of the system.

- **Brass (#C9A96E):** The plumb bob. The only accent color — used sparingly for active states, primary actions, and alignment indicators. Aged brass, not polished gold. Warm against the cool slate. Never used on water backgrounds (contrast failure — see Do's and Don'ts).

- **Warning (#B45309), Error (#7F1D1D), Success (#3F6212):** Functional signal colors for log output only. Derived from industrial safety marking. Never used for UI chrome.

## Typography

**Inter** for all prose and UI. Chosen because it is invisible — readers should experience the information, not the typeface. 600 weight for headings, 400 for body, 500 for labels.

**JetBrains Mono** for code, logs, and any machine-readable output. The vertical rhythm of 1.5 line height matches the density of JSONL ledger entries. No ligatures — readability over aesthetics.

**Label style** (0.75rem, 500 weight, 0.08em positive tracking) is used for adapter names, port numbers, and status badges. All-caps is forbidden — the tracking provides distinction without shouting.

## Layout

Density is the default. Every layout decision answers: "does this help someone debug a failed task at 3 AM?"

- **8px base grid.** All spacing multiples of 8. No exceptions.
- **Borders are 1px,** color slate at 20% opacity on dark backgrounds, flow at 40% on light.
- **No shadows.** Depth comes from color (cistern vs water), not elevation. The only exception is a 0 0 0 1px inset border for focus states.
- **Max content width: 960px.** Documentation and agent cards do not stretch. Plumbing is measured, not fluid.

## Elevation & Depth

Plumb rejects shadow-based elevation. Depth is achieved through temperature contrast:

- **Cistern surfaces** recede — they absorb light.
- **Water surfaces** advance — they reflect.
- **Brass elements** sit at the intersection — neither receding nor advancing, but aligned. The plumb bob hangs at the exact depth gravity demands.

Focus states use a 1px inset border in brass. No glow. No blur. Precision, not atmosphere.

## Shapes

- **Border radius: 4px default, 2px for code blocks, 6px for large cards.** Square corners are too aggressive for reading; rounded corners are too friendly for infrastructure. 4px is the compromise.
- **Pipes** (connector lines) are 2px solid, slate for inactive, brass for active. They do not animate — animation implies life, and Plumb is not alive.

## Components

**Agent Card (`card-agent`)** — The public face of a wrapped agent. Dark background (cistern), light text (water), brass accent for the adapter tier badge. Borders are 1px slate at 20% opacity. Padding is generous (16px) because this is the only place where density relaxes — the card is read, not scanned.

**Log Entry** — Four variants mapped to severity. All use JetBrains Mono at 0.875rem. No icons — severity is color-only. Background is always transparent. Log entries stack with 4px vertical spacing.

**Pipe Connector** — Visual representation of the bridge. 2px horizontal line, slate when idle, brass when a task is active. No animation. State change is instantaneous.

**Button Primary** — Brass background, cistern text. Used only for the single most important action on any surface. Hover inverts to water background with cistern text. No transition — transitions imply hesitation.

## Do's and Don'ts

**Do:**
- Use brass only on cistern or slate backgrounds.
- Let the ledger speak. JSONL is the native format — do not prettify it for display.
- Respect the 8px grid. Misalignment is the visual equivalent of a protocol gap.
- Use label typography for status indicators. Tracking, not case, provides hierarchy.

**Don't:**
- Use brass on water backgrounds. Contrast ratio is 2.1:1 — fails WCAG AA.
- Add decorative elements. No illustrations, no gradients, no hero sections.
- Use emojis anywhere. The MANIFEST bans them. The design system enforces the ban.
- Animate transitions. Pipes do not breathe. They are either open or closed.
- Build a dashboard. The health endpoint returns JSON. Logs go to stderr. That is the interface.
