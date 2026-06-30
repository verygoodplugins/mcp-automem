# VHS tape — the injected <memory-context> recall block (Capture A).
#
# AutoMem's per-turn recall is injected into the model payload BEFORE each turn
# and is never printed in the Hermes terminal UI. `hermes automem debug-recall`
# surfaces the exact block. This tape renders it to a still PNG for the docs.
#
# This is a TEMPLATE: scripts/build-hermes-demos.mjs substitutes {{WORKDIR}},
# {{PROMPT}}, {{OUTPUT_GIF}} (discarded) and {{OUTPUT_PNG}} (the deliverable),
# then runs `vhs` on the realized copy. Do not run this file directly.

Output "{{OUTPUT_GIF}}"

Set Shell bash
Set FontSize 13
Set Width 1500
Set Height 760
Set Padding 22
Set WaitTimeout 30s

# Quiet, reproducible prompt; cd into the hermes-demo dir so the provider's
# task-context gate (basename of cwd) matches the seeded dataset. Hidden so the
# capture starts on a clean screen.
Hide
Type "export PATH=$HOME/.local/bin:$PATH && export PS1='hermes-demo$ ' && cd {{WORKDIR}} && clear"
Enter
Show

Sleep 500ms
Type 'hermes automem debug-recall "{{PROMPT}}"'
Sleep 600ms
Enter
# Screen mode (not Line): debug-recall prints the block then returns to the
# prompt, so the block lives above the current line — match the whole screen.
Wait+Screen@20s /memory-context>/
Sleep 1500ms
Screenshot "{{OUTPUT_PNG}}"
Sleep 300ms
