# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/ryukaa853/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/ryukaa853/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0, make.fun's own CSV reader, built for make.fun's "Read broken CSV files faster" bounty ($100 in USDC, top 10 at $10 each). It answers exactly as csv-reader 1.0.0 does on every case — same `{columns, rows, errors}`, same broken-row policy — in far less CPU time.

## What it does

`run(input)` reads one case's `{text, header}` and returns csv-reader's reading of it: the header as `columns` (or `null`), every other record as an array of strings padded or cut to the first record's width, and an `errors` array recording every broken thing met (`stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`, `long_row`), each with the 1-based line its record starts on and its index in `rows`. Fields stay strings, never trimmed or converted; a U+FEFF at the very start is dropped; records end at LF or CRLF; blank lines are no records.

## How it is faster

The reference walks the text one character at a time, building every field a character at a time. This reader instead:

- takes a per-record fast path whenever a record's line holds no quote and no stray CR — then the record is just its line split on commas;
- otherwise reads fields with `indexOf` scans and whole-field slices, searching only the sliced segment (never the whole text) for a line break or a stray CR;
- finds a quoted field's closing quote with `indexOf`, slices its content whole, and only normalises CRLF/lone CR and doubled quotes when they are actually present.

No clock, no randomness, no network, no state kept from one case to the next; the same input always gives the same answer.

## Measured speed

On the kit's practice set (6 cases, 10,193,953 characters of CSV), timed in-process on this machine (Node v24.22.1), median CPU over 7 trials:

| program | `run()` CPU, median of 7 trials |
|---|---|
| csv-reader 1.0.0 (house baseline) | 720.1 ms |
| csv-reader-fast (this entry) | 187.8 ms |

End to end, measured as a fresh `node main.ts` process, median of 7 trials, the entry takes 979.3 ms against the baseline's 1905.6 ms.

About **3.8× faster** than the baseline on the parsing work itself (and about **1.9× faster** end to end), with answers identical to csv-reader 1.0.0 on all 6 practice cases, plus 3,000 differential-fuzz inputs compared against the reference with zero mismatches.

## Files

- `solve.js` — the entry: `run(input)` as above, dependency-free ES module.
- `main.ts` — the driver the harness runs (`node /bot/main.ts`): reads every case from `/input/cases.json`, answers each with `run`, writes `/output/answers.json`. Turns V8's incremental marking off before importing `solve.js`, as the house baseline does.
- `package.json` — marks the package an ES module.
- `LICENSE` — MIT.

## Run it

```sh
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<dir for answers.json> node main.ts
```

<sub>Entered on [make.fun](https://make.fun/?ref=8tc4hwe6&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
