# Release notes for maintainers

## Fixed identifiers (never change after first public release)

Changing either one breaks auto-update and orphans user data.

| Thing | Value |
| --- | --- |
| userData folder name | `BarkStudy` (pinned in `src/main/identity.ts` with `app.setPath`, so renaming the app never moves it) |
| `appId` | `io.github.seejjaay.barkstudy` (**locked 2026-11-02**; also the Windows AppUserModelId. Set in `src/main/identity.ts` and repeated in `electron-builder.yml`) |

The display name (`productName`) may still change before 1.0.

## How a release happens

1. Work lands on `main` through pull requests with [conventional commits](https://www.conventionalcommits.org/).
2. `release-please` (the `Release` workflow) keeps one PR open, "chore(main): release X.Y.Z", with the version bump and `CHANGELOG.md` worked out from those commits. While the version is below 1.0, a `feat:` bumps the minor and a `fix:` the patch.
3. **Merging that PR is the release.** It creates the tag `vX.Y.Z` and the GitHub release, and the `publish` job then runs the same checks as CI on that tag, packages the installer, runs `scripts/verify-package.cjs`, checks that `latest.yml` matches the installer's hash, and attaches `BarkStudy-Setup-X.Y.Z.exe`, its `.blockmap` and `latest.yml` to the release.
4. Installed copies find it through `latest.yml` on their next check (30 s after launch, then every 6 h).

Things to know:

- **CI does not run on the release PR.** release-please opens it with the default `GITHUB_TOKEN`, and GitHub does not start workflows for pushes made with that token. The PR only changes `package.json`, `package-lock.json` and `CHANGELOG.md`, and the `publish` job re-runs every check on the tag before anything is uploaded, so this is accepted.
- **There is a short gap** between the release appearing and its files being attached. An update check inside it finds no `latest.yml`, fails quietly and tries again next cycle.
- **0.x releases are normal releases, not GitHub "prereleases".** electron-updater offers prereleases only to people who turned on *Include beta versions*, so marking every 0.x a prerelease would leave other testers never updated. Tags like `v1.1.0-beta.1` are for the beta channel.
- **While the build is unsigned** the `publish` job puts an "Unsigned beta: SmartScreen will warn" banner at the top of the release notes. 1.0 waits for signing.
- A third-party action is only ever used pinned to a full commit SHA. Dependabot bumps them weekly.

## Settings the workflow expects (repository settings, not in the repo)

| Name | Kind | Needed for |
| --- | --- | --- |
| `SIGNPATH_API_TOKEN` | secret | signing (all four SignPath settings must exist, or the signing steps are skipped) |
| `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG` | variables | signing |
| `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | variable, optional | signing, when the project has more than one artifact configuration |
| `WINGET_TOKEN` | secret | submitting to winget (stable releases at 1.0 or later only) |

Also turn on **Settings → Code security → Private vulnerability reporting**, which `SECURITY.md` points people to.

### Repository settings the release flow depends on (as of 2026-11-03)

- **Settings → Actions → General → Workflow permissions: "Allow GitHub Actions to create and approve pull requests" must be on** (default permissions stay "Read"). Without it, release-please pushes its release branch and then fails to open the PR ("GitHub Actions is not permitted to create or approve pull requests"). It is on now. It also lets a workflow approve a PR, which is acceptable here because the only workflows are this repo's own, each with explicitly limited permissions.
- **`main` has no branch rules at the moment.** An earlier "Protect" ruleset was removed because, with a single maintainer, it made PRs impossible to merge: required approvals and approval of the latest push cannot be met by the author, a required CodeQL result never appeared because code scanning was not set up, and "Restrict updates" blocks every merge except a bypass. Day-to-day work goes straight to `main`; only the release PR that release-please opens is merged on GitHub (squash or rebase).
- **If protection is added back,** these are the rules that break this flow for one person: required approving reviews, "require approval of the most recent reviewable push", "restrict updates", and any required status check that nothing produces (CodeQL, or CI on the release PR, which never runs on a bot-opened PR). Keep **linear history** in mind too: merge commits are refused, so use squash or rebase. SignPath also expects source reviews on release branches, so decide what to tell them before applying (the README's code signing policy names one maintainer who is author, reviewer and approver).

## First signed release (not yet run)

The SignPath steps in `release.yml` were written against SignPath's published action inputs and have not been exercised: they cannot be until the project is approved. At the first signed release:

1. Apply to the [SignPath Foundation](https://signpath.org/) open-source program (the repository is public) and set the secret and variables above.
2. Watch the first `publish` run. Expect to adjust the artifact configuration and the file names SignPath returns (the workflow assumes `signed/exe/BarkStudy.exe` and `signed/installer/BarkStudy-Setup-*.exe`).
3. The `latest.yml` check must pass before upload: the updater refuses an installer whose hash differs from `latest.yml`. A signed installer has no matching blockmap, so updates from it download in full.
4. Confirm on a clean PC that SmartScreen no longer warns, then drop the "unsigned" banner step and the README's SmartScreen note.

## winget (from 1.0)

The package id is **`seejjaay.BarkStudy`**. The `winget` job submits an update PR to `microsoft/winget-pkgs` for each stable tag from `v1.0.0` on, and only when `WINGET_TOKEN` exists. It cannot create the package, so the first submission is made once, by hand:

1. Fork `microsoft/winget-pkgs` and create a fine-grained token with write access to the fork's contents and pull requests; store it as `WINGET_TOKEN`.
2. Install [wingetcreate](https://github.com/microsoft/winget-create) and run `wingetcreate new <url of the 1.0.0 installer>` with the identifier `seejjaay.BarkStudy`, then submit it.
3. Once that PR is merged, later releases are automatic.
