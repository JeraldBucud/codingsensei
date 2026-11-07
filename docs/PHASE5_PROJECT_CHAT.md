# Phase 5 — One Local Agent, One Model

CodingSensei is a **public, local-first VS Code extension**, not a personal Ollama integration. A developer should install the small Core extension, optionally enable local AI, and use it without installing Python, Ollama, LM Studio, signing in, or providing an API key.

## Implemented in draft PR #11

- The existing Project Intelligence Engine ranks indexed project files, symbols and deterministic relationships.
- `CodingSenseiAgent` uses **one local model** for three explicit tasks: **Reason** (explore/debug), **Code** (review a proposed code change), and **Learn** (progressive hints). The same model is reused for all tasks; there is no supervising LLM.
- The bounded project chat prompt treats indexed evidence and source excerpts as **untrusted data**. For coding suggestions, the command can read up to two relevant local files (16 KiB maximum per file) and pass at most 5,000 characters from each to the local model.
- `ManagedRuntimeStore` installs a pinned **llama.cpp CPU runtime** on explicit user approval, using the official GitHub release `b12142`. The release API's SHA-256 digest is required and verified before extraction. Supported CPU targets: Windows x64/arm64, macOS x64/arm64 and Linux x64/arm64.
- `LocalModelStore` installs a single curated **Qwen3-1.7B Q4_K_M GGUF** from `ggml-org/Qwen3-1.7B-GGUF`, with a pinned SHA-256 checksum. It is approximately 1.28 GB, Apache-2.0 licensed and optional.
- The managed `llama-server` process is started **only when requested**, bound to `127.0.0.1` with a random API key, and stopped after every answer (Eco mode). CPU inference is the initial compatibility baseline. No telemetry or cloud inference is implemented.
- The resulting explanation or proposed change appears in an unsaved Markdown editor. CodingSensei **does not execute code, modify files or run tests** on the user's behalf.

## User journey

1. Install CodingSensei Core from the VS Code Marketplace when a pre-release package becomes available. Core Project Intelligence continues to work **without** a model.
2. Open a **trusted** project and run **CodingSensei: Build Deep Project Intelligence**.
3. Run **CodingSensei: Ask Project (Built-in Local Agent)** and choose Reason, Code or Learn.
4. The first local AI request asks for consent to download the CPU runtime and approximately 1.28 GB model. Verify that sufficient disk space and memory are available.
5. Ask a question. CodingSensei provides only the selected evidence to its own local runtime. The runtime stops once the answer is returned.

The first run requires internet access to download **the runtime and model assets only**; subsequent requests do not need network access. GGUF source files, checked-out code and prompts are not uploaded. Local inference remains on the machine running the VS Code extension host.

## Boundaries and known limitations

- The downloaded runtime is a native third-party executable. We must audit its licences, supply chain and archive extraction before Marketplace distribution. `tar` must be available in the extension-host environment. The current installer validates archive entry paths, but an additional unpacking hardening review (including symlinks) is required before shipping.
- CPU-only inference is the initial baseline. GPU acceleration, low-memory device detection, performance benchmarking, model profiles and caching are future work.
- The current code action **proposes** changes. It does not apply edits. Model output is not yet verified against actual file contents, and generated file/line references are not yet clickable verified citations.
- No background indexing or autonomous coding loop is required for local AI inference; the model is idle/unloaded when not requested.
- A VS Code remote extension host uses the remote machine for inference. Support for local UI-host inference when using Remote SSH/containers requires separate design.
- Browser VS Code / vscode.dev does not support this native-runtime workflow. It must retain the deterministic Core without AI until a suitable alternative exists.
- User-space downloads and executable permission behaviour still require hands-on Windows/macOS/Linux testing; macOS Gatekeeper, antivirus, archive layout, executable dependencies and timeouts may need platform-specific fixes.
- Large model downloads may be slow or fail on limited storage/network connections; the installer must remain opt-in and clearly communicate size, source and licence.

## Phase 5 release gates

- Build, typecheck, lint, formatting and automated unit tests passing.
- Windows/macOS/Linux native runtime installation and end-to-end chat smoke tests.
- Security review for archive extraction, binary provenance, process lifecycle, filesystem boundaries and extension trust.
- First-run onboarding, disk/memory preflight, cancellation and retry UX.
- Streamed chat UI, verified clickable citations, bounded reading of source files and user review of code proposals.
- Benchmark small-model performance and output quality for coding, reasoning and Learning Mode on modest laptops.
- Marketplace publisher identity, platform-specific packaging, licences and pre-release validation.

**Do not merge PR #11 or publish to the VS Code Marketplace until the remaining release gates pass.**
