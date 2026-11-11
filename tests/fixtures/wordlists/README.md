# Word-list fixtures

Seeded bad lists for `tests/unit/content/wordlists.test.ts`. Each file under `bad/` breaks one
rule on a known line. Don't "fix" them: the test checks that the validator reports each one with
the right `file:line`. `tags/` has one tag mistake per file. `registry/` has a `pools.ts` that doesn't match its `.txt` files.
