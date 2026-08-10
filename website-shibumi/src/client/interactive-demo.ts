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
 */
export interface InteractiveDemoData {
  activeTab: string;
  isTyping: boolean;
  selectTab(this: InteractiveDemoData, id: string): void;
}

export const DEFAULT_TAB = "patch";
export const TYPING_DELAY_MS = 1000;

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
      this.isTyping = true;
      this.activeTab = id;
      setTimeout(() => {
        this.isTyping = false;
      }, typingDelayMs);
    },
  };
}
