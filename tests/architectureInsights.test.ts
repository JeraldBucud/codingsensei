import { describe, expect, it } from "vitest";

import { analyzeArchitecture } from "../src/project/architectureInsights";
import type { StructuralGraph } from "../src/project/structuralGraph";

const graph: StructuralGraph = {
  projectId: "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41",
  totalFileCount: 5,
  indexedFileCount: 5,
  fileCount: 5,
  symbolCount: 0,
  relationshipCount: 4,
  nodes: [
    {
      id: "file:src/main.ts",
      kind: "file",
      file: "src/main.ts",
      frameworks: ["express"],
      frameworkRoles: ["application-bootstrap"],
      entryPointSignals: ["possible main/module entry point"]
    },
    {
      id: "file:src/routes/users.ts",
      kind: "file",
      file: "src/routes/users.ts",
      frameworks: ["express"],
      frameworkRoles: ["router", "route-handler"],
      entryPointSignals: []
    },
    {
      id: "file:src/services/UserService.ts",
      kind: "file",
      file: "src/services/UserService.ts",
      frameworks: [],
      frameworkRoles: ["service"],
      entryPointSignals: []
    },
    {
      id: "file:src/models/User.ts",
      kind: "file",
      file: "src/models/User.ts",
      frameworks: [],
      frameworkRoles: [],
      entryPointSignals: []
    },
    {
      id: "file:src/services/UserService.test.ts",
      kind: "file",
      file: "src/services/UserService.test.ts",
      frameworks: [],
      frameworkRoles: [],
      entryPointSignals: []
    }
  ],
  edges: [
    {
      id: "imports:file:src/main.ts->file:src/routes/users.ts",
      type: "imports",
      from: "file:src/main.ts",
      to: "file:src/routes/users.ts",
      fromFile: "src/main.ts",
      toFile: "src/routes/users.ts",
      confidence: "high",
      reason: "Local import."
    },
    {
      id: "calls:file:src/routes/users.ts->file:src/services/UserService.ts",
      type: "calls",
      from: "file:src/routes/users.ts",
      to: "file:src/services/UserService.ts",
      fromFile: "src/routes/users.ts",
      toFile: "src/services/UserService.ts",
      confidence: "medium",
      reason: "Route calls service."
    },
    {
      id: "imports:file:src/services/UserService.ts->file:src/models/User.ts",
      type: "imports",
      from: "file:src/services/UserService.ts",
      to: "file:src/models/User.ts",
      fromFile: "src/services/UserService.ts",
      toFile: "src/models/User.ts",
      confidence: "high",
      reason: "Service imports model."
    },
    {
      id: "related-test:file:src/services/UserService.ts->file:src/services/UserService.test.ts",
      type: "related-test",
      from: "file:src/services/UserService.ts",
      to: "file:src/services/UserService.test.ts",
      fromFile: "src/services/UserService.ts",
      toFile: "src/services/UserService.test.ts",
      confidence: "high",
      reason: "Related test."
    }
  ]
};

describe("architecture insights", () => {
  it("classifies deterministic architecture roles from paths and framework evidence", () => {
    const insights = analyzeArchitecture(graph);

    expect(insights.files.find((item) => item.file === "src/main.ts")?.roles).toContain(
      "bootstrap"
    );
    expect(
      insights.files.find((item) => item.file === "src/routes/users.ts")?.roles
    ).toContain("routing");
    expect(
      insights.files.find((item) => item.file === "src/services/UserService.ts")?.roles
    ).toContain("service");
    expect(insights.files.find((item) => item.file === "src/models/User.ts")?.roles).toContain(
      "data"
    );
    expect(
      insights.files.find((item) => item.file === "src/services/UserService.test.ts")?.roles
    ).toContain("test");
  });

  it("builds connected feature clusters and identifies likely entry files", () => {
    const insights = analyzeArchitecture(graph);

    expect(insights.clusters).toHaveLength(1);
    expect(insights.clusters[0]?.files).toHaveLength(5);
    expect(insights.clusters[0]?.roles).toEqual(
      expect.arrayContaining(["bootstrap", "routing", "service", "data", "test"])
    );
    expect(insights.entryFiles).toContain("src/main.ts");
  });


  it("prefers explicit feature-directory clusters when a project uses feature modules", () => {
    const featureGraph: StructuralGraph = {
      ...graph,
      totalFileCount: 4,
      indexedFileCount: 4,
      fileCount: 4,
      symbolCount: 0,
      relationshipCount: 2,
      nodes: [
        {
          id: "file:src/features/auth/Login.tsx",
          kind: "file",
          file: "src/features/auth/Login.tsx",
          frameworks: ["react"],
          frameworkRoles: ["component"],
          entryPointSignals: []
        },
        {
          id: "file:src/features/auth/authService.ts",
          kind: "file",
          file: "src/features/auth/authService.ts",
          frameworks: [],
          frameworkRoles: ["service"],
          entryPointSignals: []
        },
        {
          id: "file:src/features/profile/Profile.tsx",
          kind: "file",
          file: "src/features/profile/Profile.tsx",
          frameworks: ["react"],
          frameworkRoles: ["component"],
          entryPointSignals: []
        },
        {
          id: "file:src/features/profile/profileService.ts",
          kind: "file",
          file: "src/features/profile/profileService.ts",
          frameworks: [],
          frameworkRoles: ["service"],
          entryPointSignals: []
        }
      ],
      edges: [
        {
          id: "imports:file:src/features/auth/Login.tsx->file:src/features/auth/authService.ts",
          type: "imports",
          from: "file:src/features/auth/Login.tsx",
          to: "file:src/features/auth/authService.ts",
          fromFile: "src/features/auth/Login.tsx",
          toFile: "src/features/auth/authService.ts",
          confidence: "high",
          reason: "Auth component imports auth service."
        },
        {
          id: "imports:file:src/features/profile/Profile.tsx->file:src/features/profile/profileService.ts",
          type: "imports",
          from: "file:src/features/profile/Profile.tsx",
          to: "file:src/features/profile/profileService.ts",
          fromFile: "src/features/profile/Profile.tsx",
          toFile: "src/features/profile/profileService.ts",
          confidence: "high",
          reason: "Profile component imports profile service."
        }
      ]
    };

    const insights = analyzeArchitecture(featureGraph);

    expect(insights.clusters[0]).toMatchObject({
      label: "Auth feature",
      basis: "feature-directory",
      files: [
        "src/features/auth/Login.tsx",
        "src/features/auth/authService.ts"
      ]
    });
    expect(insights.clusters).toContainEqual(
      expect.objectContaining({
        label: "Profile feature",
        basis: "feature-directory"
      })
    );
  });

  it("summarizes structural edge types and architecture role counts", () => {
    const insights = analyzeArchitecture(graph);

    expect(insights.edgeCounts).toMatchObject({
      imports: 2,
      calls: 1,
      "related-test": 1
    });
    expect(insights.roleCounts.bootstrap).toBe(1);
    expect(insights.roleCounts.service).toBeGreaterThanOrEqual(1);
    expect(insights.roleCounts.test).toBe(1);
  });
});
