import { randomUUID } from "node:crypto";

export const projectIdentitySchemaVersion = 1 as const;
export const projectIdentityDirectoryName = ".codingsensei";
export const projectIdentityFileName = "project.json";

export interface ProjectIdentity {
  readonly schemaVersion: typeof projectIdentitySchemaVersion;
  readonly projectId: string;
  readonly createdAt: string;
}

export interface ProjectIdentityFactory {
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export function createProjectIdentity(factory: ProjectIdentityFactory = {}): ProjectIdentity {
  const createId = factory.createId ?? randomUUID;
  const now = factory.now ?? (() => new Date());
  const projectId = createId();

  if (!isValidProjectId(projectId)) {
    throw new Error("Project identity factory returned an invalid UUID.");
  }

  return {
    schemaVersion: projectIdentitySchemaVersion,
    projectId,
    createdAt: now().toISOString()
  };
}

export function parseProjectIdentity(content: string): ProjectIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("CodingSensei project identity is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("CodingSensei project identity must be a JSON object.");
  }
  if (parsed.schemaVersion !== projectIdentitySchemaVersion) {
    throw new Error("CodingSensei project identity uses an unsupported schema version.");
  }
  if (typeof parsed.projectId !== "string" || !isValidProjectId(parsed.projectId)) {
    throw new Error("CodingSensei project identity contains an invalid projectId.");
  }
  if (typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt))) {
    throw new Error("CodingSensei project identity contains an invalid createdAt timestamp.");
  }

  return {
    schemaVersion: projectIdentitySchemaVersion,
    projectId: parsed.projectId,
    createdAt: parsed.createdAt
  };
}

export function serializeProjectIdentity(identity: ProjectIdentity): string {
  return `${JSON.stringify(identity, null, 2)}\n`;
}

export function isValidProjectId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
