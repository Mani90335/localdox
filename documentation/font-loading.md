# Font loading

The interface follows the reader's chosen font. Atkinson Hyperlegible is the
default; system fonts keep text readable while it downloads. Custom fonts
come from IndexedDB, and Google fonts use their separate loader.

`use-reader-preferences.ts` applies `data-font` to the root and calls
`loadReadingFont`. Markdown containing code calls `loadMonoFont` for
JetBrains Mono. Math loads KaTeX's stylesheet separately. These loaders live
in `src/lib/fonts/fonts.ts`; each family/weight stylesheet is a dynamic
import. The browser then downloads only the binary subsets whose
`unicode-range` covers the text it actually renders.

The old idle Inter loader outlived the switch to reader-controlled interface
fonts. It fetched four unused stylesheets and included 56 unused font files
in the offline download catalog. Removing that loader avoids those requests
and assets without changing the chosen typography.

Font requests can fail without hiding content: each CSS family has a system
fallback. A successful late download swaps to the selected face; different
font metrics can still shift layout. We do not preload every family or force
Latin-only subsets, which would penalize other languages.

To verify production behavior:

```sh
npm run build
PLAYWRIGHT_PRODUCTION=1 npx playwright test tests/e2e/fonts.spec.ts
```

The browser tests inspect stylesheet responses, the offline manifest, actual
glyph providers through Chrome DevTools Protocol, and Latin/Cyrillic/Greek
font requests. They also hold font downloads to verify readable fallback
text and the eventual swap. Service workers are blocked in these tests to
separate page requests from offline precaching. Offline behavior has its own
coverage in `tests/e2e/offline.spec.ts`.
