# DESIGN — The Visual Language

```
Plumb is not designed to be beautiful.
Plumb is designed to be invisible.
Beauty is a side effect of precision.
```

---

## Palette

```
┌─────────────────────────────────────────────────────────────┐
│  CISERN    #0F172A    │  The reservoir. Dark surface. Depth. │
│                        │  Absorbs light. Never text color.   │
├─────────────────────────────────────────────────────────────┤
│  SLATE     #475569    │  The pipe material. Secondary.       │
│                        │  Borders, structure, metadata.      │
│                        │  Present everywhere, noticed never. │
├─────────────────────────────────────────────────────────────┤
│  FLOW      #64748B    │  Water in motion. Muted detail.     │
│                        │  Timestamps, secondary metadata.    │
│                        │  Information that does not demand.  │
├─────────────────────────────────────────────────────────────┤
│  WATER     #F1F5F9    │  The surface. Primary light.        │
│                        │  Text on dark. Background on light. │
│                        │  Slightly cool, never pure white.  │
├─────────────────────────────────────────────────────────────┤
│  BRASS     #C9A96E    │  The plumb bob. The only accent.    │
│                        │  Active states, primary actions.    │
│                        │  Aged brass, not polished gold.    │
│                        │  Warning: never on WATER bg (2:1)  │
├─────────────────────────────────────────────────────────────┤
│  WARNING   #B45309    │  Log output only. Never UI chrome.  │
│  ERROR     #7F1D1D    │  Industrial safety marking.         │
│  SUCCESS   #3F6212    │  Color = severity, no icons.        │
└─────────────────────────────────────────────────────────────┘
```

---

## Typography

```
HEADING: Inter 600   1.5rem   -0.02em letter-spacing
BODY:    Inter 400   1rem     0em     letter-spacing
LABEL:   Inter 500   0.75rem  0.08em  letter-spacing
CODE:    JetBrains Mono 400  0.875rem  0em  letter-spacing

Rules:
  No ligatures in JetBrains Mono.
  No all-caps anywhere. Label tracking provides hierarchy.
  Font size changes in 0.25rem increments, never in-between.
```

Inter is chosen because it is invisible. Readers experience the information, not the typeface. JetBrains Mono for code because the vertical rhythm matches JSONL ledger density.

---

## Layout

```
Grid:   8px base. All spacing multiples of 8. No exceptions.
Borders: 1px solid, SLATE at 20% on dark, FLOW at 40% on light.
Shadows: None. Depth comes from color contrast, not elevation.
Focus:   1px inset BRASS border. No glow. No blur.
Width:   Max 960px. Documentation does not stretch.
Radius:  4px default, 2px code blocks, 6px large cards.
```

The 8px grid is not a suggestion. Misalignment is the visual equivalent of a protocol gap.

---

## Components

### Agent Card
```
┌──────────────────────────────────────────────┐
│  pi :3001                    [tier 1]  brass │
│  persistent · 47 tasks · uptime 2h          │
│  skills: code-edit, bash-execute, file-read  │
│  labels: scan, fast, cheap                    │
│  ledger: .plumb/ledger/2026-05-13.jsonl      │
│  status: running          ──── brass line    │
└──────────────────────────────────────────────┘
  BG: CISERN   Text: WATER   Border: SLATE 20%
  Badge: BRASS on CISERN
  Status line: 2px BRASS for active, SLATE for idle
```

### Log Entry
```
2026-05-13T19:00:00Z  task_submitted  47a2c1  "refactor auth module"
2026-05-13T19:00:01Z  task_running    47a2c1  pid=12345
2026-05-13T19:00:05Z  progress        47a2c1  /src/auth.ts read (342 lines)
2026-05-13T19:00:12Z  task_completed  47a2c1  duration=12s
  ^-- FLOW                ^-- WATER    ^-- muted  ^-- normal
```

No icons. No timestamps in bold. Each line earns its place by being the exact format an operator can `grep` and `jq`.

### Pipe Connector
```
  ────  SLATE (idle)
  ────  BRASS (active, task in flight)
```
2px horizontal line. No animation. State change is instantaneous. Pipes do not breathe.

### Button
```
[ Submit Task ]  BRASS bg · CISERN text · 4px radius
[ Cancel      ]  transparent · SLATE text · 4px radius
```

Hover: WATER bg for primary, BRASS text for secondary. No transition on hover — transitions imply hesitation.

---

## What Plumb's design refuses

| Refusal | Why |
|---------|-----|
| Gradients | Depth comes from color temperature, not smooth transitions. |
| Glows | Precision over atmosphere. A plumb bob does not glow. |
| Shadows | Elevation is a lie. Either something is on the surface or it is in the cistern. |
| Animation | Nothing in Plumb is alive. Pipes are open or closed. Period. |
| Icons | Every icon is a word you had to look up. Plumb uses words. |
| Emoji | The MANIFEST bans them. The design system enforces the ban. |
| Dashboards | If you want a dashboard, pipe pulse into Grafana. Plumb ships logs. |
| Hero sections | Documentation does not need a hero. It needs a table of contents. |

---

## The reference

The Basilica Cistern in Istanbul. Justinian's 6th-century underground reservoir. 336 stone columns holding up the dark above shallow lit water.

```
Not the surface of the water — the space between the surface and the columns.
Not the architecture — the stillness.
Not the light — the precision of the geometry that makes the light meaningful.
```

Plumb's design is the space between. The thing you don't notice until you need it, and when you need it, it is exactly where gravity demands.
