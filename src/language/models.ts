import type { CodeRange } from "../core/models";

export type LanguageSymbolKind =
  | "class"
  | "interface"
  | "function"
  | "method"
  | "constructor"
  | "field"
  | "property"
  | "variable"
  | "constant"
  | "enum"
  | "module"
  | "unknown";

export type LanguageAnalysisSource = "vscode-provider" | "deterministic" | "unavailable";
export type LanguageCapabilityState = "available" | "partial" | "unavailable" | "analyzing";
export type LanguageRelationshipType =
  | "import"
  | "definition"
  | "reference"
  | "call"
  | "contains"
  | "renders"
  | "route-handler"
  | "service-dependency";

export interface LanguageSymbol {
  readonly name: string;
  readonly kind: LanguageSymbolKind;
  readonly range: CodeRange;
  readonly selectionRange: CodeRange;
  readonly containerName?: string;
  readonly detail?: string;
}

export interface LanguageRelationship {
  readonly type: LanguageRelationshipType;
  readonly target: string;
  readonly targetFile?: string;
  readonly symbol?: string;
  readonly sourceSymbol?: string;
  readonly providerDerived?: boolean;
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
}

export interface LanguageAnalysis {
  readonly status: LanguageCapabilityState;
  readonly file?: string;
  readonly languageId?: string;
  readonly source: LanguageAnalysisSource;
  readonly symbols: readonly LanguageSymbol[];
  readonly currentSymbol?: LanguageSymbol;
  readonly imports: readonly LanguageRelationship[];
  readonly relationships: readonly LanguageRelationship[];
  readonly entryPointSignals: readonly string[];
  readonly truncated: boolean;
  readonly message?: string;
}

export interface LanguageDocumentInput {
  readonly uri: string;
  readonly fileName: string;
  readonly relativePath?: string;
  readonly projectRootUri?: string;
  readonly projectRelativePath?: string;
  readonly knownProjectFiles?: readonly string[];
  readonly languageId: string;
  readonly version: number;
  readonly text: string;
  readonly cursor?: { readonly line: number; readonly character: number };
}

export const emptyLanguageAnalysis: LanguageAnalysis = {
  status: "unavailable",
  source: "unavailable",
  symbols: [],
  imports: [],
  relationships: [],
  entryPointSignals: [],
  truncated: false,
  message: "Language intelligence is unavailable."
};
