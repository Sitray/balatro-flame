# balatro-flame

Draws a Balatro-style score above the thinking spinner in the terminal: a blue
chips box and a red mult box, each with a pixel flame rising out of its top.

- **Chips** are the output tokens of the turn: the real `output_tokens` of each
  finished model step plus an estimate of the step still streaming.
- **Mult** starts at 1 and gains 1 per tool call on the main loop; tool calls
  that land together still score one at a time.
- Each new number slams in oversized, tilted and jittering, then settles.
- Flames grow with the logarithm of each number, as Balatro's scores span
  orders of magnitude.

The engine's own spinner line (elapsed time and token count) stays underneath,
unchanged. Terminal surface only; other surfaces keep the engine's spinner.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install balatro-flame --marketplace Sitray/balatro-flame
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in
every session).

From a shell:

```
claude plugin install balatro-flame --marketplace Sitray/balatro-flame
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `Sitray/balatro-flame`, then Add plugin.
