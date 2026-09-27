import type { LearningContext, NextStep, ProjectAnalysis } from "../core/models";
import type { FrameworkDetection } from "../framework/models";
import { selectLearningRelationship } from "../language/localRelationships";
import type { LanguageAnalysis } from "../language/models";
import { choosePrimaryDiagnostic } from "./diagnostics";

export class NextStepService {
  choose(
    context: LearningContext,
    projectAnalysis?: ProjectAnalysis,
    languageAnalysis?: LanguageAnalysis,
    frameworkDetections: readonly FrameworkDetection[] = []
  ): NextStep {
    const candidates = this.collectCandidates(
      context,
      projectAnalysis,
      languageAnalysis,
      frameworkDetections
    );
    return [...candidates].sort((a, b) => b.priority - a.priority)[0] ?? defaultNextStep;
  }

  collectCandidates(
    context: LearningContext,
    projectAnalysis?: ProjectAnalysis,
    languageAnalysis?: LanguageAnalysis,
    frameworkDetections: readonly FrameworkDetection[] = []
  ): readonly NextStep[] {
    const steps: NextStep[] = [];

    if (!context.workspace.hasWorkspace) {
      steps.push({
        id: "open-workspace",
        title: "Open a project folder",
        detail:
          "CodingSensei works best when it can read the workspace name and current file context.",
        priority: 100
      });
    }

    if (!context.activeEditor) {
      steps.push({
        id: "open-source-file",
        title: "Open a source file",
        detail: "Choose a JavaScript, TypeScript, Python, or Java file to begin Learning Mode.",
        priority: 90
      });
      return steps;
    }

    const editor = context.activeEditor;
    const firstDiagnostic = choosePrimaryDiagnostic(editor.diagnostics);

    if (editor.isUntitled || editor.isDirty) {
      steps.push({
        id: "save-current-file",
        title: "Save the current file",
        detail:
          "Saving lets language tools refresh diagnostics and gives you a stable point to reason from.",
        priority: 85
      });
    }

    if (firstDiagnostic) {
      steps.push({
        id: "investigate-first-diagnostic",
        title: "Investigate the first diagnostic",
        detail: `${firstDiagnostic.severity.toUpperCase()}: ${firstDiagnostic.message}`,
        priority: firstDiagnostic.severity === "error" ? 95 : 80
      });
    }

    if (editor.selection) {
      steps.push({
        id: "review-selection",
        title: "Review the selected code",
        detail: `Explain the selected ${String(editor.selection.lineCount)} line(s) before changing them.`,
        priority: 75
      });
    }

    const todo = editor.todoMarkers[0];
    if (todo) {
      steps.push({
        id: "inspect-todo",
        title: `Inspect a ${todo.label}`,
        detail: `Line ${String(todo.line + 1)}: ${todo.text}`,
        priority: 65
      });
    }

    const projectSteps = collectProjectSteps(projectAnalysis);
    steps.push(...projectSteps);
    steps.push(
      ...collectLanguageSteps(
        languageAnalysis,
        frameworkDetections,
        editor.relativePath ?? editor.fileName
      )
    );

    if (!context.project.activeFileIsTest) {
      steps.push({
        id: "look-for-test-path",
        title: "Find a way to verify behavior",
        detail:
          "The active file does not look like a test file. Look for an existing test command or nearby tests when you need feedback.",
        priority: 45
      });
    } else {
      steps.push({
        id: "run-or-read-test",
        title: "Use tests as feedback",
        detail: "Read or run a nearby test so the next change has a clear feedback loop.",
        priority: 55
      });
    }

    steps.push({
      id: "explain-current-file",
      title: "Explain the current file",
      detail: "Summarize this file's purpose and choose one small behavior to understand next.",
      priority: 20
    });

    return steps;
  }
}

function collectLanguageSteps(
  languageAnalysis: LanguageAnalysis | undefined,
  frameworkDetections: readonly FrameworkDetection[],
  activePath: string | undefined
): readonly NextStep[] {
  const steps: NextStep[] = [];
  const firstRelationship = selectLearningRelationship(languageAnalysis, activePath);
  const currentSymbol = languageAnalysis?.currentSymbol;
  const firstFramework = frameworkDetections[0];

  if (firstRelationship) {
    steps.push({
      id: `inspect-${firstRelationship.type}`,
      title: relationshipTitle(firstRelationship.type),
      detail: relationshipDetail(firstRelationship),
      priority: 58
    });
  }

  if (firstFramework) {
    steps.push({
      id: `inspect-${firstFramework.framework}`,
      title: frameworkTitle(firstFramework),
      detail: `${formatFramework(firstFramework.framework)} evidence: ${firstFramework.evidence
        .map((evidence) => evidence.description)
        .slice(0, 2)
        .join("; ")}.`,
      priority: 52
    });
  }

  if (currentSymbol) {
    steps.push({
      id: "explain-current-symbol",
      title: "Explain the current symbol",
      detail: `You are inside ${currentSymbol.kind} "${currentSymbol.name}". Describe its responsibility before changing it.`,
      priority: 48
    });
  }

  return steps;
}

function relationshipDetail(
  relationship: NonNullable<LanguageAnalysis["relationships"][number]>
): string {
  if (relationship.targetFile) {
    return `${relationship.targetFile}: ${relationship.reason}`;
  }
  return `${relationship.target}: ${relationship.reason}`;
}

function relationshipTitle(
  type: NonNullable<LanguageAnalysis["relationships"][number]>["type"]
): string {
  switch (type) {
    case "renders":
      return "Inspect the rendered component";
    case "route-handler":
      return "Trace the route handler";
    case "service-dependency":
      return "Inspect the service dependency";
    case "import":
      return "Inspect an imported module";
    case "definition":
      return "Inspect the definition";
    case "reference":
      return "Trace the reference";
    case "call":
      return "Trace the function call";
    case "contains":
      return "Inspect the contained symbol";
  }
}

function frameworkTitle(detection: FrameworkDetection): string {
  const roles = detection.roles.length > 0 ? ` ${detection.roles.join(", ")}` : "";
  return `Inspect the ${formatFramework(detection.framework)}${roles}`;
}

function formatFramework(framework: FrameworkDetection["framework"]): string {
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

function collectProjectSteps(projectAnalysis: ProjectAnalysis | undefined): readonly NextStep[] {
  const snapshot = projectAnalysis?.snapshot;
  if (!snapshot) {
    return [];
  }

  const related = snapshot.relatedFiles[0];
  const steps: NextStep[] = [];

  if (related?.exists && related.relationship === "test") {
    steps.push({
      id: "inspect-related-test",
      title: "Inspect the related test",
      detail: `${related.path} appears to cover this source file. Reading it may show the expected behavior.`,
      priority: 60
    });
  }

  if (related?.exists && related.relationship === "source") {
    steps.push({
      id: "inspect-related-source",
      title: "Inspect the related source",
      detail: `${related.path} appears to be the source file behind this test.`,
      priority: 60
    });
  }

  if (related && !related.exists && related.relationship === "suggested-test") {
    steps.push({
      id: "consider-test-location",
      title: "Consider the project test convention",
      detail: `${related.path} matches an existing test convention, but CodingSensei did not find that file.`,
      priority: 42
    });
  }

  const testScript = snapshot.scripts.find((script) => script.kind === "test");
  if (testScript) {
    steps.push({
      id: "use-test-script-feedback",
      title: "Use the project test script as feedback",
      detail: `The project defines a "${testScript.name}" script. Use it as a feedback loop after understanding your change.`,
      priority: 40
    });
  }

  if (snapshot.git.available && snapshot.git.isDirty && snapshot.git.changedFileCount) {
    steps.push({
      id: "review-git-changes",
      title: "Review your local changes",
      detail: `Git reports ${String(snapshot.git.changedFileCount)} changed file(s). Review the diff to connect edits with behavior.`,
      priority: 35
    });
  }

  return steps;
}

const defaultNextStep: NextStep = {
  id: "start-small",
  title: "Start with one small question",
  detail: "Choose a nearby line of code and explain what you expect it to do.",
  priority: 0
};
