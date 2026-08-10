/**
 * Scroll-triggered reveal for `.fade-in-on-scroll` elements. Ported from
 * `Layout.astro`'s vanilla `observeElements()`, but plain JS, not an
 * `Alpine.data()` module: there is no interactive state here a template
 * needs to read or an event a template needs to name, just a page-load side
 * effect, so wiring it through Alpine would add naming ceremony for no
 * benefit. Bundled into the same `alpine.js` output as every other client
 * module (`client-bundle.ts` doesn't care what it bundles), but imported
 * only for this side effect -- it never touches `Alpine.data()`/`Alpine.store()`.
 *
 * Production bug this fixes, not just ports: `Layout.astro`'s observer
 * added `.animate-fade-in-up`, but every page's own scoped `<style>` block
 * played the animation unconditionally via `animation: fade-in-up ...
 * forwards` directly on `.fade-in-on-scroll` -- the class the observer
 * added was never referenced by any of those rules, so elements always
 * animated on page load, never "on scroll" (confirmed by grep: no page
 * style block selects `.animate-fade-in-up`). The first pass of this port
 * (features.css/install.css/demo.css/skill.css/how-it-works.css) carried
 * that same unconditional `animation: ... forwards` forward. `shared.css`'s
 * shared `.fade-in-on-scroll` rule now gates the animation behind
 * `.is-visible` instead, and this module is what adds that class, so the
 * animation genuinely waits for scroll intersection.
 *
 * `prefers-reduced-motion` is handled in CSS (`shared.css`), not here: the
 * elements are already fully opaque/untransformed under that media query,
 * so this module observing them and adding `.is-visible` is harmless but
 * unnecessary. It still runs either way rather than special-casing the
 * media query twice in two places.
 *
 * The interfaces below are deliberately minimal structural subsets of the
 * real DOM (`classList.add`, `querySelectorAll`, a constructor + `observe`/
 * `unobserve`) rather than the real `Element`/`Document`/`IntersectionObserver`
 * lib.dom types, so tests can pass small hand-written fakes instead of a
 * real DOM.
 */
export interface FadeInTarget {
  classList: { add(name: string): void };
}

export interface FadeInObserverDoc {
  querySelectorAll(selector: string): Iterable<FadeInTarget>;
}

export interface FadeInObserverEntry {
  isIntersecting: boolean;
  target: FadeInTarget;
}

export interface FadeInIntersectionObserver {
  observe(target: FadeInTarget): void;
  unobserve(target: FadeInTarget): void;
}

export type FadeInIntersectionObserverCtor = new (
  callback: (entries: FadeInObserverEntry[], observer: FadeInIntersectionObserver) => void,
  options: { threshold: number; rootMargin: string },
) => FadeInIntersectionObserver;

export interface FadeInObserverWindow {
  IntersectionObserver?: FadeInIntersectionObserverCtor;
  requestAnimationFrame(callback: () => void): number;
}

/** Matches `Layout.astro`'s original observer tuning exactly. */
export function getObserverOptions(): { threshold: number; rootMargin: string } {
  return { threshold: 0.1, rootMargin: "0px 0px -50px 0px" };
}

/**
 * @param doc/@param win Injectable so tests can pass minimal fakes instead
 * of needing a real DOM/IntersectionObserver.
 */
export function initFadeInObserver(doc: FadeInObserverDoc, win: FadeInObserverWindow): void {
  const targets = Array.from(doc.querySelectorAll(".fade-in-on-scroll"));
  if (targets.length === 0) return;

  const IO = win.IntersectionObserver;
  if (!IO) {
    // No IntersectionObserver support: reveal everything rather than
    // leaving it permanently hidden behind `opacity: 0`.
    for (const el of targets) el.classList.add("is-visible");
    return;
  }

  const observer = new IO((entries, obs) => {
    const revealed: FadeInTarget[] = [];
    for (const entry of entries) {
      if (entry.isIntersecting) {
        revealed.push(entry.target);
        obs.unobserve(entry.target);
      }
    }
    if (revealed.length > 0) {
      win.requestAnimationFrame(() => {
        for (const el of revealed) el.classList.add("is-visible");
      });
    }
  }, getObserverOptions());

  for (const el of targets) observer.observe(el);
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initFadeInObserver(document as unknown as FadeInObserverDoc, window as unknown as FadeInObserverWindow);
}
