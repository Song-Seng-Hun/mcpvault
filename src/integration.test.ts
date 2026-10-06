import { test, expect, beforeEach, afterEach, describe } from "vitest";
import { PathFilter } from "./pathfilter.js";
import { SearchService } from "./search.js";
import { writeFile, mkdir, mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testVaultPath: string;
let pathFilter: PathFilter;
let searchService: SearchService;

beforeEach(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "mcpvault-integration-"));

  // Initialize services (same as server.ts)
  pathFilter = new PathFilter();
  searchService = new SearchService(testVaultPath, pathFilter);
});

afterEach(async () => {
  try {
    await rm(testVaultPath, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ============================================================================
// INTEGRATION TESTS - END-TO-END WORKFLOW
// ============================================================================

describe("Integration: Service Layer Workflows", () => {
  test("search notes with special characters in filenames", async () => {
    // Create notes with special characters in paths
    const testCases = [
      { path: "folder (archive)/note [old].md", content: "# Old Note\n\nArchived keyword." },
      { path: "C++/notes.md", content: "# C++ Notes\n\nProgramming keyword." },
      { path: "backup.2024/important.md", content: "# Important\n\nBackup keyword." },
      { path: "price$100.md", content: "# Pricing\n\nCost keyword." }
    ];

    // Write all test notes
    for (const { path, content } of testCases) {
      if (path.includes('/')) {
        const dirName = path.split('/')[0];
        if (dirName) {
          await mkdir(join(testVaultPath, dirName), { recursive: true });
        }
      }
      await writeFile(join(testVaultPath, path), content);
    }

    // Search for keyword
    const results = await searchService.search({
      query: "keyword",
      limit: 10
    });

    expect(results.length).toBe(4);

    // Verify paths with special characters are returned correctly
    const paths = results.map((r: any) => r.p);
    expect(paths).toContain("folder (archive)/note [old].md");
    expect(paths).toContain("C++/notes.md");
  });
});

