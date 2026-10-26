# @scdevbrazil/instant-nav

Dev tooling for the **perf-instant-nav** standard: in a signed-in Next.js app, every navigation paints its shell
(the frame) at once, and the data streams in behind it. The standard itself lives in the SCDEV workspace
(`standards/areas/perf-instant-nav/SPEC.md`).

> **Status: 0.0.0, skeleton.** Every command below reports **exit 3 (cannot measure)** until it is built.
> Nothing here certifies a project yet.

```bash
npm i -D @scdevbrazil/instant-nav     # public npm, from 1.0.0
npx instant-nav check
```

| Command                    | What it does                                                  | Built in   |
| -------------------------- | ------------------------------------------------------------- | ---------- |
| `check`                    | static check of `src/app` (TypeScript AST, not regex)         | chunks 3-4 |
| `baseline [--prune]`       | the debt list that may only shrink                            | chunk 3    |
| `measure`                  | shell vs content time on production, signed in, never writing | chunk 6    |
| `scaffold-loading <route>` | a `loading.tsx` to review                                     | chunk 9    |
| `stamp-verify`             | vendored reference blocks vs their stamps                     | chunk 9    |

Exit codes: `0` pass · `1` violations · `2` usage · `3` cannot measure (an input is missing or unreadable;
the message names it).

**Requirements:** Node >= 24, Next.js >= 16.3.0 < 17. The parser is a pinned TypeScript 5.9 that ships with this
package, so the check keeps working when an app moves to TypeScript 7 (whose package no longer exposes the classic
compiler API).
