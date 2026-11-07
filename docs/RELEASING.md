# Releasing CodingSensei

CodingSensei uses Semantic Versioning: `MAJOR.MINOR.PATCH`.

While CodingSensei is pre-1.0, minor versions represent meaningful product milestones or features, such as `0.2.0` to `0.3.0`. Patch versions represent compatible fixes, such as `0.2.0` to `0.2.1`. Breaking architectural changes may still happen before 1.0, but they must be documented clearly in the changelog and release notes.

## Milestone version convention

- Phase 0: `0.1.0` - Extension Foundation
- Phase 1: `0.2.0` - Deterministic Project Intelligence
- Phase 2: `0.3.0` - Language & Framework Intelligence
- Phase 3: `0.4.0` - Persistent Project Intelligence
- Phase 4: `0.5.0` - Deep Structural Intelligence & Retrieval

Later milestone mappings are maintained in the roadmap as the V1 architecture evolves. This convention is not a reason to rush a release merely because a phase name exists.

## Version consistency

For every formal release, the `package.json` version must equal the Git tag without the leading `v`.

Example:

- `package.json`: `0.2.0`
- Git tag: `v0.2.0`

This avoids historical version mismatches and keeps release artifacts easy to audit.

## Historical Phase 0 handling

Phase 0 is represented as historical milestone `0.1.0` in `CHANGELOG.md`. Because the repository manifest was still `0.0.1` at the Phase 0 merge, CodingSensei intentionally will not create a retroactive `v0.1.0` release tag.

The first formal Git tag and GitHub Release will be `v0.2.0`.

## Manual release process

1. Finish and merge the milestone work into `main`.
2. Create a small release/version PR if the version has not already been updated.
3. Update `package.json`.
4. Update `CHANGELOG.md`.
5. Run:

   ```bash
   pnpm check
   ```

6. Merge the release/version PR.
7. Pull `main` locally.
8. Create an annotated Git tag:

   ```bash
   git tag -a vX.Y.Z -m "CodingSensei vX.Y.Z - <release name>"
   ```

9. Push the tag:

   ```bash
   git push origin vX.Y.Z
   ```

10. Create a GitHub Release from that exact tag.
11. Use the corresponding `CHANGELOG.md` entry as the basis for release notes.

Do not automate publishing to the VS Code Marketplace yet. Marketplace, VSIX, npm, GitHub Release and tagging automation can be added later once the manual release process is stable.

Future local model artifacts will have separate metadata and checksum handling. Model versions do not determine CodingSensei's application SemVer.
