# Looks

`applyLook(name)` from `index.ts` sets `<html data-look="...">`. Each CSS file applies only under
its own attribute, so without one the default look in `styles.css` stays exactly as it is.
Fonts are bundled from `@fontsource` (latin subset, woff2 only) and load only when a look uses them.
Speed rules hold in all three: backgrounds are one static layer, the colour wash is off, and focus
changes only `transform` and `opacity` (no filter, backdrop-filter or animated shadow/colour).

## gallery
- Fonts: Instrument Serif 400 (title), Inter 400/500/600 (labels).
- The TV's current artwork fills the screen, dimmed toward the title and the rows; set `--art: url(...)`
  on `:root` to use it. Until then a painted stand-in made of static gradients.
- Title and detail line read like a museum wall label; the focused tile gets a thin light frame.

## clean
- Fonts: Inter 400/500/600/700.
- Near-black, one crisp sans, no colour glows: the apps' own colours are the only colour.
- The focused tile lifts, with a soft shadow, a thin light edge and a faint top sheen.

## paper
- Fonts: Fraunces 400 (title), Figtree 500/600 (labels).
- The light option: a warm wall in the Frame's mat colour (#e8e1d3) with ink (#1b1820) text.
- Tiles sit on it as cards with a paper shadow; the focused one lifts inside an ink frame.
