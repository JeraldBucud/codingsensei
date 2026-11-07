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

## First user-triggered Ollama integration

The command `CodingSensei: Ask Project (Local Ollama)` is now wired as an opt-in, non-streaming prototype:

1. Start local Ollama on the **same machine/environment as the VS Code extension host** (`127.0.0.1:11434`). Remote SSH/dev containers require a separately designed connection approach.
2. Install or choose an existing local model; CodingSensei only lists installed models through `GET /api/tags` and never downloads one.
3. Open a trusted workspace and a project file. Build deep project intelligence if required.
4. Run the command, enter a question and choose the local model.
5. CodingSensei builds bounded structural evidence and calls `POST /api/chat` with `stream: false` and `keep_alive: "0"`.
6. The answer opens as a new Markdown editor document. Model output is **not** executed or used to edit files.

This prototype uses the Eco profile by default, requesting model unloading after every answer. Later releases can introduce a configurable Balanced profile and live streaming.

**Privacy boundary:** Questions, file paths, symbols, roles, and relationships are sent to the user's local Ollama endpoint on demand. Source file contents and stable project identity are not included in this initial prompt. The extension never sends project data directly to a cloud provider, but users must still verify their Ollama installation and selected model are configured for local inference.

**Limitations:** Responses are not yet guaranteed to cite real files correctly; users should inspect suggestions before use. Full chat history, clickable verified citations, streaming, provider selection, and optional bounded source excerpts are subsequent Phase 5 work. There is no background LLM execution.

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
