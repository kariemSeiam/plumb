# Plumb ∞ — Two-Agent Orchestration: Wolfy + Cursor

> The simplest complete nervous system. Two agents. All models. One orchestrator.
> VENOM∞ leads. Wolfy thinks deep. Cursor builds fast.

---

## The Two Arms

| Agent | Port | Mode | What it does | When VENOM uses it |
|-------|------|------|-------------|-------------------|
| **Wolfy** 🐺 | 3007 | Persistent | Deep thinking, architecture, design, memory, research, speculative branches | DIG, OMEN, ECHO, TRACE |
| **Cursor** | 3003 | Oneshot | Build, implement, review, debug, audit, refactor | WELD, EDGE, MEND, HELM |

---

## Model Arsenal (via OpenCode-Go)

Both agents share these models. VENOM routes by task.

| Model | Context | Output | Reasoning | Best For | Cost |
|-------|---------|--------|-----------|----------|------|
| `deepseek-v4-pro` | 200K | 128K | ✅ | Heavy reasoning, debugging, architecture | $ |
| `deepseek-v4-flash` | 200K | 128K | ❌ | Fast scans, trace, cheap exploration | $ |
| `kimi-k2.6` | 262K | 128K | ✅ | Deep research, bedrock, long-context analysis | $ |
| `glm-5.1` | 200K | 128K | ✅ | Direction, review, balanced reasoning | $ |
| `glm-5` | 200K | 128K | ✅ | Fallback for glm-5.1 | $ |
| `glm-4.5-air` | 128K | 32K | ❌ | Quick memory ops, echo, cheap dispatch | $ |
| `minimax-m2.7` | 200K | 128K | ✅ | Pattern shedding, creative, evolutionary | $ |
| `qwen3.5-plus` | 200K | 128K | ✅ | General purpose, alternative perspective | $ |

---

## Mind → Agent → Model Routing

| Mind | Agent | Model | Why |
|------|-------|-------|-----|
| **HELM** | (internal) | `glm-5.1` | Direction at depth 0, balanced |
| **DIG** | Wolfy | `kimi-k2.6` | 262K context for bedrock research |
| **EDGE** | Cursor | `glm-5.1` | Precise review, balanced quality |
| **ECHO** | Wolfy | `deepseek-v4-flash` | Fast memory recall, cheap |
| **WELD** | Cursor | `deepseek-v4-pro` | Heavy build, reasoning on |
| **MEND** | Cursor | `deepseek-v4-pro` | Debug needs deep reasoning |
| **OMEN** | Wolfy | `kimi-k2.6` | Speculative needs longest context |
| **SYNC** | (internal) | — | Energy detection, no dispatch |
| **MOLT** | Wolfy | `minimax-m2.7` | Pattern shedding, creative |
| **TRACE** | Wolfy | `deepseek-v4-flash` | Fast topology scan, cheap |

---

## Orchestration Patterns

### Pattern 1: Build Wave (WELD leads)
```
VENOM → Cursor (deepseek-v4-pro): "Implement X"
  ↓ result
VENOM → Cursor (glm-5.1): "Review X for correctness, security, architecture"
  ↓ review
VENOM → Cursor (deepseek-v4-pro): "Fix issues found"
```

### Pattern 2: Deep Research (DIG leads)
```
VENOM → Wolfy (kimi-k2.6): "Go to bedrock on X. Why does this work? What's missing?"
  ↓ analysis
VENOM → Wolfy (deepseek-v4-flash): "Scan all related files for X pattern"
  ↓ scan
VENOM synthesizes → decision
```

### Pattern 3: Evolution Cycle (hourly cron)
```
tg-cron → VENOM reads intent queue
  → Wolfy (kimi-k2.6): "Analyze current Plumb state. What's the +0.5 improvement?"
  ↓ analysis
  → Cursor (deepseek-v4-pro): "Implement the improvement"
  ↓ build
  → Cursor (glm-5.1): "Review the implementation"
  ↓ review
  → Telegram: Score + taskId + what changed
```

### Pattern 4: Emergency Fix (MEND leads)
```
VENOM → Cursor (deepseek-v4-pro): "Fix X. Root cause. Not symptoms."
  ↓ fix
VENOM → Cursor (glm-5.1): "Verify fix. Check for regressions."
  ↓ verify
Done.
```

---

## Plumb A2A Dispatch Format

### To Wolfy (persistent, port 3007)
```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "id": 1,
  "params": {
    "message": {
      "messageId": "unique-id",
      "role": "user",
      "parts": [{"kind": "text", "text": "[DIG][kimi-k2.6] Go to bedrock on..."}]
    }
  }
}
```

### To Cursor (oneshot, port 3003)
```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "id": 2,
  "params": {
    "message": {
      "messageId": "unique-id",
      "role": "user",
      "parts": [{"kind": "text", "text": "[WELD][deepseek-v4-pro] Implement..."}]
    }
  }
}
```

---

## Why Two Agents, Not Seven

Simplicity is leverage. Every agent in the fleet is maintenance:

- **Wolfy** = persistent, deep, remembers across tasks. One process, many tasks.
- **Cursor** = oneshot, fresh, clean state per task. No leaks.

All other agents (pi, claude, opencode, venom, generic) are still in `plumb.yaml` but **not the primary dispatch targets**. VENOM uses them when the two-agent pattern hits a wall (e.g., claude for Claude-specific tasks, pi for Pi-native operations).

The two-agent constraint forces clarity: every dispatch is either "think deep" (Wolfy) or "build/review/fix" (Cursor).

---

*Two arms. Eight models. One mind. The simplest complete nervous system.*
🐍🐺∞
