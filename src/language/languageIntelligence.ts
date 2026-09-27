import type { LanguageAnalysis, LanguageDocumentInput } from "./models";
import { emptyLanguageAnalysis } from "./models";
import { resolveLocalRelationships } from "./localRelationships";
import { analyzeDeterministicStructure } from "./relationships";
import { boundSymbols, findContainingSymbol } from "./symbols";

export interface LanguageProviderAdapter {
  readonly analyzeDocument: (document: LanguageDocumentInput) => Promise<LanguageAnalysis>;
}

export class DeterministicLanguageAdapter implements LanguageProviderAdapter {
  analyzeDocument(document: LanguageDocumentInput): Promise<LanguageAnalysis> {
    const deterministic = analyzeDeterministicStructure({
      text: document.text,
      languageId: document.languageId,
      fileName: document.fileName
    });
    const bounded = boundSymbols(deterministic.symbols);
    return Promise.resolve({
      status: "partial",
      file: document.relativePath ?? document.fileName,
      languageId: document.languageId,
      source: "deterministic",
      symbols: bounded.symbols,
      currentSymbol: findContainingSymbol(bounded.symbols, document.cursor),
      imports: deterministic.imports.slice(0, 40),
      relationships: deterministic.relationships.slice(0, 40),
      entryPointSignals: deterministic.entryPointSignals.slice(0, 10),
      truncated: bounded.truncated
    });
  }
}

export class LanguageIntelligenceService {
  private static readonly maxCacheEntries = 48;
  private readonly cache = new Map<
    string,
    { readonly version: number; readonly analysis: LanguageAnalysis }
  >();
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly adapter: LanguageProviderAdapter = new DeterministicLanguageAdapter()
  ) {}

  getCached(
    document: Pick<LanguageDocumentInput, "uri" | "version" | "cursor"> | undefined
  ): LanguageAnalysis {
    if (!document) return emptyLanguageAnalysis;
    const cached = this.cache.get(document.uri);
    if (!cached)
      return {
        ...emptyLanguageAnalysis,
        status: "analyzing",
        message: "Language analysis is starting."
      };
    if (cached.version !== document.version) return { ...cached.analysis, status: "partial" };
    return projectAnalysisForCursor(cached.analysis, document.cursor);
  }

  async analyze(document: LanguageDocumentInput, force = false): Promise<LanguageAnalysis> {
    const cached = this.cache.get(document.uri);
    if (!force && cached?.version === document.version) {
      return projectAnalysisForCursor(cached.analysis, document.cursor);
    }

    const generation = this.nextGeneration(document.uri);
    try {
      const analysis = resolveLocalRelationships(
        await this.adapter.analyzeDocument(document),
        document
      );
      if (this.generations.get(document.uri) === generation) {
        this.setCache(document.uri, document.version, analysis);
        return projectAnalysisForCursor(analysis, document.cursor);
      }
      return this.getCached(document);
    } catch (error) {
      return {
        ...emptyLanguageAnalysis,
        file: document.relativePath ?? document.fileName,
        languageId: document.languageId,
        message: error instanceof Error ? error.message : "Language analysis unavailable."
      };
    }
  }

  prime(document: LanguageDocumentInput, analysis: LanguageAnalysis): LanguageAnalysis {
    this.setCache(document.uri, document.version, analysis);
    return projectAnalysisForCursor(analysis, document.cursor);
  }

  invalidate(uri: string): void {
    this.cache.delete(uri);
  }

  private nextGeneration(uri: string): number {
    const generation = (this.generations.get(uri) ?? 0) + 1;
    this.generations.set(uri, generation);
    return generation;
  }

  private setCache(uri: string, version: number, analysis: LanguageAnalysis): void {
    this.cache.delete(uri);
    this.cache.set(uri, { version, analysis });
    while (this.cache.size > LanguageIntelligenceService.maxCacheEntries) {
      const firstKey = this.cache.keys().next().value;
      if (typeof firstKey !== "string") {
        return;
      }
      this.cache.delete(firstKey);
    }
  }
}

function projectAnalysisForCursor(
  analysis: LanguageAnalysis,
  cursor: LanguageDocumentInput["cursor"]
): LanguageAnalysis {
  const currentSymbol = findContainingSymbol(analysis.symbols, cursor);
  return {
    ...analysis,
    currentSymbol,
    relationships: filterRelationshipsForSymbol(analysis.relationships, currentSymbol?.name)
  };
}

function filterRelationshipsForSymbol(
  relationships: LanguageAnalysis["relationships"],
  currentSymbolName: string | undefined
): LanguageAnalysis["relationships"] {
  return relationships.filter((relationship) => {
    if (!relationship.providerDerived) {
      return true;
    }
    return currentSymbolName !== undefined && relationship.symbol === currentSymbolName;
  });
}
