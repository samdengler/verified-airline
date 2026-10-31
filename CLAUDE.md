# CLAUDE.md

Verified Airline, a fictional airline's site written from the Verified Air Lean model (<https://github.com/samdengler/verified-air>, usually checked out beside this repository as `../verified-air`). The README explains the design and records every decision; read it before changing structure.

## Working on the site

- The site is the Angular app in `web/`, at https://air.dengler.io/. `npm --prefix web start` serves it at http://localhost:4200; `scripts/preview.sh` serves the static pages at http://localhost:8001. The app needs Node 24.15 or later.
- `npm --prefix web run build && npm --prefix web run check` builds the app and checks every page in Chrome under the site's content security policy. Run it, `npm --prefix web test`, and `(cd infra && uv run --dev pytest -q)` before pushing.
- For a visual change, take screenshots (the browser check's `--shots DIR` saves some) and show them before pushing.
- `scripts/deploy.sh` deploys the `VerifiedAirline` stack and publishes the site; `--site-only` publishes only. It needs AWS credentials for the account with the dengler.io zone. A change to an inline script needs the full deploy, since the policy allows inline scripts by hash.
- Push straight to `main`. No pull requests, no merge commits.

## The model's files

- `model/facts.json` and `model/model.json` come from verified-air; never edit them by hand. `scripts/update-model.sh` copies them, from verified-air's site or from `../verified-air/build/airline-data` after a local build there. Commit `model/` afterwards.
- Every amount is a `{{placeholder}}` from `model/facts.json`; never type one. To change a fee or refund, change `Airline/Fares.lean` in verified-air, rebuild there, then update `model/`.
- The fares must not depend on a reading of the guide: no expiration dates, no refund both full and fixed. `lake exe airline-facts` in verified-air fails if two readings disagree.
- verified-air's CI runs `scripts/render_airline.py --model <its fresh build> --out <a scratch directory>` through its `scripts/check-airline.sh`. Keep the renderer on Python's standard library, and keep both options working.

## Wording

- Each `##` section of a policy page ends with `{model: ID, ...}` and each item under "Still being decided" with `{open: criterion}`. When a cited criterion is proven, the build stops: rewrite that item's wording. Since verified-air's CI checks this repository's `main`, rewrite it here before the proof is pushed there.
- Traveler-facing wording never says rule, theorem or criterion, and shows no requirement ID; the build checks the pages with the Lean model hidden. Those words belong in the popovers.
- Traveler-facing wording lives in `content/`, where the renderer checks it; the app shows the renderer's HTML. Angular templates hold only the header, the footer and the not-found page.

## What the site may claim

- Statuses and amounts come from the model's files. Never type one by hand.
- Proven means Lean checked a proof that holds for every input. Open means the theorem has no proof.
- This is a proof of concept, not affiliated with IATA. Rules from IATA's public material are described in our own words. Quote nothing from the EASD guide; its notice forbids reproduction.
- A booking flow or a support widget presents as checked only what the model computes. Label everything else as unproved, as verified-air's try-it panels do.

## Writing

Prose on the site and in the README follows one style: no em or en dashes; short declarative sentences; headings that name the topic; no "X, not Y" contrasts, rhetorical setups or filler adverbs. Text in the popovers uses the status words of verified-air's site: proven, open question, needs a decision; and for criteria, proven, example only, open, not checked.
