# VHS tape — a live one-shot Hermes turn using recalled memory (Capture B).
#
# `hermes -z` runs a single non-interactive turn and prints only the final
# answer. The prompt asks for a fact (the Project Nimbus staging port) that
# exists ONLY in the seeded demo dataset, so a correct answer proves AutoMem
# recall fired — the model could not otherwise know it.
#
# This is a TEMPLATE: scripts/build-hermes-demos.mjs substitutes {{WORKDIR}},
# {{PROMPT}} and {{OUTPUT_GIF}} (the deliverable), then runs `vhs` on the
# realized copy. Do not run this file directly.

Output "{{OUTPUT_GIF}}"

Set Shell bash
Set FontSize 16
Set Width 1200
Set Height 240
Set Padding 24
Set WaitTimeout 90s

Hide
Type "export PATH=$HOME/.local/bin:$PATH && export PS1='hermes-demo$ ' && cd {{WORKDIR}} && clear"
Enter
Show

Sleep 600ms
Type 'hermes -z "{{PROMPT}}"'
Sleep 800ms
Enter
# The model turn is variable-length; wait for the seeded fact to appear rather
# than guessing a fixed Sleep. Screen mode because the answer prints above the
# returned prompt. WaitTimeout (90s) bounds a stuck turn.
Wait+Screen@90s /{{WAIT_TOKEN}}/
Sleep 2500ms
