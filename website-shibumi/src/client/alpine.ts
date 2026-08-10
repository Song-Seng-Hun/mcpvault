/**
 * Client bundle entry point for the demo page's Alpine interactivity.
 *
 * Imports `@alpinejs/csp`, not the standard `alpinejs` package (per the
 * plan's Alpine section): the CSP build's evaluator never calls
 * `Function()`/`eval()` to run `x-data`/`x-on`/`x-show` attribute strings,
 * so the page can ship a CSP without `'unsafe-eval'`. `client-bundle.ts`
 * bundles this file with `Bun.build()` (target: browser) and serves the
 * result at `/client/alpine.js` -- Alpine's own source ends up inlined in
 * that single served file, so there is no CDN request at runtime, matching
 * "vendor Alpine locally".
 *
 * Every named module this app registers is added here, then `Alpine.start()`
 * is called once. Only `interactiveDemo` exists so far (Phase 3 step 1 --
 * InteractiveDemo/ResponseRenderer); nav/theme/terminal/newsletter modules
 * land in later Phase 3 steps and get added to this same registration list.
 */
import Alpine from "@alpinejs/csp";
import { interactiveDemo } from "./interactive-demo";

Alpine.data("interactiveDemo", interactiveDemo);

Alpine.start();
