# CI

GitHub Actions tests every pull request, whatever branch it targets (stacked PRs target task branches), and every push to `main`. Each check is its own job with a stable name. Branch protection on `main` requires only **`ci-ok`**, which passes only when every other `ci.yml` job passed.

## Workflows

| File                                     | Runs on                                         | What it does                                                                                                                                 |
| ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`               | every PR, push to `main`, manual dispatch       | The merge gate (jobs below)                                                                                                                  |
| `.github/workflows/update-snapshots.yml` | manual dispatch, `/update-snapshots` PR comment | Makes screenshot baselines on Linux and commits them to the PR branch                                                                        |
| `.github/workflows/nightly.yml`          | daily 07:23 UTC, manual dispatch                | e2e 3× in a row (flake hunt), simulator studies, Lighthouse and perf budgets                                                                 |
| `.github/dependabot.yml`                 | weekly (Monday)                                 | Grouped updates: npm dev deps in one PR, runtime deps in another, all GitHub Actions in one, Docker base images (once the Dockerfile exists) |

## `ci.yml` jobs

| Job                                   | Runs                                                                                                                                | Catches                                                                                                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actionlint`                          | actionlint 1.7.12 (Docker image by digest) on every workflow file, with shellcheck on `run:` scripts                                | Broken workflow files, expression and shell mistakes. Unfiltered (it takes seconds) so it can gate `ci-ok`                                                                                                                                                    |
| `typecheck`                           | `npm run typecheck`                                                                                                                 | Type errors in `src/`, `tools/`, `tests/` and the configs                                                                                                                                                                                                     |
| `lint`                                | `npm run lint`                                                                                                                      | Oxlint findings (including the purity zones), unformatted files (`oxfmt --check`), the `tools/check-*.ts` guard scripts (boundaries, UI literals)                                                                                                             |
| `unit`                                | `npm run test:cov`                                                                                                                  | Failing unit and property tests. Coverage table in the job summary, `coverage/` uploaded as an artifact. Fails on the per-folder thresholds once they are on (see below)                                                                                      |
| `content`                             | the content validators (see below)                                                                                                  | Broken word lists, curriculum, i18n keys, invalid content JSON, a stale `docs/curriculum.md`                                                                                                                                                                  |
| `build`                               | `npm run build`, `npm run size`, `npm run build:test`                                                                               | Build errors and bundle budget breaches (`contracts.md` §14). The size table goes to the job summary and to one sticky PR comment that is updated in place (a failed comment post is a warning, not a failure). Uploads `dist/` and `dist-test/` as artifacts |
| `e2e (1/3)`, `e2e (2/3)`, `e2e (3/3)` | Playwright, sharded ×3, in `mcr.microsoft.com/playwright:v<installed version>-noble`, against the `dist-test` artifact, with `CI=1` | Failing e2e specs, axe violations, screenshot diffs. On failure the shard uploads `playwright-report-<n>` (HTML report and traces); every shard uploads a blob report                                                                                         |
| `docker`                              | builds the image (never pushed), runs it, curls it                                                                                  | A broken Dockerfile, root user, missing `HEALTHCHECK`, `/` not 200, missing security headers, no SPA fallback, hashed assets not `immutable`, `/sw.js` not `no-cache`                                                                                         |
| `deps`                                | `npm audit --omit=dev --audit-level=high`, and `dependency-review-action` on PRs                                                    | Known high/critical vulnerabilities in what ships to the browser, and risky dependency changes in the PR. Fails if the dependency graph probe errors (see below)                                                                                              |
| `codeql`                              | GitHub CodeQL, JavaScript/TypeScript, no build                                                                                      | Security issues in the code. Alerts appear under Security → Code scanning                                                                                                                                                                                     |
| `ci-ok`                               | `needs:` every job above                                                                                                            | Anything above that isn't green. The only required check                                                                                                                                                                                                      |

The e2e container tag comes from the installed `@playwright/test` version (the `build` job reads it from `node_modules`, `update-snapshots.yml` and `nightly.yml` from `package-lock.json`), the same way `npm run e2e:docker` picks it. Bumping Playwright moves CI, local Docker runs and baselines together.

### How the dormant jobs switch on

Jobs whose code doesn't exist yet pass trivially. They switch on when their files appear, so a later task never edits CI just to turn its checks on.

| Check                       | Switches on when                                                                                                                                                                                                                              | Until then                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `content`: JSON syntax      | any tracked `src/**/*.json` exists                                                                                                                                                                                                            | "skipped: no JSON files yet"       |
| `content`: validators       | any `tools/validate-*.ts` exists. Each one is run as `npm run tool -- validate-<name>` (word lists `validate-wordlists` from M1-10, curriculum `validate-curriculum` from M3-01, and any block/mob/model schema validator named the same way) | "skipped: none yet"                |
| `content`: i18n keys        | `tools/i18n-keys.ts` exists (M1-12)                                                                                                                                                                                                           | skipped                            |
| `content`: curriculum doc   | `tools/gen-curriculum-doc.ts` exists (M3-01). CI runs it, then fails if `docs/curriculum.md` changed or is new                                                                                                                                | skipped                            |
| `e2e`                       | always on. Shards with no specs pass (`--pass-with-no-tests`)                                                                                                                                                                                 | —                                  |
| `docker`                    | a `Dockerfile` at the repo root (M0-05)                                                                                                                                                                                                       | a notice, job passes               |
| `docker`: `/sw.js` check    | the `dist` artifact contains `sw.js`                                                                                                                                                                                                          | a notice                           |
| `unit`: coverage thresholds | repo variable `COVERAGE_THRESHOLDS` is `1` (`gh variable set COVERAGE_THRESHOLDS --body 1`), or `enforceThresholds` is flipped in `vitest.config.ts` (M1-GATE)                                                                                | coverage is reported, not enforced |
| nightly: simulator studies  | any `tools/sim*.ts` exists. Each runs as `npm run tool -- <name>`; output goes to the `sim-results` artifact                                                                                                                                  | a notice                           |
| nightly: perf budgets       | any `tests/e2e/perf/*.spec.ts` exists (M6-10)                                                                                                                                                                                                 | a notice                           |
| nightly: Lighthouse         | `tools/lighthouse.ts` exists (M6-10)                                                                                                                                                                                                          | a notice                           |

Rules for the tools these jobs call: run with no arguments, print what is wrong, and exit non-zero on any problem. `gen-curriculum-doc` writes `docs/curriculum.md` when run with no arguments.

## Re-running

- A failed job: the PR's **Checks** tab → the run → **Re-run failed jobs**, or `gh run rerun <run-id> --failed`.
- The whole workflow on a branch: `gh workflow run ci.yml --ref <branch>`. The checks land on the branch's head commit, so they count for the PR.
- e2e failures: download `playwright-report-<n>` from the run, unzip it, `npx playwright show-report <dir>`. Traces open with `npx playwright show-trace <file>.zip`.
- Reproduce e2e with screenshots locally: `npm run e2e:docker` (same image, `CI=1`). Plain `npm run e2e` skips screenshot comparisons outside CI.

## Updating screenshot baselines

Baselines are only made on CI's Linux image (`docs/impl/README.md` §3.7), never on a dev machine.

1. Push the branch with the new or changed screenshot test and open the PR.
2. Either comment `/update-snapshots` on the PR (only the repo owner's comments trigger it), or run `gh workflow run update-snapshots.yml -f branch=<branch>`.
3. A comment doesn't do the work itself. The `request` job reacts with 👀, refuses fork PRs, looks up the PR's branch and dispatches the workflow with `branch=<branch>`, so every real run is a dispatch.
4. `resolve` refuses `main`, records the branch's head commit and finds the PR. `update` checks out that commit, builds `dist-test/` and runs `npx playwright test --update-snapshots=changed --retries=0` in the Playwright container. If anything under `tests/e2e/__screenshots__/` changed, it uploads the directory as the `baselines` artifact.
5. `push` checks out the same commit, copies only the `*.png` files from the artifact into `tests/e2e/__screenshots__/`, commits them as `github-actions[bot]` and pushes. If the branch moved during the run, the push is rejected as non-fast-forward and the PR comment says so; run it again.
6. `finish` comments on the PR with the list of PNGs. Review the image diff in **Files changed**.
7. **Commits pushed with `GITHUB_TOKEN` don't start workflows**, so the PR's new head would have no checks and `ci-ok` would never report. `finish` therefore runs `gh workflow run ci.yml --ref <branch>` (dispatch is the one event `GITHUB_TOKEN` may start). That run reports every `ci.yml` check, `ci-ok` included, on the new head commit, so the PR is mergeable once it is green.

Both triggers need the workflow file on `main`: GitHub only dispatches workflows, and only runs `issue_comment` workflows, from the default branch.

### Queuing

The workflow-level `concurrency` group is `update-snapshots-branch-<branch>` for dispatches and `update-snapshots-comment-<run id>` for every comment run. So:

- Two requests for the same branch run one after the other (`cancel-in-progress: false`). The second one tests the head the first one pushed, so it usually finds nothing to change. A group holds one running and one pending run; a third request replaces the pending one, which is harmless because both would do the same thing.
- A comment run never shares a group with anything, so an unrelated comment (a bot, a review) can't replace a queued snapshot run. Non-matching comments start a run whose jobs are all skipped.
- A `/update-snapshots` comment and a manual dispatch for the same branch queue together, because the comment becomes a dispatch.

### Token exposure

The branch's code (`npm ci` with its third-party install scripts, the build and Playwright) runs only in `update`, which has:

- `permissions: contents: read`, so even a leaked token can't push or comment;
- `persist-credentials: false` on checkout, so no token is written to `.git/config`;
- no npm cache. Runs started by a comment or a dispatch execute on `main`, so a cache they saved would land in `main`'s cache scope, which every CI run restores. The Playwright image's npm is used as is.

`push` is the only job with `contents: write`. It runs no branch code: it downloads the artifact, refuses symlinks, ignores anything that isn't a PNG, and runs `git add`, `commit` and `push`. The worst a malicious dependency in `update` can do is put arbitrary PNGs into the artifact, which then show up in the PR's diff for review. `request` and `finish` hold `actions: write` and `pull-requests: write` and run no branch code either.

## Concurrency

- `ci.yml` on a PR: group `ci-<PR number>`; a new push cancels the older run.
- `ci.yml` on `main` (push or dispatch): group `ci-main-<run id>`, unique per run, so no run on `main` is ever cancelled or dropped. A shared group would keep only one pending run and silently cancel a middle commit's run when several merges land at once; that commit would get no checks, and a `workflow_run` consumer such as `publish.yml` would never see it.
- `ci.yml` dispatched on another branch (by `update-snapshots.yml`): group `ci-refs/heads/<branch>`, not cancelled in progress. Only the newest pending run matters there, because it tests the branch head.

## Dependency graph (owner setting)

`dependency-review-action` needs the repo's dependency graph. The `deps` job probes `GET /repos/{owner}/{repo}/dependency-graph/sbom` first:

- 200: the review runs.
- 404 (graph off, as it is now): the review is skipped with a warning; `npm audit` still runs.
- anything else (5xx, rate limit, a permissions change, a network error): the job fails, so a transient error can't silently skip the review. Re-run the job.

Turning the graph on (Settings → Advanced Security → Dependency graph, or `gh api -X PUT repos/chimericdream/voxel-typer/vulnerability-alerts`, which also turns on Dependabot alerts) makes the review run on the next PR with no CI change.

## Branch protection

`main` requires `ci-ok`, requires branches to be up to date before merging, and blocks force pushes and deletion. Admins can bypass it for emergencies (`enforce_admins: false`). The `gh api` command is in `docs/handoffs/M0-03.md`.

## Caching

- npm: `actions/setup-node` with `cache: npm` in every job that installs (also inside the Playwright container, where it only sets up the cache and keeps the image's Node).
- Playwright container: the image is pulled from MCR when the job starts. On this PR's first run, "Initialize containers" took 19 s per e2e shard. Hosted runners keep no Docker layer cache between jobs, and saving the multi-GB image into the Actions cache (10 GB per repo) and loading it back would take longer than that pull, so the image isn't cached. The official image already contains the browsers, so no job runs `playwright install`.

## Running actionlint locally

CI runs it as the `actionlint` job in `ci.yml`. To check before pushing:

```sh
# Release binary (checksum-verified), or the same Docker image CI uses:
gh release download v1.7.12 -R rhysd/actionlint -p 'actionlint_1.7.12_windows_amd64.zip'
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
```

The Docker image includes shellcheck; the bare binary only uses it if shellcheck is on `PATH`.
