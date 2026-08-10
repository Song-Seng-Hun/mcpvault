/**
 * Unit tests for the `interactiveDemo` Alpine.data() module (Phase 3 step
 * 1). This is the one piece of `InteractiveDemo.tsx`'s ported behavior that
 * is genuinely testable server-side, without a browser/Alpine runtime:
 * `interactiveDemo()` returns a plain object whose `selectTab` method can
 * be called directly. `typingDelayMs` is injectable specifically so these
 * tests don't need real 1s timeouts or fake-timer plumbing.
 *
 * `growToContent()` and `selectTab`'s `$el`/`$nextTick` wiring (the height
 * transition, added when the demo panel's height jump was fixed) are
 * covered with a `FakeContainer` standing in for `.demo-window-body`
 * instead of a real DOM -- same reasoning as `fade-in-observer.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_TAB, growToContent, type HeightTransitionContainer, interactiveDemo, TYPING_DELAY_MS } from "../../src/client/interactive-demo";

class FakeContainer implements HeightTransitionContainer {
  style = { height: "" };
  offsetHeight: number;
  scrollHeight: number;
  private transitionendListener: ((event: { propertyName: string }) => void) | undefined;

  constructor(offsetHeight: number, scrollHeight: number) {
    this.offsetHeight = offsetHeight;
    this.scrollHeight = scrollHeight;
  }

  addEventListener(_type: "transitionend", listener: (event: { propertyName: string }) => void): void {
    this.transitionendListener = listener;
  }

  /** Test helper: simulate the browser firing `transitionend` after the CSS transition completes. */
  fireTransitionEnd(propertyName: string): void {
    this.transitionendListener?.({ propertyName });
  }
}

describe("interactiveDemo()", () => {
  test("defaults to the first example and not typing", () => {
    const data = interactiveDemo();
    expect(data.activeTab).toBe(DEFAULT_TAB);
    expect(data.activeTab).toBe("patch");
    expect(data.isTyping).toBe(false);
  });

  test("defaults the typing delay to the original component's 1000ms", () => {
    expect(TYPING_DELAY_MS).toBe(1000);
  });

  test("selectTab swaps the active tab immediately and flips isTyping on", () => {
    const data = interactiveDemo(0);
    data.selectTab("write");
    expect(data.activeTab).toBe("write");
    expect(data.isTyping).toBe(true);
  });

  test("selectTab is a no-op when re-selecting the already-active tab", () => {
    const data = interactiveDemo(0);
    data.selectTab("patch");
    expect(data.activeTab).toBe("patch");
    expect(data.isTyping).toBe(false);
  });

  test("isTyping flips back off after the typing delay elapses", async () => {
    const data = interactiveDemo(5);
    data.selectTab("search");
    expect(data.isTyping).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(data.isTyping).toBe(false);
    expect(data.activeTab).toBe("search");
  });

  test("switching tabs again while typing restarts on the new tab", () => {
    const data = interactiveDemo(1000);
    data.selectTab("write");
    expect(data.activeTab).toBe("write");
    data.selectTab("frontmatter");
    expect(data.activeTab).toBe("frontmatter");
    expect(data.isTyping).toBe(true);
  });

  test("selectTab tolerates a missing $el/$nextTick (e.g. calling it directly in a unit test, no Alpine runtime)", () => {
    const data = interactiveDemo(0);
    expect(() => data.selectTab("write")).not.toThrow();
  });

  test("selectTab freezes the pre-mutation height immediately, then grows to the post-mutation content height once $nextTick fires", () => {
    const container = new FakeContainer(120, 120);
    const nextTickCallbacks: Array<() => void> = [];
    const data = interactiveDemo(1000);
    data.$el = { querySelector: () => container };
    data.$nextTick = (callback) => {
      nextTickCallbacks.push(callback);
    };

    data.selectTab("write");

    // Frozen at the pre-mutation height synchronously, before $nextTick ever fires.
    expect(container.style.height).toBe("120px");
    expect(nextTickCallbacks).toHaveLength(1);

    // Simulate Alpine's reactive DOM update (the new panel/response actually
    // rendering) landing before $nextTick's callback runs.
    container.scrollHeight = 340;
    nextTickCallbacks[0]?.();

    expect(container.style.height).toBe("340px");
  });

  test("selectTab is a no-op for the height freeze too when re-selecting the already-active tab", () => {
    const container = new FakeContainer(120, 120);
    const data = interactiveDemo(1000);
    data.$el = { querySelector: () => container };
    data.$nextTick = () => {
      throw new Error("$nextTick should not be scheduled when selectTab no-ops");
    };

    data.selectTab("patch");

    expect(container.style.height).toBe("");
  });
});

describe("growToContent()", () => {
  test("sets the container's explicit height to its current scrollHeight", () => {
    const container = new FakeContainer(120, 340);
    growToContent(container);
    expect(container.style.height).toBe("340px");
  });

  test("clears the height back to auto once the height transition ends", () => {
    const container = new FakeContainer(120, 340);
    growToContent(container);
    container.fireTransitionEnd("height");
    expect(container.style.height).toBe("");
  });

  test("ignores transitionend events for properties other than height", () => {
    const container = new FakeContainer(120, 340);
    growToContent(container);
    container.fireTransitionEnd("opacity");
    expect(container.style.height).toBe("340px");
  });
});
