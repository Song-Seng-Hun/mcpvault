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
 * comment). `selectTab` freezes `.demo-window-body`'s current height as an
 * explicit pixel value *before* mutating `activeTab`/`isTyping`, then --
 * once Alpine's `$nextTick` confirms the reactive DOM update from that
 * mutation has actually applied -- hands off to `growToContent`, which
 * measures the new `scrollHeight` and sets that as the new explicit
 * height, so `demo.css`'s `transition: height` animates between the two
 * pixel values. `this.$el`/`this.$nextTick` are Alpine magics, only
 * present when this module is actually running under Alpine -- both are
 * accessed with `?.` so calling `selectTab()` directly in a unit test
 * (no `$el`, no real DOM) still exercises the tab/typing state changes
 * without throwing.
 */
/** Minimal shape `growToContent` needs; matches `HTMLElement` at runtime. */
export interface HeightTransitionContainer {
  style: { height: string };
  offsetHeight: number;
  scrollHeight: number;
  addEventListener(type: "transitionend", listener: (event: { propertyName: string }) => void, options?: { once?: boolean }): void;
}

export interface InteractiveDemoData {
  activeTab: string;
  isTyping: boolean;
  selectTab(this: InteractiveDemoData, id: string): void;
  /**
   * Alpine `$el` magic: the root element `x-data="interactiveDemo"` is on.
   * Declared as this minimal shape (not the real DOM `Element` type)
   * because that's all `selectTab` needs -- same rationale as
   * `HeightTransitionContainer`. Only bound once this module is actually
   * running under Alpine; `selectTab` accesses it with `?.` so calling it
   * directly in a unit test (no `$el`) still exercises the tab/typing
   * state changes without throwing.
   */
  $el?: { querySelector(selector: string): HeightTransitionContainer | null };
  /** Alpine `$nextTick` magic: schedules `callback` after Alpine's next reactive DOM update. Same optional/`?.` treatment as `$el`. */
  $nextTick?: (callback: () => void) => void;
}

export const DEFAULT_TAB = "patch";
export const TYPING_DELAY_MS = 1000;

const WINDOW_BODY_SELECTOR = ".demo-window-body";

/**
 * Measures `container`'s current content height and sets it as an
 * explicit pixel `height`, so a CSS `transition: height` on `container`
 * (see `demo.css`) animates from whatever pixel value the caller froze it
 * at beforehand up to this new one, instead of jumping. Clears back to
 * `height: auto` once that transition finishes -- listening for
 * `transitionend` on the `height` property specifically, not a fixed
 * timeout, so a later change to `demo.css`'s transition duration can't
 * drift out of sync with this -- so a later, unrelated reflow (window
 * resize, font swap) isn't locked to a stale pixel value.
 */
export function growToContent(container: HeightTransitionContainer): void {
  container.style.height = `${container.scrollHeight}px`;
  container.addEventListener(
    "transitionend",
    (event) => {
      if (event.propertyName === "height") container.style.height = "";
    },
    { once: true },
  );
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

      const container = this.$el?.querySelector(WINDOW_BODY_SELECTOR) ?? undefined;
      // Freeze the pre-mutation height *before* activeTab/isTyping change,
      // while `.demo-window-body` still shows the old content -- growToContent
      // measures the *new* content's height later, once $nextTick confirms
      // Alpine's reactive update has applied.
      if (container) container.style.height = `${container.offsetHeight}px`;

      this.isTyping = true;
      this.activeTab = id;
      this.$nextTick?.(() => {
        if (container) growToContent(container);
      });

      setTimeout(() => {
        this.isTyping = false;
        this.$nextTick?.(() => {
          if (container) growToContent(container);
        });
      }, typingDelayMs);
    },
  };
}
