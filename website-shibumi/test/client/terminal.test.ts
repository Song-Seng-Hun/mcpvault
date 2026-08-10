/**
 * Unit tests for the `terminal` Alpine.data() module (install page tab
 * switching, copy-to-clipboard feedback, and the typing animation).
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_TAB, INSPECTOR_COMMANDS, isTypingDone, nextTypedState, terminal } from "../../src/client/terminal";

function fakeClipboard(overrides: { writeText?: (text: string) => Promise<void> } = {}) {
  const written: string[] = [];
  return {
    written,
    writeText: overrides.writeText ?? (async (text: string) => void written.push(text)),
  };
}

describe("nextTypedState()", () => {
  test("reveals one more char of the first unfinished line", () => {
    const commands = ["abc", "de"];
    expect(nextTypedState(commands, ["", ""])).toEqual(["a", ""]);
    expect(nextTypedState(commands, ["a", ""])).toEqual(["ab", ""]);
    expect(nextTypedState(commands, ["ab", ""])).toEqual(["abc", ""]);
  });

  test("moves to the next line once the current one is complete", () => {
    const commands = ["ab", "cd"];
    expect(nextTypedState(commands, ["ab", ""])).toEqual(["ab", "c"]);
  });

  test("is a no-op once every line is fully typed", () => {
    const commands = ["ab", "cd"];
    const done = ["ab", "cd"];
    expect(nextTypedState(commands, done)).toEqual(done);
  });
});

describe("isTypingDone()", () => {
  test("false while any line is incomplete", () => {
    expect(isTypingDone(["ab", "cd"], ["ab", "c"])).toBe(false);
  });

  test("true once every line matches its full command", () => {
    expect(isTypingDone(["ab", "cd"], ["ab", "cd"])).toBe(true);
  });
});

describe("terminal()", () => {
  test("defaults to the standard tab", () => {
    const data = terminal([], fakeClipboard());
    expect(data.activeTab).toBe(DEFAULT_TAB);
    expect(data.activeTab).toBe("standard");
  });

  test("defaults typed to an empty string per command", () => {
    const data = terminal(["one", "two"], fakeClipboard());
    expect(data.typed).toEqual(["", ""]);
  });

  test("selectTab() switches the active tab", () => {
    const data = terminal([], fakeClipboard());
    data.selectTab("claude-code");
    expect(data.activeTab).toBe("claude-code");
  });

  test("selectTab() is a no-op when re-selecting the active tab", () => {
    const data = terminal([], fakeClipboard());
    data.selectTab("standard");
    expect(data.activeTab).toBe("standard");
  });

  test("copy() writes to the clipboard and sets copiedText", async () => {
    const clipboard = fakeClipboard();
    const data = terminal([], clipboard);
    await data.copy("npm install -g @modelcontextprotocol/inspector");
    expect(clipboard.written).toEqual(["npm install -g @modelcontextprotocol/inspector"]);
    expect(data.copiedText).toBe("npm install -g @modelcontextprotocol/inspector");
  });

  test("copy() reverts copiedText to null after the feedback window", async () => {
    const data = terminal([], fakeClipboard(), 25, 5);
    await data.copy("some command");
    expect(data.copiedText).toBe("some command");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(data.copiedText).toBeNull();
  });

  test("copy() ignores an undefined payload (button with no data-copy)", async () => {
    const clipboard = fakeClipboard();
    const data = terminal([], clipboard);
    await data.copy(undefined);
    expect(clipboard.written).toEqual([]);
    expect(data.copiedText).toBeNull();
  });

  test("copy() leaves copiedText unset when the clipboard write rejects", async () => {
    const clipboard = fakeClipboard({
      writeText: async () => {
        throw new Error("clipboard permission denied");
      },
    });
    const data = terminal([], clipboard);
    await data.copy("some command");
    expect(data.copiedText).toBeNull();
  });

  test("startTyping() reveals every command over time, one char at a time", async () => {
    const data = terminal(["ab", "c"], fakeClipboard(), 5);
    data.startTyping();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(data.typed).toEqual(["ab", "c"]);
  });

  test("startTyping() with no commands does not throw or hang", () => {
    const data = terminal([], fakeClipboard());
    expect(() => data.startTyping()).not.toThrow();
  });

  test("the real INSPECTOR_COMMANDS default matches Terminal.tsx's copy payloads", () => {
    expect(INSPECTOR_COMMANDS).toEqual(["npm install -g @modelcontextprotocol/inspector", "mcp-inspector npx @bitbonsai/mcpvault@latest /path/to/vault"]);
  });
});
