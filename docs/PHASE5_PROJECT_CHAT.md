# Phase 5: Project Chat & Local AI

Phase 5 connects the deterministic Project Intelligence Engine to optional, user-controlled local inference. **LLMs must never perform raw repository discovery** in place of the structural index.

## Initial foundation

The first slice is `src/chat/projectChatPrompt.ts`, a pure, tested assembler that converts a bounded Phase 4 `ProjectEvidencePackage` into a two-message prompt. It:

- incorporates file paths, verified symbol locations, relationships, roles, and index coverage;
- uses the project evidence as untrusted _data_, never model instructions;
- excludes the stable project ID and source contents;
- limits question length, selected files and evidence size;
- tells the model to acknowledge missing evidence and cite exact file/line locations;
- does not call a model, read source code, send network requests, or modify a project.

This is **not** a user-facing chat feature yet. It is the local prompt-construction boundary that later inference implementations must reuse.

## Next implementation slices

1. **Provider boundary:** define a cancellable local-model client with explicit user activation. Start with a loopback-only Ollama adapter and model selection. No background requests, cloud fallback or automatic model download.
2. **Project chat UI:** offer a VS Code chat panel with scopes (project, file, selection). Separate chat mode from Learning and Assist behavior.
3. **Evidence retrieval:** use Phase 4 ranked project evidence, then optionally load only narrowly selected source excerpts with bounded read limits and user control. Do not persist raw prompts or source excerpts to project knowledge.
4. **Verifiable answers:** render source references that open existing local paths and lines. Do not make citations from generated text clickable without checking them against the evidence supplied.
5. **Reliability and privacy:** cancellation, timeout, no-model handling, prompt-injection resistance, zero telemetry, cross-platform path handling, and tests using a fake provider before manual VS Code validation.

## Release gate

Keep this work on a draft PR until it has a functioning local provider and a verifiable chat UI. Phase 5 is not complete merely because the prompt assembler exists. Prior releases remain usable with no AI model installed.

## Hardware and modularity

The deterministic Core must continue to work when Ollama is stopped or the model is unloaded. Future add-on packs can supply Learning, Assist, more languages, or model profiles without forcing extra gigabytes of downloads on every user.
