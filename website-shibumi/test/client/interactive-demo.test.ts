/**
 * Unit tests for the `interactiveDemo` Alpine.data() module (Phase 3 step
 * 1). This is the one piece of `InteractiveDemo.tsx`'s ported behavior that
 * is genuinely testable server-side, without a browser/Alpine runtime:
 * `interactiveDemo()` returns a plain object whose `selectTab` method can
 * be called directly. `typingDelayMs` is injectable specifically so these
 * tests don't need real 1s timeouts or fake-timer plumbing.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_TAB, interactiveDemo, TYPING_DELAY_MS } from "../../src/client/interactive-demo";

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
});
