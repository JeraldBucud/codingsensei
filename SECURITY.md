# Security Policy

CodingSensei is an early-stage local-first VS Code extension.

## Reporting a Vulnerability

Please report security issues through GitHub issues for now, unless the issue contains sensitive exploit details. If sensitive details are involved, contact the repository owner directly through their GitHub profile.

## Local-First Expectations

CodingSensei does not include telemetry, analytics, cloud APIs, authentication, API keys, model downloads or background network communication. Reports about accidental data transmission or hidden external dependencies are treated as security issues.

Phase 1 reads local project paths and small known metadata files such as `package.json` inside the VS Code workspace the user opened. It may resolve a nested active project root inside that workspace, but it does not scan the entire computer, mounted drives, home directory, Desktop, Documents, Downloads or unrelated OneDrive folders. It discovers root metadata such as lock files and build wrappers separately from the bounded source scan, but it does not execute those files. Optional Git awareness reads local branch and NUL-delimited working-tree status using bounded `git` subprocess calls with `shell: false`. Phase 2 may ask VS Code language providers for symbols, definitions and references for the active document and active symbol, and may inspect the active document text with bounded deterministic heuristics to identify simple code-structure and framework evidence. Ordinary fast editor events use cached analysis and do not repeatedly read the full active document. CodingSensei does not run project scripts, tests, builds, Git hooks, package managers or framework code automatically.

## Phase 3 Local Persistence

Phase 3 introduces a small versioned `.codingsensei/project.json` identity file at the resolved project root. The file contains only a schema version, a randomly generated project UUID and its creation timestamp; it does not contain source code, credentials, absolute paths or model data. CodingSensei also writes a local project manifest beneath the extension's VS Code global storage, keyed by that UUID, so larger future intelligence data can remain outside the repository. The local manifest may record the last known project-root URI for local project recognition and management. A separate local structural catalog may store relative source/test file paths, project metadata summaries, tool/script names and scan counts. The catalog does not store source-file contents. CodingSensei does not upload this information or transmit it to external services.

## Local Git Hygiene

CodingSensei treats the small `.codingsensei` project-identity directory as machine-local metadata. It writes a local `.codingsensei/.gitignore` containing `*` so the directory ignores itself and its generated identity file without modifying the repository's root `.gitignore`, Git configuration, remotes, hooks or tracked files. Failure to create this self-ignore file does not disable project persistence.
