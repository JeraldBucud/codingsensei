export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface CodeRange {
  readonly startLine: number;
  readonly startCharacter: number;
  readonly endLine: number;
  readonly endCharacter: number;
}

export interface LearningDiagnostic {
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly source?: string;
  readonly code?: string;
  readonly range: CodeRange;
}

export interface SelectionContext {
  readonly text: string;
  readonly range: CodeRange;
  readonly lineCount: number;
  readonly characterCount: number;
}

export interface ActiveEditorContext {
  readonly fileName: string;
  readonly relativePath?: string;
  readonly languageId: string;
  readonly isUntitled: boolean;
  readonly isDirty: boolean;
  readonly lineCount: number;
  readonly selection?: SelectionContext;
  readonly diagnostics: readonly LearningDiagnostic[];
  readonly todoMarkers: readonly TodoMarker[];
}

export interface TodoMarker {
  readonly label: "TODO" | "FIXME";
  readonly text: string;
  readonly line: number;
}

export interface WorkspaceContext {
  readonly name: string;
  readonly folderCount: number;
  readonly hasWorkspace: boolean;
  readonly activeWorkspaceRoot?: WorkspaceRoot;
}

export interface WorkspaceRoot {
  readonly name: string;
  readonly uri: string;
  readonly path: string;
  readonly relativePath?: string;
  readonly containingWorkspaceUri?: string;
}

export interface ProjectSignals {
  readonly activeFileIsTest: boolean;
}

export interface LearningContext {
  readonly status: "ready" | "no-workspace" | "no-active-editor";
  readonly workspace: WorkspaceContext;
  readonly activeEditor?: ActiveEditorContext;
  readonly project: ProjectSignals;
}

export interface LanguageProfile {
  readonly id: string;
  readonly displayName: string;
  readonly fileExtensions: readonly string[];
  readonly testFilePatterns: readonly RegExp[];
  readonly sourceFilePatterns: readonly RegExp[];
}

export type HintLevel = "inspect" | "concept" | "direction" | "explicit";

export interface ProgressiveHint {
  readonly id: string;
  readonly level: HintLevel;
  readonly title: string;
  readonly message: string;
  readonly relatedDiagnostic?: LearningDiagnostic;
}

export interface HintSession {
  readonly currentIndex: number;
  readonly hints: readonly ProgressiveHint[];
  readonly targetKey: string;
}

export interface NextStep {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly priority: number;
}

export type ProjectAnalysisStatus = "no-workspace" | "analyzing" | "ready" | "unavailable";

export type ProjectEcosystem = "javascript" | "typescript" | "python" | "java";

export type PackageTool =
  "pnpm" | "npm" | "yarn" | "maven" | "gradle" | "pyproject" | "requirements";

export interface ProjectTool {
  readonly id: PackageTool;
  readonly label: string;
  readonly evidence: readonly string[];
}

export interface ProjectScript {
  readonly name: string;
  readonly kind: "test" | "build" | "lint" | "dev" | "start" | "other";
}

export interface RelatedFileCandidate {
  readonly path: string;
  readonly label: string;
  readonly relationship: "source" | "test" | "suggested-test" | "project-config" | "build-config";
  readonly confidence: "high" | "medium" | "suggested";
  readonly exists: boolean;
  readonly reason: string;
}

export interface GitProjectState {
  readonly available: boolean;
  readonly isRepository: boolean;
  readonly branch?: string;
  readonly isDirty?: boolean;
  readonly changedFileCount?: number;
  readonly activeFileStatus?:
    "modified" | "untracked" | "renamed" | "deleted" | "clean" | "unknown";
  readonly error?: string;
}

export interface ProjectSnapshot {
  readonly root: WorkspaceRoot;
  readonly ecosystems: readonly ProjectEcosystem[];
  readonly tools: readonly ProjectTool[];
  readonly codeFiles: readonly string[];
  readonly manifestFiles: readonly string[];
  readonly configFiles: readonly string[];
  readonly sourceRoots: readonly string[];
  readonly testRoots: readonly string[];
  readonly sourceFileCount: number;
  readonly testFileCount: number;
  readonly scanLimit: number;
  readonly scanTruncated: boolean;
  readonly scripts: readonly ProjectScript[];
  readonly metadata: ProjectMetadataSummary;
  readonly relatedFiles: readonly RelatedFileCandidate[];
  readonly git: GitProjectState;
}

export interface ProjectMetadataSummary {
  readonly packageNames: readonly string[];
}

export interface ProjectPersistenceSummary {
  readonly status: "ready" | "unavailable";
  readonly projectId?: string;
  readonly identityCreated?: boolean;
  readonly message?: string;
}

export interface ProjectAnalysis {
  readonly status: ProjectAnalysisStatus;
  readonly root?: WorkspaceRoot;
  readonly snapshot?: ProjectSnapshot;
  readonly persistence?: ProjectPersistenceSummary;
  readonly message?: string;
}

export interface IntelligenceProvider {
  readonly id: string;
  readonly mode: "deterministic" | "embedded-local" | "optional-integration";
  readonly required: false;
}
