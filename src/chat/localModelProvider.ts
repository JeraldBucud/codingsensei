import type { ProjectChatMessage } from "./projectChatPrompt";

export interface LocalModelInfo {
  readonly name: string;
  readonly sizeBytes: number;
  readonly family?: string;
}

export interface LocalChatRequest {
  readonly model: string;
  readonly messages: readonly ProjectChatMessage[];
  readonly keepAlive: "0" | "2m" | "5m";
  readonly signal?: AbortSignal;
}

export interface LocalModelProvider {
  listModels(signal?: AbortSignal): Promise<readonly LocalModelInfo[]>;
  chat(request: LocalChatRequest): Promise<string>;
}
