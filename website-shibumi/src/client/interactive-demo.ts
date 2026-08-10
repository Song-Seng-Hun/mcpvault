/**
 * Alpine.data() module backing the demo page's tab browser
 * (`InteractiveDemo.tsx`). Ported from `InteractiveDemo.tsx` (React)'s two
 * `useState` calls (`activeTab`, `isTyping`) and its `handleTabClick`
 * handler.
 *
 * Registered under the name `interactiveDemo` in `alpine.ts`.
 * `InteractiveDemo.tsx` (the Hono JSX component) only ever *names* this
 * module and its `selectTab` method in HTML attributes
 * (`x-data="interactiveDemo"`, `x-on:click="selectTab('write')"`,
 * `x-show="activeTab === 'write'"`) -- every attribute expression above is
 * grammar the `@alpinejs/csp` build's restricted evaluator accepts
 * (bare identifiers, member/call expressions on registered scope, string
 * literals, `===`/`!`), never an inline function body. All actual logic
 * -- the guard against re-selecting the active tab, and the typing-delay
 * timeout -- lives here, in a plain, unit-testable function.
 *
 * Height transition: swapping tabs and revealing the AI response (the
 * `isTyping` flip) both change the active panel's content height, which
 * used to jump instead of grow (see `demo.css`'s `.demo-window-body`
 * comment). Both of those are separate mutations -- `activeTab`/`isTyping`
 * change together on tab click, then `isTyping` changes again, alone,
 * after the typing delay -- and *each* needs its own freeze/grow pair:
 * `transitionHeightAcross` freezes `.demo-window-body`'s current height as
 * an explicit pixel value (forcing a synchronous reflow so the browser
 * commits that value -- without it, the freeze write and the later grow
 * write can land in the same style-recalculation batch with no repaint in
 * between, and the browser collapses them into a jump with nothing to
 * animate from, which is what shipped initially and only showed up
 * against a real browser, not the unit tests), runs the mutation, then --
 * once Alpine's `$nextTick` confirms that mutation's reactive DOM update
 * has actually applied -- hands off to `growToContent`, which measures the
 * new natural content height and sets that as the new explicit height, so
 * `demo.css`'s `transition: height` animates between the two pixel
 * values (see `growToContent`'s own comment for why that measurement
 * needs its own reflow dance, not just a `scrollHeight` read).
 * `this.$root`/`this.$nextTick` are Alpine magics, only present when this
 * module is actually running under Alpine -- both are accessed with `?.`
 * so calling `selectTab()` directly in a unit test (no `$root`, no real
 * DOM) still exercises the tab/typing state changes without throwing.
 * `$root` specifically, not `$el`: `$el` resolves to whichever element the
 * *currently-evaluating directive* lives on, which for `selectTab` is
 * always the clicked tab *button*, not the `x-data="interactiveDemo"`
 * section `.demo-window-body` lives inside -- confirmed against a real
 * browser, where `this.$el` inside a click-triggered call is the `BUTTON`
 * element, so `this.$el.querySelector(".demo-window-body")` always
 * returned `null` and every height write below silently no-opped. `$root`
 * always resolves to the closest `x-data` element regardless of which
 * directive triggered the call, which is what this actually needs.
 */
/** Minimal shape `growToContent` needs; matches `HTMLElement` at runtime. */
export interface HeightTransitionContainer {
  style: { height: string };
  offsetHeight: number;
  addEventListener(type: "transitionend", listener: (event: { propertyName: string }) => void, options?: { once?: boolean }): void;
}

export interface InteractiveDemoData {
  activeTab: string;
  isTyping: boolean;
  selectTab(this: InteractiveDemoData, id: string): void;
  /**
   * Alpine `$root` magic: the closest `x-data="interactiveDemo"` element
   * (the `<section>`), regardless of which directive/element triggered
   * the call -- see the module comment for why this must be `$root`, not
   * `$el`. Declared as this minimal shape (not the real DOM `Element`
   * type) because that's all `selectTab` needs -- same rationale as
   * `HeightTransitionContainer`. Only bound once this module is actually
   * running under Alpine; `selectTab` accesses it with `?.` so calling it
   * directly in a unit test (no `$root`) still exercises the tab/typing
   * state changes without throwing.
   */
  $root?: { querySelector(selector: string): HeightTransitionContainer | null };
  /** Alpine `$nextTick` magic: schedules `callback` after Alpine's next reactive DOM update. Same optional/`?.` treatment as `$root`. */
  $nextTick?: (callback: () => void) => void;
}

export const DEFAULT_TAB = "patch";
export const TYPING_DELAY_MS = 1000;

const WINDOW_BODY_SELECTOR = ".demo-window-body";

/**
 * Measures `container`'s current natural content height and sets it as an
 * explicit pixel `height`, so a CSS `transition: height` on `container`
 * (see `demo.css`) animates from whatever pixel value the caller froze it
 * at beforehand up to this new one, instead of jumping.
 *
 * Deliberately does *not* just read `container.scrollHeight` while the
 * frozen (old) pixel height is still in place: `scrollHeight` reports
 * whichever is larger, the box's own height or its content's -- so it
 * only ever reveals a *larger* natural size (content overflowing a
 * too-small frozen box), never a *smaller* one (content that no longer
 * fills an already-too-big frozen box, e.g. switching to a shorter demo
 * tab). Confirmed against a real browser, not just reasoning about the
 * spec: measuring that way silently no-ops on every shrink. Toggling to
 * `height: auto` and reading `offsetHeight` gets the true natural size
 * either way, but forces a synchronous reflow that the browser also
 * treats as officially committing "auto"'s value as `container`'s
 * current style -- so reverting to the frozen value and writing the real
 * target immediately after, with no second forced reflow in between,
 * collapses into one jump with nothing to animate from (also confirmed
 * against a real browser). The second `void container.offsetHeight`
 * below re-commits the frozen value as current *before* the final write,
 * which is what actually makes that write register as a transition.
 */
export function growToContent(container: HeightTransitionContainer): void {
  const frozenHeight = container.style.height;
  container.style.height = "auto";
  const targetHeight = container.offsetHeight;
  container.style.height = frozenHeight;
  void container.offsetHeight;

  container.style.height = `${targetHeight}px`;
  container.addEventListener(
    "transitionend",
    (event) => {
      // Clears back to `height: auto` once the transition finishes,
      // listening for `transitionend` on the `height` property
      // specifically rather than a fixed timeout, so a later change to
      // `demo.css`'s transition duration can't drift out of sync with
      // this -- so a later, unrelated reflow (window resize, font swap)
      // isn't locked to a stale pixel value.
      if (event.propertyName === "height") container.style.height = "";
    },
    { once: true },
  );
}

/**
 * Freezes `container`'s current rendered height as an explicit pixel
 * value and forces a synchronous reflow (`void container.offsetHeight`)
 * so the browser commits that value as the current style *before*
 * `mutate()` changes the DOM -- otherwise `mutate()`'s reactive update and
 * `growToContent`'s later write can land in the same style-recalculation
 * batch with no repaint in between, so the browser jumps straight to the
 * final value instead of transitioning from the frozen one. Runs
 * `mutate()`, then waits for `nextTick` (Alpine's `$nextTick` magic,
 * confirming `mutate()`'s DOM update has actually landed) before growing
 * to the new content height.
 */
function transitionHeightAcross(container: HeightTransitionContainer | undefined, nextTick: ((callback: () => void) => void) | undefined, mutate: () => void): void {
  if (container) {
    container.style.height = `${container.offsetHeight}px`;
    void container.offsetHeight;
  }
  mutate();
  nextTick?.(() => {
    if (container) growToContent(container);
  });
}

/**
 * @param typingDelayMs Injectable so tests don't need real 1s timeouts or
 * fake-timer plumbing; `alpine.ts` calls this with no arguments, which
 * defaults to the original component's exact 1000ms delay.
 */
export function interactiveDemo(typingDelayMs: number = TYPING_DELAY_MS): InteractiveDemoData {
  return {
    activeTab: DEFAULT_TAB,
    isTyping: false,
    selectTab(id) {
      if (id === this.activeTab) return;

      const container = this.$root?.querySelector(WINDOW_BODY_SELECTOR) ?? undefined;

      transitionHeightAcross(container, this.$nextTick, () => {
        this.isTyping = true;
        this.activeTab = id;
      });

      setTimeout(() => {
        transitionHeightAcross(container, this.$nextTick, () => {
          this.isTyping = false;
        });
      }, typingDelayMs);
    },
  };
}
