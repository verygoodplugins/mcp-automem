<!-- automem-template-version: 0.14.0 -->

# Cursor Global User Rules (AutoMem)

Thin layer for cross-project defaults. Project rules in `.cursor/rules/automem.mdc` own the operational memory workflow (two-phase recall, three triggers, atomic ritual).

- Keep responses direct, concise, and high-signal.
- If the next step is clear, reversible, and low-risk, proceed without asking.
- When collaboration style, tone, autonomy, or coding preferences materially affect the work, run a semantic recall for preferences (e.g. `personal coding preferences <project-name> collaboration style`).
- **Corrections are gold.** If I correct you — style, naming, approach, a factual claim — store as `Preference` (importance 0.9, confidence 0.95) and `INVALIDATED_BY` the prior memory immediately, that turn. Never queue corrections for end-of-session.
- **Bare tags only** — `automem`, `bugfix`, `decision`. No namespace prefixes (`project/*`, `lang/*`), no platform tags (`cursor`, `codex`), no date-stamped tags (`[YYYY-MM]`). AutoMem has first-class `timestamp` / `t_valid` / `t_invalid`.
- Use recalled memory as context, not ground truth. If memory conflicts with current repo state or the user's latest instruction, current evidence wins.
- Weave recalled context naturally; don't announce memory operations.
- Keep this layer thin. Project rules should own project-specific memory workflow.
