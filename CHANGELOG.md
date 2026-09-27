# Changelog

Notable CodingSensei changes are recorded here. CodingSensei follows Semantic Versioning.

## [Unreleased]

### Persistent Project Intelligence

- Added the Phase 3 project-identity foundation with a versioned `.codingsensei/project.json` file and stable UUID.
- The local `.codingsensei` metadata directory now self-ignores through its own generated `.gitignore`, so enabling CodingSensei does not dirty the user's Git working tree or edit the repository's root `.gitignore`.
- Added local extension-storage manifests under CodingSensei's VS Code global storage, keyed by the stable project ID.
- Project identity creation is idempotent, malformed identity files are not silently overwritten, and persistence failures do not disable deterministic project analysis.
- Learning Mode now surfaces whether persistent project identity is ready for the active project.
- Persistent project catalogs can be restored immediately after restart, then revalidated in the background.
- Active-file language/framework knowledge is restored only when its content hash still matches the current document; stale provider-derived cross-file relationships are not trusted on restore.
- Source-file create/delete/change events update or invalidate persistent knowledge incrementally, and changed files can be re-indexed deterministically during editor idle time.
- Added a versioned external structural project catalog with source/test paths, project metadata summaries and scan state; source contents are not stored in the catalog.
- Source-file create/delete events update the cached structural index incrementally instead of forcing a full project rescan when a current index exists.
- Added commands to inspect, rebuild and clear stored project intelligence while preserving the stable project identity.

### Branding

- Renamed the project from CodeShade to CodingSensei before VS Code Marketplace publication.
- Updated the extension package name, command/view identifiers, local publisher placeholder, documentation, UI copy and development launch labels to the CodingSensei identity.
- Added a dedicated brand-asset structure for GitHub, documentation, VS Code and social creatives.

Future changes will be recorded here.

## [0.3.0] - 2026-09-26

### Language & Framework Intelligence

Phase 2 adds deterministic language and framework understanding on top of the project-intelligence foundation while keeping CodeShade local-first and model-free.

Added:

- Native-first active-document symbol analysis using VS Code language providers when available.
- Focused, bounded VS Code definition and reference lookups for the active symbol.
- Deterministic fallback analysis for simple symbols, imports, entry points and local code relationships.
- Current-symbol tracking that stays responsive during cursor movement by reusing cached analysis.
- Conservative local relationship resolution for project imports, rendered components and Java service-style dependencies.
- Evidence-based framework signals and roles for React, Express, Django and Spring Boot.
- Framework detection that combines active-file evidence with bounded project metadata rather than relying on weak filename or annotation guesses.
- Resolved local-import guidance in Learning Mode and deterministic next-step suggestions.
- Debounced document analysis, bounded caches and stale-result protection so fast editor events stay cheap.
- Project/language reconciliation when switching between nested projects such as frontend and backend applications.

Correctness work includes language-scoped relationship heuristics, filtering stale provider-derived relationships, avoiding same-file definition suggestions, supporting modern React JSX without an explicit React import, and preserving Spring Boot metadata through the project-analysis pipeline.

Manual validation covered real nested React and Spring Boot projects, including frontend/backend switching, active-symbol updates, resolved local imports and Spring service-role detection.

CodeShade remains local-first: no telemetry, cloud API, account, external AI service, LLM, model download, Tree-sitter dependency or project code execution is required.

## [0.2.0] - 2026-09-26

### Deterministic Project Intelligence

Phase 1 moved CodeShade from active-editor context into deterministic, local project understanding while preserving the product's local-first learning philosophy.

Added:

- Cached deterministic project intelligence for resolved active project roots.
- Workspace vs nested active project discovery, including location-agnostic project-root detection inside opened VS Code workspaces.
- JavaScript/TypeScript, Python and Java ecosystem detection.
- Package/build tool detection for Node package managers, Python project metadata, Maven and Gradle.
- Project metadata and package script awareness without executing project commands.
- Bounded source scanning with separate critical metadata discovery.
- Source/test relationship heuristics and source/test counts.
- Optional local Git branch and change-state awareness.
- Project-aware next-step suggestions.
- Fast editor context separated from slower structural project analysis.
- Nested Maven, Node and Python project handling.
- Multi-project workspace handling without combining sibling projects into one fake project.

Correctness and performance work included safer cache invalidation, no Git subprocesses on fast editor events, NUL-delimited Git status parsing, Git-root/project-root path handling, and preservation of script-free Learning Mode rendering.

CodeShade remains local-first: no telemetry, cloud API, account, external AI service, LLM, model download or project code execution is required.

## [0.1.0] - 2026-09-25

### Extension Foundation

Phase 0 established CodeShade as a real VS Code extension and created the initial local-first learning experience.

Added:

- Initial VS Code extension foundation.
- CodeShade Activity Bar container.
- Learning Mode view.
- Active workspace, file and language context.
- Active-file diagnostics in the learning context.
- Deterministic next-step guidance.
- Progressive hints designed to avoid giving away complete answers immediately.
- Initial JavaScript, TypeScript, Python and Java language foundations.
- Local-first/privacy architecture with no telemetry, cloud API or model dependency.
- CI, build, test, lint and formatting tooling.

This is a historical project milestone recorded in the changelog. The repository manifest was still `0.0.1` at the Phase 0 merge, so no retroactive `v0.1.0` Git tag or GitHub Release is planned.
