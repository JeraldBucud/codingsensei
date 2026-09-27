import { describe, expect, it } from "vitest";

import type { WorkspaceRoot } from "../src/core/models";
import {
  createProjectCatalog,
  parseProjectCatalog,
  restoreProjectIndexFromCatalog,
  serializeProjectCatalog
} from "../src/project/projectCatalog";
import { buildProjectIndex } from "../src/project/projectScanner";

const root: WorkspaceRoot = {
  name: "demo",
  uri: "file:///demo",
  path: "/demo"
};

describe("persistent project catalog", () => {
  it("round-trips enough structural data to restore a project index", () => {
    const index = buildProjectIndex({
      root,
      sourceFiles: [{ relativePath: "src/app.ts" }, { relativePath: "src/app.test.ts" }],
      metadataFiles: [
        {
          relativePath: "package.json",
          content: JSON.stringify({
            scripts: { test: "vitest", build: "tsc" },
            dependencies: { react: "^19.0.0" }
          })
        }
      ],
      scanLimit: 2500,
      scanTruncated: false
    });
    const catalog = createProjectCatalog(
      "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41",
      index,
      () => new Date("2026-09-27T08:00:00.000Z")
    );

    const parsed = parseProjectCatalog(serializeProjectCatalog(catalog));
    expect(parsed).toEqual(catalog);
    if (!parsed) {
      throw new Error("Expected a valid persisted project catalog.");
    }

    const movedRoot: WorkspaceRoot = {
      name: "demo-moved",
      uri: "file:///moved/demo-moved",
      path: "/moved/demo-moved"
    };
    const restored = restoreProjectIndexFromCatalog(movedRoot, parsed);

    expect(restored.root).toEqual(movedRoot);
    expect(restored.codeFiles).toEqual(index.codeFiles);
    expect(restored.sourceFiles).toEqual(index.sourceFiles);
    expect(restored.testFiles).toEqual(index.testFiles);
    expect(restored.tools).toEqual(index.tools);
    expect(restored.scripts).toEqual(index.scripts);
    expect(restored.metadata).toEqual(index.metadata);
  });

  it("rejects incomplete or incompatible catalogs", () => {
    expect(
      parseProjectCatalog(
        JSON.stringify({
          schemaVersion: 99,
          projectId: "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41"
        })
      )
    ).toBeUndefined();
  });
});
