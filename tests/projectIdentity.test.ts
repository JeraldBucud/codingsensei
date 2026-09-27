import { describe, expect, it } from "vitest";

import {
  createProjectIdentity,
  parseProjectIdentity,
  serializeProjectIdentity
} from "../src/project/projectIdentity";

const projectId = "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41";

describe("project identity", () => {
  it("creates and round-trips a versioned stable project identity", () => {
    const identity = createProjectIdentity({
      createId: () => projectId,
      now: () => new Date("2026-09-26T14:30:00.000Z")
    });

    expect(identity).toEqual({
      schemaVersion: 1,
      projectId,
      createdAt: "2026-09-26T14:30:00.000Z"
    });
    expect(parseProjectIdentity(serializeProjectIdentity(identity))).toEqual(identity);
  });

  it("rejects unsupported schema versions", () => {
    expect(() =>
      parseProjectIdentity(
        JSON.stringify({
          schemaVersion: 2,
          projectId,
          createdAt: "2026-09-26T14:30:00.000Z"
        })
      )
    ).toThrow("unsupported schema version");
  });

  it("rejects malformed project identifiers instead of silently replacing them", () => {
    expect(() =>
      parseProjectIdentity(
        JSON.stringify({
          schemaVersion: 1,
          projectId: "not-a-project-id",
          createdAt: "2026-09-26T14:30:00.000Z"
        })
      )
    ).toThrow("invalid projectId");
  });
});
