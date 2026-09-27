import type * as vscode from "vscode";

import { CodingSenseiController } from "./commands/registerCommands";
import { WorkspaceContextService } from "./context/workspaceContext";
import { ProgressiveHintEngine } from "./learning/hints";
import { NextStepService } from "./learning/nextSteps";
import { ProjectIntelligenceService } from "./project/projectIntelligence";
import { ProjectPersistenceService } from "./project/projectPersistence";
import { createVsCodeProjectPersistenceAdapter } from "./project/vscodeProjectPersistence";
import { LearningModeViewProvider } from "./ui/learningModeView";

export function activate(context: vscode.ExtensionContext): void {
  const projectPersistence = new ProjectPersistenceService(
    createVsCodeProjectPersistenceAdapter(context.globalStorageUri)
  );
  const controller = new CodingSenseiController(
    new WorkspaceContextService(),
    new ProjectIntelligenceService(undefined, projectPersistence),
    new ProgressiveHintEngine(),
    new NextStepService(),
    new LearningModeViewProvider(context.extensionUri)
  );

  controller.register(context);
}

export function deactivate(): void {
  // No background services require shutdown.
}
