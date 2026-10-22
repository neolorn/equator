# Releasing

This document describes how a release of `@neolorn/equator` and `@neolorn/equator-toolkit` is produced. The two packages share one version and are released together.

## Versioning

Versions follow [Semantic Versioning](https://semver.org). [Versioning and compatibility](docs/versioning.md) describes which surfaces the version number covers.

Prereleases use the form `0.0.0-rc.1` and are published under the `next` dist-tag. Stable releases are published under `latest`.

## Procedure

The commands below are written for version `0.0.0`, which this project cannot produce: versions only increase and the project is past it. Substitute the version being released. The example is deliberately impossible because a procedure written in a plausible next version reads as a record of that release rather than as an illustration of the steps.

1. **Write the changelog.** Add the release section to `CHANGELOG.md`: what was added, changed, fixed, and removed, any migration steps, and the supported host ranges. The changelog is written for someone deciding whether to upgrade. Its format is the one [Documentation](CONTRIBUTING.md#documentation) in the contributing guide states. At release the `[Unreleased]` section becomes that version's section, carrying its number and its date.

2. **Set the version.** Update `version` in `package.json`, `packages/runtime/package.json`, and `packages/toolkit/package.json`. The three must match; the verification suite fails otherwise.

   Then record the format stamps this release carries, so a later change cannot replace a shape a reader has received:

   ```sh
   node tools/generate-format-shapes.mjs --release
   ```

3. **Commit the release.**

   ```sh
   git commit -am "chore(release): 0.0.0"
   ```

4. **Run the verification suite** on that commit:

   ```sh
   pnpm run verify
   ```

   The suite must pass in full. As part of the run, `verify:tarballs` packs both packages and verifies the archive contents against the build; the verified archives are written to `release/runtime/0.0.0/` and `release/toolkit/0.0.0/`, one directory per version so that a later release does not remove an archive this one has not published yet.

5. **Tag the verified commit and push both**, then read the tag back from the remote rather than trusting the push output. The tag is created after the suite has passed, so a tag never names a commit the suite has not verified, and a red run leaves a commit to fix with no tag to delete. It is annotated because the push below carries annotated tags and silently leaves a lightweight one behind.

   ```sh
   git tag -a v0.0.0 -m "0.0.0"
   git push origin main --follow-tags
   git ls-remote --tags origin "v0.0.0*"
   ```

   Two lines must appear: `refs/tags/v0.0.0` and `refs/tags/v0.0.0^{}`. The second confirms the tag is annotated, and its object must equal what `git rev-parse v0.0.0^{}` prints locally, which is the release commit reaching the remote under the tag. One line means a lightweight tag arrived; no lines mean the tag was left behind. Neither is a release.

6. **Publish the verified archives.** Publish the archives the suite produced rather than repacking, and only once they match the hosted run. The push in step 5 starts the `verify` workflow on the release commit; wait for it to pass, then compare the hashes its "Hash the verified archives" step printed with those of the local archives:

   ```sh
   sha256sum release/runtime/0.0.0/*.tgz release/toolkit/0.0.0/*.tgz
   ```

   Both lines must match the hosted run's. The build is reproducible, so a mismatch means the two runs did not build the same thing; find out why before anything is published.

   ```sh
   npm publish release/runtime/0.0.0/neolorn-equator-0.0.0.tgz
   npm publish release/toolkit/0.0.0/neolorn-equator-toolkit-0.0.0.tgz
   ```

   For a prerelease, add `--tag next`. The registry is set by `publishConfig` in each manifest. Publish both packages in the same session.

7. **Move the version on.** Set the three manifests to the next prerelease identifier, so the tree stops claiming a version that has shipped:

   ```sh
   git commit -am "chore(version): 0.0.1-rc.1"
   ```

   Step 4 writes the verified archives under the version in the manifests. A tree left on the version it just published packs every later run into that same directory, so the archive holding what was published is replaced by a build that was not. Moving the version on keeps each build between releases under a version nothing has published, and the next release's step 2 sets the version it actually goes out as.

8. **Create the GitHub release** from the tag. The body is that version's change list drafted from its changelog section, one line per change, then the install commands for both packages, then the links a reader follows from the release. It opens with the list and carries no summary sentence above it.

9. **Verify the publication.** From a clean directory, install both packages at the new version and confirm they resolve.

## Withdrawing a release

A published version is never modified or republished. If a release must be withdrawn, deprecate it on the registry with a message pointing to the version that replaces it:

```sh
npm deprecate @neolorn/equator@0.0.0 "Use 0.0.1"
npm deprecate @neolorn/equator-toolkit@0.0.0 "Use 0.0.1"
```
