import type { ProjectChatMessage } from "./projectChatPrompt";

export interface LocalInferenceRequest {
  readonly messages: readonly ProjectChatMessage[];
  readonly modelPath: string;
  readonly signal?: AbortSignal;
}

export interface LocalModelProvider {
  generate(request: LocalInferenceRequest): Promise<string>;
}
