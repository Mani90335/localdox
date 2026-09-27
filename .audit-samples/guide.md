# Designing for Focus

A field guide to interfaces that get out of the way.

## The premise

Most software asks for attention it has not earned. A document reader is the
clearest case: the only thing that matters is the text, and every pixel the
application spends on itself is a pixel taken from the reader.

This guide collects the rules we use. They are opinionated, and they are meant
to be broken deliberately rather than accidentally.

> [!NOTE]
> These are defaults, not laws. A rule you cannot justify is a habit.

## Typography carries the product

Type is the interface. Before adding a border, a shadow, or a colour, ask
whether a change in size, weight, or spacing would do the same work quietly.

| Element | Size | Weight | Tracking |
| --- | --- | --- | --- |
| Display | 40px | 620 | -0.022em |
| Title | 28px | 600 | -0.018em |
| Body | 17px | 400 | 0 |
| Caption | 13px | 500 | 0.005em |

### Measure

Between 62 and 72 characters per line. Shorter feels clipped; longer loses the
reader between lines.

## Colour is a scarce resource

Spend colour on the one thing that matters on a screen. If two elements are
both coloured, neither is emphasised.

```ts
const accent = "oklch(0.58 0.19 265)";
const surface = "oklch(0.99 0.002 265)";
```

## Motion explains, it does not decorate

- Motion should answer "where did that come from?"
- Durations between 140ms and 260ms
- Never animate more than two properties at once

## Density

Dense interfaces respect expert users. Sparse interfaces respect newcomers.
Pick one per surface and hold the line.

