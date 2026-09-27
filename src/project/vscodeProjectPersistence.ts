import { TextDecoder, TextEncoder } from "node:util";

import * as vscode from "vscode";

import type { WorkspaceRoot } from "../core/models";
import { projectIdentityDirectoryName, projectIdentityFileName } from "./projectIdentity";
import type { ProjectPersistenceAdapter } from "./projectPersistence";

const projectManifestFileName = "project.json";
const projectCatalogFileName = "catalog.json";
const projectMetadataIgnoreFileName = ".gitignore";
const projectMetadataIgnoreContents = "*\n";
const projectKnowledgeDirectoryName = "knowledge";

export function createVsCodeProjectPersistenceAdapter(
  globalStorageUri: vscode.Uri
): ProjectPersistenceAdapter {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return {
    readProjectIdentity: async (root) => readTextIfExists(projectIdentityUri(root), decoder),
    writeProjectIdentity: async (root, content) => {
      const directory = projectIdentityDirectory(root);
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(directory, projectIdentityFileName),
        encoder.encode(content)
      );
    },
    ensureProjectMetadataIgnored: async (root) => {
      const directory = projectIdentityDirectory(root);
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(directory, projectMetadataIgnoreFileName),
        encoder.encode(projectMetadataIgnoreContents)
      );
    },
    writeProjectManifest: async (projectId, content) => {
      const directory = projectStorageDirectory(globalStorageUri, projectId);
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(directory, projectManifestFileName),
        encoder.encode(content)
      );
    },
    readProjectCatalog: async (projectId) =>
      readTextIfExists(
        vscode.Uri.joinPath(
          projectStorageDirectory(globalStorageUri, projectId),
          projectCatalogFileName
        ),
        decoder
      ),
    writeProjectCatalog: async (projectId, content) => {
      const directory = projectStorageDirectory(globalStorageUri, projectId);
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(directory, projectCatalogFileName),
        encoder.encode(content)
      );
    },
    readProjectKnowledge: async (projectId, knowledgeKey) =>
      readTextIfExists(projectKnowledgeUri(globalStorageUri, projectId, knowledgeKey), decoder),
    writeProjectKnowledge: async (projectId, knowledgeKey, content) => {
      const directory = vscode.Uri.joinPath(
        projectStorageDirectory(globalStorageUri, projectId),
        projectKnowledgeDirectoryName
      );
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(directory, `${knowledgeKey}.json`),
        encoder.encode(content)
      );
    },
    deleteProjectKnowledge: async (projectId, knowledgeKey) => {
      const uri = projectKnowledgeUri(globalStorageUri, projectId, knowledgeKey);
      try {
        await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
      } catch (error) {
        if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") {
          throw error;
        }
      }
    },
    deleteAllProjectKnowledge: async (projectId) => {
      const directory = vscode.Uri.joinPath(
        projectStorageDirectory(globalStorageUri, projectId),
        projectKnowledgeDirectoryName
      );
      await deleteDirectoryIfExists(directory);
    },
    deleteProjectStorage: async (projectId) => {
      const directory = projectStorageDirectory(globalStorageUri, projectId);
      await deleteDirectoryIfExists(directory);
    }
  };
}

async function deleteDirectoryIfExists(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") {
      throw error;
    }
  }
}

function projectIdentityDirectory(root: WorkspaceRoot): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.parse(root.uri), projectIdentityDirectoryName);
}

function projectIdentityUri(root: WorkspaceRoot): vscode.Uri {
  return vscode.Uri.joinPath(projectIdentityDirectory(root), projectIdentityFileName);
}

function projectStorageDirectory(globalStorageUri: vscode.Uri, projectId: string): vscode.Uri {
  return vscode.Uri.joinPath(globalStorageUri, "projects", projectId);
}

async function readTextIfExists(
  uri: vscode.Uri,
  decoder: TextDecoder
): Promise<string | undefined> {
  try {
    return decoder.decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
      return undefined;
    }
    throw error;
  }
}

function projectKnowledgeUri(
  globalStorageUri: vscode.Uri,
  projectId: string,
  knowledgeKey: string
): vscode.Uri {
  return vscode.Uri.joinPath(
    projectStorageDirectory(globalStorageUri, projectId),
    projectKnowledgeDirectoryName,
    `${knowledgeKey}.json`
  );
}
