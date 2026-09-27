import type * as vscode from "vscode";

import type {
  HintSession,
  LearningContext,
  LearningDiagnostic,
  NextStep,
  ProjectAnalysis,
  ProgressiveHint,
  SelectionContext
} from "../core/models";
import type { FrameworkDetection } from "../framework/models";
import { selectLearningRelationship } from "../language/localRelationships";
import type { LanguageAnalysis } from "../language/models";
import { getLanguageDisplayName, isSupportedLanguage } from "../learning/languageProfiles";

export class LearningModeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "codingsensei.learningMode";

  private view: vscode.WebviewView | undefined;
  private context: LearningContext | undefined;
  private hintSession: HintSession | undefined;
  private nextStep: NextStep | undefined;
  private projectAnalysis: ProjectAnalysis | undefined;
  private languageAnalysis: LanguageAnalysis | undefined;
  private frameworkDetections: readonly FrameworkDetection[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: false,
      localResourceRoots: [this.extensionUri]
    };
    this.render();
  }

  update(input: {
    readonly context: LearningContext;
    readonly hintSession: HintSession;
    readonly nextStep: NextStep;
    readonly projectAnalysis: ProjectAnalysis | undefined;
    readonly languageAnalysis: LanguageAnalysis | undefined;
    readonly frameworkDetections: readonly FrameworkDetection[];
  }): void {
    this.context = input.context;
    this.hintSession = input.hintSession;
    this.nextStep = input.nextStep;
    this.projectAnalysis = input.projectAnalysis;
    this.languageAnalysis = input.languageAnalysis;
    this.frameworkDetections = input.frameworkDetections;
    this.render();
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    this.view.webview.html = renderHtml({
      context: this.context,
      currentHint: this.hintSession
        ? this.hintSession.hints[this.hintSession.currentIndex]
        : undefined,
      hintCount: this.hintSession?.hints.length ?? 0,
      hintIndex: this.hintSession?.currentIndex ?? 0,
      nextStep: this.nextStep,
      projectAnalysis: this.projectAnalysis,
      languageAnalysis: this.languageAnalysis,
      frameworkDetections: this.frameworkDetections
    });
  }
}

function renderHtml(input: {
  readonly context: LearningContext | undefined;
  readonly currentHint: ProgressiveHint | undefined;
  readonly hintCount: number;
  readonly hintIndex: number;
  readonly nextStep: NextStep | undefined;
  readonly projectAnalysis: ProjectAnalysis | undefined;
  readonly languageAnalysis: LanguageAnalysis | undefined;
  readonly frameworkDetections: readonly FrameworkDetection[];
}): string {
  const context = input.context;
  const editor = context?.activeEditor;
  const diagnostics = editor?.diagnostics ?? [];
  const languageName = editor
    ? getLanguageDisplayName({ languageId: editor.languageId, fileName: editor.fileName })
    : "None";
  const languageSupport = editor
    ? isSupportedLanguage({ languageId: editor.languageId, fileName: editor.fileName })
      ? "Supported foundation"
      : "Basic context only"
    : "Open a file";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      margin: 0;
      padding: 16px;
    }

    h1, h2, h3, p {
      margin: 0;
    }

    .stack {
      display: grid;
      gap: 14px;
    }

    .header {
      display: grid;
      gap: 6px;
    }

    .eyebrow {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    h1 {
      font-size: 18px;
      font-weight: 650;
    }

    h2 {
      font-size: 13px;
      font-weight: 650;
      margin-bottom: 8px;
    }

    .panel {
      border: 1px solid var(--vscode-sideBar-border);
      border-radius: 6px;
      padding: 12px;
      background: var(--vscode-editor-background);
    }

    .meta {
      display: grid;
      gap: 7px;
    }

    .row {
      display: grid;
      gap: 2px;
    }

    .label {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .value {
      overflow-wrap: anywhere;
    }

    .status {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      border: 1px solid var(--vscode-badge-background);
      border-radius: 999px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      padding: 2px 8px;
      font-size: 11px;
    }

    .diagnostic {
      border-left: 3px solid var(--vscode-editorWarning-foreground);
      padding-left: 9px;
    }

    .diagnostic.error {
      border-left-color: var(--vscode-editorError-foreground);
    }

    .muted {
      color: var(--vscode-descriptionForeground);
    }

    code {
      color: var(--vscode-textPreformat-foreground);
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      padding: 1px 4px;
    }
  </style>
</head>
<body>
  <main class="stack">
    <section class="header">
      <div class="eyebrow">CodingSensei</div>
      <h1>Learning Mode</h1>
      <div class="status">${escapeHtml(statusLabel(context?.status))}</div>
    </section>

    <section class="panel">
      <h2>Context</h2>
      <div class="meta">
        <div class="row">
          <span class="label">Workspace</span>
          <span class="value">${escapeHtml(context?.workspace.name ?? "No workspace")}</span>
        </div>
        <div class="row">
          <span class="label">Current file</span>
          <span class="value">${escapeHtml(editor?.relativePath ?? editor?.fileName ?? "No active editor")}</span>
        </div>
        <div class="row">
          <span class="label">Language</span>
          <span class="value">${escapeHtml(languageName)} · ${escapeHtml(languageSupport)}</span>
        </div>
        <div class="row">
          <span class="label">Selection</span>
          <span class="value">${escapeHtml(selectionSummary(editor?.selection))}</span>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>Diagnostics</h2>
      <div class="stack">
        ${diagnostics.length > 0 ? diagnostics.map(renderDiagnostic).join("") : `<p class="muted">No diagnostics for the active file.</p>`}
      </div>
    </section>

    <section class="panel">
      <h2>Project</h2>
      ${renderProject(input.projectAnalysis, input.languageAnalysis, input.frameworkDetections)}
    </section>

    <section class="panel">
      <h2>Next Step</h2>
      ${
        input.nextStep
          ? `<p><strong>${escapeHtml(input.nextStep.title)}</strong></p><p class="muted">${escapeHtml(input.nextStep.detail)}</p>`
          : `<p class="muted">Open a workspace or source file to get a suggestion.</p>`
      }
    </section>

    <section class="panel">
      <h2>Progressive Hint</h2>
      ${
        input.currentHint
          ? `<p><strong>${escapeHtml(input.currentHint.title)}</strong></p><p class="muted">${escapeHtml(input.currentHint.message)}</p><p class="muted">Hint ${String(input.hintIndex + 1)} of ${String(input.hintCount)} · ${escapeHtml(input.currentHint.level)}</p>`
          : `<p class="muted">No hint is available yet.</p>`
      }
    </section>
  </main>
</body>
</html>`;
}

function renderProject(
  projectAnalysis: ProjectAnalysis | undefined,
  languageAnalysis: LanguageAnalysis | undefined,
  frameworkDetections: readonly FrameworkDetection[]
): string {
  if (!projectAnalysis) {
    return `<p class="muted">Project context is starting.</p>`;
  }

  if (projectAnalysis.status !== "ready" || !projectAnalysis.snapshot) {
    return `<p class="muted">${escapeHtml(projectStatusMessage(projectAnalysis))}</p>`;
  }

  const snapshot = projectAnalysis.snapshot;
  const related = snapshot.relatedFiles[0];
  const scripts = snapshot.scripts
    .filter((script) => ["test", "build", "lint", "dev", "start"].includes(script.kind))
    .slice(0, 5)
    .map((script) => script.name)
    .join(", ");
  const currentSymbol = languageAnalysis?.currentSymbol;
  const languageStatus = languageAnalysis
    ? languageStatusSummary(languageAnalysis)
    : "Language structure is starting";
  const frameworkSummary =
    frameworkDetections.length > 0
      ? frameworkDetections.map(formatFrameworkDetection).join(", ")
      : "No supported framework evidence detected";
  const codeRelationship = selectLearningRelationship(languageAnalysis, languageAnalysis?.file);

  return `<div class="meta">
    <div class="row">
      <span class="label">Root</span>
      <span class="value">${escapeHtml(snapshot.root.name)}</span>
    </div>
    <div class="row">
      <span class="label">Project identity</span>
      <span class="value">${escapeHtml(projectPersistenceSummary(projectAnalysis))}</span>
    </div>
    <div class="row">
      <span class="label">Ecosystems</span>
      <span class="value">${escapeHtml(snapshot.ecosystems.join(", ") || "No supported ecosystem detected")}</span>
    </div>
    <div class="row">
      <span class="label">Tools</span>
      <span class="value">${escapeHtml(snapshot.tools.map((tool) => tool.label).join(", ") || "No build/package tool detected")}</span>
    </div>
    <div class="row">
      <span class="label">Files</span>
      <span class="value">${escapeHtml(`${String(snapshot.sourceFileCount)} source · ${String(snapshot.testFileCount)} test${snapshot.scanTruncated ? " · scan truncated" : ""}`)}</span>
    </div>
    <div class="row">
      <span class="label">Git</span>
      <span class="value">${escapeHtml(gitSummary(snapshot.git))}</span>
    </div>
    <div class="row">
      <span class="label">Scripts</span>
      <span class="value">${escapeHtml(scripts || "No common scripts found")}</span>
    </div>
    <div class="row">
      <span class="label">Related file</span>
      <span class="value">${escapeHtml(related ? `${related.path}${related.exists ? "" : " (suggested)"}` : "No strong relationship found")}</span>
    </div>
    <div class="row">
      <span class="label">Code structure</span>
      <span class="value">${escapeHtml(languageStatus)}</span>
    </div>
    <div class="row">
      <span class="label">Current symbol</span>
      <span class="value">${escapeHtml(currentSymbol ? `${currentSymbol.kind} ${currentSymbol.name}` : "No containing symbol detected")}</span>
    </div>
    <div class="row">
      <span class="label">Framework signals</span>
      <span class="value">${escapeHtml(frameworkSummary)}</span>
    </div>
    <div class="row">
      <span class="label">Local relationship</span>
      <span class="value">${escapeHtml(codeRelationship ? `${codeRelationship.type}: ${codeRelationship.targetFile ?? codeRelationship.target}` : "No local code relationship detected")}</span>
    </div>
  </div>`;
}

function projectPersistenceSummary(projectAnalysis: ProjectAnalysis): string {
  const persistence = projectAnalysis.persistence;
  if (!persistence) {
    return "Not initialized";
  }
  if (persistence.status === "unavailable") {
    return persistence.message ? `Unavailable · ${persistence.message}` : "Unavailable";
  }
  if (!persistence.projectId) {
    return "Persistent";
  }

  const shortId = persistence.projectId.slice(0, 8);
  return `${persistence.identityCreated ? "Created" : "Persistent"} · ${shortId}`;
}

function languageStatusSummary(languageAnalysis: LanguageAnalysis): string {
  if (languageAnalysis.status === "analyzing") {
    return "Analyzing code structure locally";
  }
  if (languageAnalysis.status === "unavailable") {
    return languageAnalysis.message ?? "Code structure is unavailable";
  }
  const source =
    languageAnalysis.source === "vscode-provider"
      ? "VS Code symbols"
      : languageAnalysis.source === "deterministic"
        ? "deterministic fallback"
        : "unavailable";
  return `${String(languageAnalysis.symbols.length)} symbol(s) · ${source}${languageAnalysis.truncated ? " · truncated" : ""}`;
}

function formatFrameworkDetection(detection: FrameworkDetection): string {
  const roles = detection.roles.length > 0 ? ` (${detection.roles.join(", ")})` : "";
  return `${formatFrameworkName(detection.framework)} ${detection.confidence}${roles}`;
}

function formatFrameworkName(framework: FrameworkDetection["framework"]): string {
  switch (framework) {
    case "react":
      return "React";
    case "express":
      return "Express";
    case "django":
      return "Django";
    case "spring-boot":
      return "Spring Boot";
  }
}

function projectStatusMessage(projectAnalysis: ProjectAnalysis): string {
  switch (projectAnalysis.status) {
    case "no-workspace":
      return "Open a workspace to analyze project context.";
    case "analyzing":
      return "Analyzing project context locally.";
    case "unavailable":
      return projectAnalysis.message ?? "Project context is unavailable.";
    case "ready":
      return "Project context is ready.";
  }
}

function gitSummary(git: NonNullable<ProjectAnalysis["snapshot"]>["git"]): string {
  if (!git.available) {
    return git.error ?? "Unavailable";
  }
  if (!git.isRepository) {
    return "Not a Git repository";
  }
  const branch = git.branch ? git.branch : "detached or unknown branch";
  const state = git.isDirty ? `${String(git.changedFileCount ?? 0)} changed file(s)` : "clean";
  return `${branch} · ${state}`;
}

function renderDiagnostic(diagnostic: LearningDiagnostic): string {
  const severityClass = diagnostic.severity === "error" ? " error" : "";
  return `<div class="diagnostic${severityClass}">
    <p><strong>${escapeHtml(diagnostic.severity.toUpperCase())}</strong> · line ${String(diagnostic.range.startLine + 1)}</p>
    <p class="muted">${escapeHtml(diagnostic.message)}</p>
  </div>`;
}

function selectionSummary(selection: SelectionContext | undefined): string {
  if (!selection) {
    return "No code selected";
  }

  return `${String(selection.lineCount)} line(s), ${String(selection.characterCount)} character(s)`;
}

function statusLabel(status: LearningContext["status"] | undefined): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "no-active-editor":
      return "Waiting for an editor";
    case "no-workspace":
      return "Open a workspace";
    default:
      return "Starting";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
