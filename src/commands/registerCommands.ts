import * as vscode from "vscode";

import type { HintSession, LearningContext, NextStep, ProjectAnalysis } from "../core/models";
import type { FrameworkDetection } from "../framework/models";
import { detectFrameworks } from "../framework/frameworkIntelligence";
import type { LanguageAnalysis, LanguageDocumentInput } from "../language/models";
import { LanguageIntelligenceService } from "../language/languageIntelligence";
import {
  createLanguageProjectContextKey,
  shouldReconcileLanguageProject
} from "../language/projectContextKey";
import { VsCodeLanguageAdapter } from "../language/vscodeLanguageAdapter";
import type { WorkspaceContextService } from "../context/workspaceContext";
import type { ProgressiveHintEngine } from "../learning/hints";
import type { NextStepService } from "../learning/nextSteps";
import type { ProjectIntelligenceService } from "../project/projectIntelligence";
import { isPathInsideProject, stripProjectPrefix } from "../project/projectRootResolver";
import { isIgnoredProjectPath } from "../project/projectScanner";
import { LearningModeViewProvider } from "../ui/learningModeView";
import { DebouncedAction } from "../utils/debouncedAction";
import { IdleWorkQueue } from "../utils/idleWorkQueue";

type RefreshMode = "fast" | "ensure-project" | "refresh-git" | "force-project";

export class CodingSenseiController implements vscode.Disposable {
  private static readonly languageDebounceMs = 350;
  private static readonly backgroundIndexIdleMs = 1200;
  private readonly disposables: vscode.Disposable[] = [];
  private currentContext: LearningContext | undefined;
  private hintSession: HintSession | undefined;
  private nextStep: NextStep | undefined;
  private projectAnalysis: ProjectAnalysis | undefined;
  private languageAnalysis: LanguageAnalysis | undefined;
  private frameworkDetections: readonly FrameworkDetection[] = [];
  private languageProjectContextKey: string | undefined;
  private readonly languageService = new LanguageIntelligenceService(new VsCodeLanguageAdapter());
  private readonly debouncedLanguageRefresh = new DebouncedAction(
    CodingSenseiController.languageDebounceMs,
    () => {
      void this.refreshLanguage(false);
    }
  );
  private readonly backgroundIndexQueue: IdleWorkQueue<vscode.Uri>;

  constructor(
    private readonly contextService: WorkspaceContextService,
    private readonly projectService: ProjectIntelligenceService,
    private readonly hintEngine: ProgressiveHintEngine,
    private readonly nextStepService: NextStepService,
    private readonly viewProvider: LearningModeViewProvider
  ) {
    this.backgroundIndexQueue = new IdleWorkQueue(
      CodingSenseiController.backgroundIndexIdleMs,
      (uri) => uri.toString(),
      async (uri) => {
        await this.projectService.indexSourceFile(uri);
      }
    );
  }

  register(context: vscode.ExtensionContext): void {
    const projectMetadataWatcher = vscode.workspace.createFileSystemWatcher(
      "**/{package.json,tsconfig.json,jsconfig.json,pyproject.toml,requirements.txt,setup.py,setup.cfg,pytest.ini,pom.xml,build.gradle,build.gradle.kts,pnpm-lock.yaml,package-lock.json,yarn.lock,gradlew,gradlew.bat,mvnw,mvnw.cmd}"
    );
    const projectFileWatcher = vscode.workspace.createFileSystemWatcher(
      "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,py,java}"
    );

    this.disposables.push(
      projectMetadataWatcher,
      projectFileWatcher,
      vscode.window.registerWebviewViewProvider(
        LearningModeViewProvider.viewType,
        this.viewProvider
      ),
      vscode.commands.registerCommand("codingsensei.openLearningMode", async () => {
        await vscode.commands.executeCommand("workbench.view.extension.codingsensei");
        await vscode.commands.executeCommand(`${LearningModeViewProvider.viewType}.focus`);
        this.refresh("ensure-project");
      }),
      vscode.commands.registerCommand("codingsensei.refreshLearningContext", () => {
        this.refresh("force-project");
      }),
      vscode.commands.registerCommand("codingsensei.showNextHint", () => {
        this.showNextHint();
      }),
      vscode.commands.registerCommand("codingsensei.resetHints", () => {
        this.resetHints();
      }),
      vscode.commands.registerCommand("codingsensei.showProjectIntelligence", () => {
        this.showProjectIntelligence();
      }),
      vscode.commands.registerCommand("codingsensei.rebuildProjectIntelligence", () => {
        this.refresh("force-project");
      }),
      vscode.commands.registerCommand("codingsensei.clearProjectIntelligence", async () => {
        await this.clearProjectIntelligence();
      }),
      vscode.commands.registerCommand("codingsensei.showStructuralIntelligence", async () => {
        await this.showStructuralIntelligence();
      }),
      vscode.commands.registerCommand("codingsensei.findRelevantProjectFiles", async () => {
        await this.findRelevantProjectFiles();
      }),
      vscode.commands.registerCommand("codingsensei.buildStructuralIntelligence", async () => {
        await this.buildStructuralIntelligence();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.refresh("ensure-project");
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.refresh("fast");
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isActiveDocument(event.document)) {
          this.backgroundIndexQueue.defer();
          this.refresh("fast");
          this.scheduleLanguageRefresh();
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (isActiveDocument(document)) {
          this.refresh("refresh-git");
        }
      }),
      projectMetadataWatcher.onDidChange((uri) => {
        void this.invalidateChangedProject(uri);
      }),
      projectMetadataWatcher.onDidCreate((uri) => {
        void this.invalidateChangedProject(uri);
      }),
      projectMetadataWatcher.onDidDelete((uri) => {
        void this.invalidateChangedProject(uri);
      }),
      projectFileWatcher.onDidChange((uri) => {
        void this.updateChangedSourceFile(uri, "change");
      }),
      projectFileWatcher.onDidCreate((uri) => {
        void this.updateChangedSourceFile(uri, "create");
      }),
      projectFileWatcher.onDidDelete((uri) => {
        void this.updateChangedSourceFile(uri, "delete");
      }),
      vscode.languages.onDidChangeDiagnostics((event) => {
        const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;
        if (
          activeDocumentUri &&
          event.uris.some((uri) => uri.toString() === activeDocumentUri.toString())
        ) {
          this.refresh("fast");
        }
      })
    );

    context.subscriptions.push(this);
    this.refresh("ensure-project");
  }

  dispose(): void {
    this.debouncedLanguageRefresh.cancel();
    this.backgroundIndexQueue.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private refresh(mode: RefreshMode = "ensure-project"): void {
    const previousHintSession = this.hintSession;
    this.currentContext = this.contextService.collect();
    this.projectAnalysis =
      mode === "force-project"
        ? {
            status: "analyzing",
            root: this.currentContext.workspace.activeWorkspaceRoot,
            message: "Analyzing project context locally."
          }
        : this.projectService.getCached(this.currentContext.activeEditor);
    this.hintSession = this.hintEngine.createSession(this.currentContext);
    if (previousHintSession?.targetKey === this.hintSession.targetKey) {
      this.hintSession = {
        ...this.hintSession,
        currentIndex: Math.min(
          previousHintSession.currentIndex,
          Math.max(this.hintSession.hints.length - 1, 0)
        )
      };
    }
    this.languageAnalysis = this.languageService.getCached(this.collectLanguageDocumentIdentity());
    this.nextStep = this.nextStepService.choose(
      this.currentContext,
      this.projectAnalysis,
      this.languageAnalysis,
      this.frameworkDetections
    );
    this.publish();
    switch (mode) {
      case "fast":
        this.reconcileLanguageWithCachedProject();
        return;
      case "refresh-git":
        this.debouncedLanguageRefresh.cancel();
        void this.refreshLanguage(true);
        void this.refreshGit();
        return;
      case "force-project":
        this.debouncedLanguageRefresh.cancel();
        void this.refreshLanguage(true);
        void this.refreshProject({ force: true, refreshGit: true });
        return;
      case "ensure-project":
        this.debouncedLanguageRefresh.cancel();
        void this.refreshLanguage(false);
        void this.refreshProject({ force: false, refreshGit: true });
        return;
    }
  }

  private async refreshProject(options: {
    readonly force: boolean;
    readonly refreshGit: boolean;
  }): Promise<void> {
    if (!this.currentContext) {
      return;
    }

    const contextAtStart = this.currentContext;
    const analysis = await this.projectService.analyze(contextAtStart.activeEditor, options);
    if (this.currentContext !== contextAtStart) {
      this.refresh("fast");
      return;
    }

    this.projectAnalysis = analysis;
    this.nextStep = this.nextStepService.choose(
      this.currentContext,
      this.projectAnalysis,
      this.languageAnalysis,
      this.frameworkDetections
    );
    this.publish();
    this.reconcileLanguageAfterProjectReady(contextAtStart);
  }

  private async refreshGit(): Promise<void> {
    if (!this.currentContext) {
      return;
    }

    const contextAtStart = this.currentContext;
    const analysis = await this.projectService.refreshGit(contextAtStart.activeEditor);
    if (this.currentContext !== contextAtStart) {
      return;
    }

    this.projectAnalysis = analysis;
    this.nextStep = this.nextStepService.choose(
      this.currentContext,
      this.projectAnalysis,
      this.languageAnalysis,
      this.frameworkDetections
    );
    this.publish();
  }

  private async refreshLanguage(force: boolean, allowRestore = !force): Promise<void> {
    if (!this.currentContext) {
      return;
    }

    const document = this.collectLanguageDocument();
    if (!document) {
      this.languageAnalysis = this.languageService.getCached(undefined);
      this.frameworkDetections = [];
      return;
    }

    const contextAtStart = this.currentContext;
    if (allowRestore) {
      const restored = await this.projectService.restoreLanguageKnowledge(
        this.projectAnalysis?.snapshot?.root,
        document
      );
      if (this.currentContext !== contextAtStart) {
        return;
      }
      if (restored) {
        this.languageAnalysis = this.languageService.prime(document, restored.analysis);
        this.frameworkDetections = restored.frameworks;
        this.languageProjectContextKey = createLanguageProjectContextKey({
          document,
          snapshot: this.projectAnalysis?.snapshot
        });
        this.nextStep = this.nextStepService.choose(
          this.currentContext,
          this.projectAnalysis,
          this.languageAnalysis,
          this.frameworkDetections
        );
        this.publish();
        return;
      }
    }

    const analysis = await this.languageService.analyze(document, force);
    if (this.currentContext !== contextAtStart) {
      return;
    }

    this.languageAnalysis = analysis;
    this.frameworkDetections = this.collectFrameworkDetections(document, analysis);
    void this.projectService.saveLanguageKnowledge(
      this.projectAnalysis?.snapshot?.root,
      document,
      analysis,
      this.frameworkDetections
    );
    this.languageProjectContextKey = createLanguageProjectContextKey({
      document,
      snapshot: this.projectAnalysis?.snapshot
    });
    this.nextStep = this.nextStepService.choose(
      this.currentContext,
      this.projectAnalysis,
      this.languageAnalysis,
      this.frameworkDetections
    );
    this.publish();
  }

  private scheduleLanguageRefresh(): void {
    this.debouncedLanguageRefresh.schedule();
  }

  private reconcileLanguageAfterProjectReady(contextAtStart: LearningContext): void {
    if (this.currentContext !== contextAtStart) {
      return;
    }
    this.reconcileLanguageWithCachedProject();
  }

  private reconcileLanguageWithCachedProject(): void {
    if (this.projectAnalysis?.status !== "ready" || !this.projectAnalysis.snapshot) {
      return;
    }

    const document = this.collectLanguageProjectIdentity();
    const nextKey = createLanguageProjectContextKey({
      document,
      snapshot: this.projectAnalysis.snapshot
    });
    if (
      shouldReconcileLanguageProject({
        previousKey: this.languageProjectContextKey,
        nextKey
      })
    ) {
      this.debouncedLanguageRefresh.cancel();
      void this.refreshLanguage(true, true);
    }
  }

  private async updateChangedSourceFile(
    uri: vscode.Uri,
    change: "create" | "change" | "delete"
  ): Promise<void> {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    if (isIgnoredProjectPath(relativePath)) {
      return;
    }

    const changedRoot = await this.projectService.updateSourceFile(uri, change);
    if (change !== "delete") {
      this.backgroundIndexQueue.enqueue(uri);
    }

    const activeRoot =
      this.projectAnalysis?.root ?? this.currentContext?.workspace.activeWorkspaceRoot;
    const activeFile = this.currentContext?.activeEditor?.relativePath;
    if (
      changedRoot?.uri === activeRoot?.uri ||
      (changedRoot && isPathInsideProject(activeFile, changedRoot))
    ) {
      this.refresh("fast");
    }
  }

  private async invalidateChangedProject(uri: vscode.Uri): Promise<void> {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    if (isIgnoredProjectPath(relativePath)) {
      return;
    }

    const changedRoot = await this.projectService.invalidateUri(uri);
    const activeRoot =
      this.projectAnalysis?.root ?? this.currentContext?.workspace.activeWorkspaceRoot;
    const activeFile = this.currentContext?.activeEditor?.relativePath;
    if (
      changedRoot?.uri === activeRoot?.uri ||
      (changedRoot && isPathInsideProject(activeFile, changedRoot))
    ) {
      this.refresh("force-project");
    }
  }

  private async showStructuralIntelligence(): Promise<void> {
    if (!this.currentContext) {
      return;
    }

    const graph = await this.projectService.getStructuralGraph(this.currentContext.activeEditor);
    if (!graph) {
      void vscode.window.showInformationMessage(
        "CodingSensei structural intelligence is not available for the active project yet."
      );
      return;
    }

    void vscode.window.showInformationMessage(
      `CodingSensei structural intelligence: ${String(graph.indexedFileCount)}/${String(graph.totalFileCount)} files indexed · ${String(graph.symbolCount)} symbols · ${String(graph.relationshipCount)} relationships`
    );
  }

  private async findRelevantProjectFiles(): Promise<void> {
    if (!this.currentContext) {
      return;
    }

    const query = await vscode.window.showInputBox({
      title: "CodingSensei: Find Relevant Project Files",
      prompt: "Describe what you are looking for. Leave blank to use structural relationships from the active file.",
      placeHolder: "for example: user service, route handler, tests"
    });
    if (query === undefined) {
      return;
    }

    const results = await this.projectService.retrieveStructuralContext(
      this.currentContext.activeEditor,
      query,
      12
    );
    if (results.length === 0) {
      void vscode.window.showInformationMessage(
        "CodingSensei did not find structurally relevant indexed files. Build Deep Project Intelligence to increase coverage."
      );
      return;
    }

    const selected = await vscode.window.showQuickPick(
      results.map((result) => ({
        label: result.file,
        description: `score ${String(result.score)}`,
        detail: [...result.reasons, ...result.matchedSymbols.map((name) => `symbol: ${name}`)].join(
          " · "
        ),
        file: result.file
      })),
      {
        title: "CodingSensei: Relevant Project Files",
        placeHolder: "Select a file to open",
        matchOnDescription: true,
        matchOnDetail: true
      }
    );
    if (!selected) {
      return;
    }

    const root = this.projectAnalysis?.snapshot?.root;
    if (!root) {
      return;
    }
    const uri = vscode.Uri.joinPath(vscode.Uri.parse(root.uri), ...selected.file.split("/"));
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  }

  private async buildStructuralIntelligence(): Promise<void> {
    if (!this.currentContext) {
      return;
    }

    let lastPercent = 0;
    const summary = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "CodingSensei: Building deep project intelligence",
        cancellable: true
      },
      async (progress, token) =>
        this.projectService.buildDeepProjectIntelligence(this.currentContext?.activeEditor, {
          shouldCancel: () => token.isCancellationRequested,
          onProgress: (state) => {
            const percent =
              state.total === 0 ? 100 : Math.floor((state.processed / state.total) * 100);
            progress.report({
              increment: Math.max(0, percent - lastPercent),
              message: `${String(state.processed)}/${String(state.total)} files`
            });
            lastPercent = percent;
          }
        })
    );

    if (!summary) {
      void vscode.window.showWarningMessage(
        "CodingSensei could not build deep intelligence for the active project."
      );
      return;
    }

    const suffix = summary.truncated ? " · bounded to the first 1000 code files" : "";
    const state = summary.cancelled ? "cancelled" : "complete";
    void vscode.window.showInformationMessage(
      `CodingSensei deep indexing ${state}: ${String(summary.indexed)} indexed · ${String(summary.reused)} reused · ${String(summary.skipped)} skipped${suffix}`
    );
  }

  private showProjectIntelligence(): void {
    const analysis = this.projectAnalysis;
    if (analysis?.status !== "ready" || !analysis.snapshot) {
      void vscode.window.showInformationMessage(
        "CodingSensei project intelligence is not ready yet."
      );
      return;
    }

    const persistence = analysis.persistence;
    const persistenceLabel =
      persistence?.status === "ready" && persistence.projectId
        ? `persistent · ${persistence.projectId.slice(0, 8)}`
        : persistence?.status === "unavailable"
          ? "persistence unavailable"
          : "in-memory only";
    const snapshot = analysis.snapshot;
    void vscode.window.showInformationMessage(
      `CodingSensei: ${snapshot.root.name} · ${persistenceLabel} · ${String(snapshot.sourceFileCount)} source · ${String(snapshot.testFileCount)} test`
    );
  }

  private async clearProjectIntelligence(): Promise<void> {
    if (!this.currentContext) {
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      "Clear CodingSensei's stored project intelligence? The stable .codingsensei project identity will be kept.",
      { modal: true },
      "Clear Stored Intelligence"
    );
    if (confirmation !== "Clear Stored Intelligence") {
      return;
    }

    const cleared = await this.projectService.clearPersistentData(this.currentContext.activeEditor);
    if (cleared) {
      void vscode.window.showInformationMessage(
        "CodingSensei stored project intelligence was cleared. It will be rebuilt when needed."
      );
      this.projectAnalysis = this.projectService.getCached(this.currentContext.activeEditor);
      this.publish();
    } else {
      void vscode.window.showWarningMessage(
        "CodingSensei could not clear stored project intelligence for the active project."
      );
    }
  }

  private showNextHint(): void {
    if (!this.currentContext) {
      this.refresh("ensure-project");
      return;
    }

    this.hintSession = this.hintEngine.showNext(
      this.hintSession ?? this.hintEngine.createSession(this.currentContext)
    );
    this.publish();
  }

  private resetHints(): void {
    if (!this.currentContext) {
      this.refresh("ensure-project");
      return;
    }

    this.hintSession = this.hintEngine.reset(
      this.hintSession ?? this.hintEngine.createSession(this.currentContext)
    );
    this.publish();
  }

  private publish(): void {
    if (!this.currentContext || !this.hintSession || !this.nextStep) {
      return;
    }

    this.viewProvider.update({
      context: this.currentContext,
      hintSession: this.hintSession,
      nextStep: this.nextStep,
      projectAnalysis: this.projectAnalysis,
      languageAnalysis: this.languageAnalysis,
      frameworkDetections: this.frameworkDetections
    });
  }

  private collectLanguageProjectIdentity():
    Pick<LanguageDocumentInput, "uri" | "projectRelativePath"> | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme === "untitled") {
      return undefined;
    }

    const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
    const projectRoot = this.projectAnalysis?.snapshot?.root;
    return {
      uri: editor.document.uri.toString(),
      projectRelativePath: projectRoot
        ? stripProjectPrefix(relativePath, projectRoot.relativePath)
        : relativePath
    };
  }

  private collectLanguageDocumentIdentity():
    Pick<LanguageDocumentInput, "uri" | "version" | "cursor"> | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme === "untitled") {
      return undefined;
    }

    return {
      uri: editor.document.uri.toString(),
      version: editor.document.version,
      cursor: {
        line: editor.selection.active.line,
        character: editor.selection.active.character
      }
    };
  }

  private collectLanguageDocument(): LanguageDocumentInput | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme === "untitled") {
      return undefined;
    }
    const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
    const projectRoot = this.projectAnalysis?.snapshot?.root;
    const projectRelativePath = projectRoot
      ? stripProjectPrefix(relativePath, projectRoot.relativePath)
      : relativePath;

    return {
      uri: editor.document.uri.toString(),
      fileName: editor.document.fileName,
      relativePath,
      projectRootUri: projectRoot?.uri,
      projectRelativePath,
      knownProjectFiles: this.projectAnalysis?.snapshot?.codeFiles,
      languageId: editor.document.languageId,
      version: editor.document.version,
      text: editor.document.getText(),
      cursor: {
        line: editor.selection.active.line,
        character: editor.selection.active.character
      }
    };
  }

  private collectFrameworkDetections(
    document: LanguageDocumentInput,
    languageAnalysis: LanguageAnalysis
  ): readonly FrameworkDetection[] {
    return detectFrameworks({
      fileName: document.fileName,
      relativePath: document.relativePath,
      languageId: document.languageId,
      text: document.text,
      languageAnalysis,
      manifestFiles: this.projectAnalysis?.snapshot?.manifestFiles,
      metadataPackageNames: this.projectAnalysis?.snapshot?.metadata.packageNames
    });
  }
}

function isActiveDocument(document: vscode.TextDocument): boolean {
  return document.uri.toString() === vscode.window.activeTextEditor?.document.uri.toString();
}
