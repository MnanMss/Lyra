# Offline model catalogue

`model-catalog.json` contains the text-model entries published by
[models.dev](https://models.dev), including metadata for entries without token prices. The upstream
project is MIT licensed. Its revision at refresh time, update time, URL and license are recorded.

Refresh from the repository root with `pnpm catalog:update`. Commit the generated snapshot with the
updater changes; runtime lookup, imports, settings and usage accounting work without network access.

The snapshot includes context/output limits, text token prices in USD per million tokens, cache
rates and context tiers. Image support comes from `modalities.input`, not the generic attachment flag.
Image/video generation-only models are excluded because their per-image/per-second billing is not a
text-token tariff. Missing rates remain unknown; they are never generated from another model's price.

Matching first respects the endpoint and region, then resolves recognised upstream names for relay
reference estimates. Full IDs win before known suffixes such as `preview`, `high`, `thinking` and date
stamps are removed. Unknown versions, paid/free and highspeed variants are not collapsed. Opaque names
such as `gemini-pro-agent` require an explicit `catalogRef` chosen in the editor. This reference never
changes `modelId` on the wire. OpenRouter provides labelled reference rates for open-weight families
without an upstream token tariff (including HY). Manual prices and recorded provider bills take priority.

Legacy imported metadata is repaired only for the old 200000/16384/all-capabilities-on signature.
Catalogue-managed models track later snapshots; explicit metadata overrides and custom window sizes
are retained. History cache keys include the matching version, snapshot revision and alias bindings,
so a lookup fix or changed binding also reprices old unpriced logs.

Regression coverage lives in `core/test/model-catalog.test.ts`, desktop's `usage-pricing.test.ts`
and `usage-scan.test.ts`, and the real Electron suites `e2e/model-defaults.test.ts` and
`e2e/usage-dashboard.test.ts`. The latter uses explicitly synthetic settings and usage records,
verifies persisted alias bindings without changing request IDs, and measures a $1.925 reference
estimate for one million uncached plus one million cached GPT-5.2 input tokens.
