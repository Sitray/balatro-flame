# balatro-flame

Draws a Balatro-style score while Claude works: a blue chips box and a red mult
box, each with a pixel flame rising out of its top.

![A turn scoring: tokens streaming into chips, each tool call raising the mult](media/turn.gif)

- **Chips** are the output tokens of the turn: the real `output_tokens` of each
  finished model step plus an estimate of the step still streaming.
- **Mult** starts at 1 and gains 1 per tool call on the main loop; tool calls
  that land together still score one at a time.
- Each new number slams in oversized and tilted, then springs back and settles.
  The hit also shakes its box, flashes it white, throws embers and makes the
  flame flare.
- Flames grow with the logarithm of each number, as Balatro's scores span
  orders of magnitude.

![A long turn: big chips, high mult, the flames at full height](media/big-score.gif)

The engine's own spinner line (elapsed time and token count) stays as it is.

Works in the terminal, the desktop app and VS Code from the same install:

- **Terminal:** a Raster above the spinner, repainted every frame.
- **Desktop app:** a surface module in the band above the prompt, shown for the
  whole turn and a few seconds after it. It animates on its own frame clock, so
  redraws never restart it. The band's dark card is the app's own and cannot be
  changed by a mod.
- **VS Code:** an animated SVG above the spinner (looping flame frames, each hit
  played once).

The GIFs come from the mod's own painter: `node media/render-gifs.mjs` (Node
23.6 or later) renders them again after a change.

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
