# CI

GitHub Actions tests every pull request, whatever branch it targets (stacked PRs target task branches), and every push to `main`. Each check is its own job with a stable name. Branch protection on `main` requires only **`ci-ok`**, which passes only when every other `ci.yml` job passed.

## Workflows

| File                                     | Runs on                                         | What it does                                                                                                                                 |
| ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`               | every PR, push to `main`, manual dispatch       | The merge gate (jobs below)                                                                                                                  |
| `.github/workflows/update-snapshots.yml` | manual dispatch, `/update-snapshots` PR comment | Makes screenshot baselines on Linux and commits them to the PR branch                                                                        |
| `.github/workflows/nightly.yml`          | daily 07:23 UTC, manual dispatch                | e2e 3× in a row (flake hunt), simulator studies, Lighthouse and perf budgets                                                                 |
| `.github/workflows/actionlint.yml`       | PRs and `main` pushes that touch `.github/`     | Lints the workflows, including shellcheck on `run:` scripts                                                                                  |
| `.github/dependabot.yml`                 | weekly (Monday)                                 | Grouped updates: npm dev deps in one PR, runtime deps in another, all GitHub Actions in one, Docker base images (once the Dockerfile exists) |

## `ci.yml` jobs

| Job                                   | Runs                                                                                                                                | Catches                                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck`                           | `npm run typecheck`                                                                                                                 | Type errors in `src/`, `tools/`, `tests/` and the configs                                                                                                                                                 |
| `lint`                                | `npm run lint`                                                                                                                      | Oxlint findings (including the purity zones), unformatted files (`oxfmt --check`), the `tools/check-*.ts` guard scripts (boundaries, UI literals)                                                         |
| `unit`                                | `npm run test:cov`                                                                                                                  | Failing unit and property tests. Coverage table in the job summary, `coverage/` uploaded as an artifact. Fails on the per-folder thresholds once they are on (see below)                                  |
| `content`                             | the content validators (see below)                                                                                                  | Broken word lists, curriculum, i18n keys, invalid content JSON, a stale `docs/curriculum.md`                                                                                                              |
| `build`                               | `npm run build`, `npm run size`, `npm run build:test`                                                                               | Build errors and bundle budget breaches (`contracts.md` §14). The size table goes to the job summary and to one sticky PR comment that is updated in place. Uploads `dist/` and `dist-test/` as artifacts |
| `e2e (1/3)`, `e2e (2/3)`, `e2e (3/3)` | Playwright, sharded ×3, in `mcr.microsoft.com/playwright:v<installed version>-noble`, against the `dist-test` artifact, with `CI=1` | Failing e2e specs, axe violations, screenshot diffs. On failure the shard uploads `playwright-report-<n>` (HTML report and traces); every shard uploads a blob report                                     |
| `docker`                              | builds the image (never pushed), runs it, curls it                                                                                  | A broken Dockerfile, root user, missing `HEALTHCHECK`, `/` not 200, missing security headers, no SPA fallback, hashed assets not `immutable`, `/sw.js` not `no-cache`                                     |
| `deps`                                | `npm audit --omit=dev --audit-level=high`, and `dependency-review-action` on PRs                                                    | Known high/critical vulnerabilities in what ships to the browser, and risky dependency changes in the PR                                                                                                  |
| `codeql`                              | GitHub CodeQL, JavaScript/TypeScript, no build                                                                                      | Security issues in the code. Alerts appear under Security → Code scanning                                                                                                                                 |
| `ci-ok`                               | `needs:` every job above                                                                                                            | Anything above that isn't green. The only required check                                                                                                                                                  |

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
3. The workflow builds `dist-test/`, runs `npx playwright test --update-snapshots=changed --retries=0` in the Playwright container, and commits changed files under `tests/e2e/__screenshots__/` to the branch as `github-actions[bot]`.
4. It comments on the PR with the list of PNGs. Review the image diff in **Files changed**.
5. **Commits pushed with `GITHUB_TOKEN` don't start workflows**, so the PR's new head would have no checks and `ci-ok` would never report. The workflow's last job therefore runs `gh workflow run ci.yml --ref <branch>` (dispatch is the one event `GITHUB_TOKEN` may start). That run reports every `ci.yml` check, `ci-ok` included, on the new head commit, so the PR is mergeable once it is green.

Both triggers need the workflow file on `main`: GitHub only dispatches workflows, and only runs `issue_comment` workflows, from the default branch. The workflow refuses to run on `main` itself and on PRs from forks.

## Dependency graph (owner setting)

`dependency-review-action` needs the repo's dependency graph. While it is off, the `deps` job checks for it (`GET /repos/{owner}/{repo}/dependency-graph/sbom` returns 404), skips the review with a warning and still runs `npm audit`. Turning the graph on (Settings → Advanced Security → Dependency graph, or `gh api -X PUT repos/chimericdream/voxel-typer/vulnerability-alerts`, which also turns on Dependabot alerts) makes the review run on the next PR with no CI change.

## Branch protection

`main` requires `ci-ok`, requires branches to be up to date before merging, and blocks force pushes and deletion. Admins can bypass it for emergencies (`enforce_admins: false`). The `gh api` command is in `docs/handoffs/M0-03.md`.

## Caching

- npm: `actions/setup-node` with `cache: npm` in every job that installs (also inside the Playwright container, where it only sets up the cache and keeps the image's Node).
- Playwright container: the image is pulled from MCR when the job starts. On this PR's first run, "Initialize containers" took 19 s per e2e shard. Hosted runners keep no Docker layer cache between jobs, and saving the multi-GB image into the Actions cache (10 GB per repo) and loading it back would take longer than that pull, so the image isn't cached. The official image already contains the browsers, so no job runs `playwright install`.

## Running actionlint locally

```sh
# Release binary (checksum-verified), or the same Docker image CI uses:
gh release download v1.7.12 -R rhysd/actionlint -p 'actionlint_1.7.12_windows_amd64.zip'
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
```

The Docker image includes shellcheck; the bare binary only uses it if shellcheck is on `PATH`.
