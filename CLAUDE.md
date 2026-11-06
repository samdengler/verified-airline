# CLAUDE.md

Verified Airline, a fictional airline's site written from the Verified Air Lean model (<https://github.com/samdengler/verified-air>, usually checked out beside this repository as `../verified-air`). The README explains the design and records every decision; read it before changing structure.

## Working on the site

- The site is the Angular app in `web/`, at https://air.dengler.io/. `npm --prefix web start` serves it at http://localhost:4200; `scripts/preview.sh` serves the static pages at http://localhost:8001. The app needs Node 24.15 or later.
- `npm --prefix web run build && npm --prefix web run check` builds the app and checks every page in Chrome under the site's content security policy. Run it, `npm --prefix web test`, and `(cd infra && uv run --dev pytest -q)` before pushing.
- For a visual change, take screenshots (the browser check's `--shots DIR` saves some) and show them before pushing.
- `scripts/deploy.sh` deploys the `VerifiedAirline` stack and publishes the site; `--site-only` publishes only. It needs AWS credentials for the account with the dengler.io zone. A change to an inline script needs the full deploy, since the policy allows inline scripts by hash.
- Push straight to `main`. No pull requests, no merge commits.

## The model's files

- `model/facts.json`, `model/model.json`, `model/theorems.json` and the chat's policy (`model/ar-policy.json`, `ar-rules.json`, `ar-checks.json`) come from verified-air; never edit them by hand. A change to the policy's rules belongs in verified-air's `scripts/export_airline_policy.py`. `scripts/update-model.sh` copies them, from verified-air's site or from `../verified-air/build/airline-data` after a local build there. Commit `model/` afterwards.
- Every amount is a `{{placeholder}}` from `model/facts.json`; never type one. To change a fee or refund, change `Airline/Fares.lean` in verified-air, rebuild there, then update `model/`.
- The fares must not depend on a reading of the guide: no expiration dates, no refund both full and fixed. `lake exe airline-facts` in verified-air fails if two readings disagree.
- verified-air's CI runs `scripts/render_airline.py --model <its fresh build> --out <a scratch directory>` through its `scripts/check-airline.sh`. Keep the renderer on Python's standard library, and keep both options working.

## One ID

- The check-in, wallet and gate screens read a second model, verified-id, IATA's One ID guide in Lean (usually at `../verified-id`, a private repository). The Claude Doc "One ID on Verified Airline: implementation plan" is the design.
- Sam decided on 5 November 2026 to publish this with the site; verified-id itself stays private. Do not change that repository from here.
- An inline script needs the full deploy, and Angular's event replay writes one per list of events a page listens to, in the order it meets them. Each One ID screen listens for `submit` as the policy pages do, and the skip link's click listener in `app.ts` puts click first, so every page has the same script. `python3 infra/verified_airline_infra/csp.py web/dist/verified-airline/browser "<live policy>"` says whether the live policy allows a build.
- Verified Airline's design system is `assets/design/`: tokens, markers and components, used by the website and the gate reader. The demo wallet sets neutral tokens and shows none of the airline's brand; the gate reader keeps the brand and sets plum tokens in `.surface-gate`. Type no color in a component, and share nothing with any other project's design system.
- The trip map on each app (`one-id/trip-map.ts`) draws its route from `one-id/trip-route.ts`. The map may run an action the screen offers, and never a share: sharing stays on the wallet's consent sheet. That route is ordinary code, so the map's marker is grey. A model of the trip would export the route, and the map would read that file instead.
- `model/one-id/`, with the presentation rules' files in `presentation/`, comes from verified-id's build; never edit it by hand. `scripts/update-model.sh --one-id` copies it from `../verified-id/build/one-id-data/` after `scripts/check_one_id.py` passes against the new files. verified-id's `scripts/check-airline.sh` runs that script too, so keep its `--model` option working.
- No outcome, status, count or requirement text is typed by hand. Outcomes come from the checks in `web/src/app/one-id/rules/`; everything about the model comes from `model/one-id/`. Each check names its requirement and Lean function in a comment, and takes its reading as a parameter.
- A trip resting on an undecided point stops at it, with the model shown. Every switch starts undecided; `one-id/decide.ts` works out where a trip stands from the checks and the files. The default trip never stops. A traveler holding one credential is never boarded: OID-207 needs both.
- With the model hidden the site is an ordinary airline: the trip is the scenario `scenarios.json` marks as the default, and nothing outside `data-lean` shows a requirement ID or the words rule, theorem or criterion. The wallet is titled "Demo wallet", and every credential is marked as a specimen.
- verified-id has no cryptography in its model, and its stand-in tables and boarding pass format are invented. Say so where they are shown, and never claim a signature or protocol is checked.
- The presenter panel on `/gate` shows only with the model. Its pickers come from the two `scenarios.json` files and its switches from the two `readings.json` files; `one-id/presenter.spec.ts` fails if they disagree. When an expert settles a question, remove the point from `rules/support/readings.ts` and from the check that reads it.
- `render_airline.py` must keep working when given only verified-air's model: One ID's checks are skipped when `model/one-id/` or `content/one-id.json` is missing.

## Wording

- Each `##` section of a policy page ends with `{model: ID, ...}` and each item under "Still being decided" with `{open: criterion}`. When a cited criterion is proven, the build stops: rewrite that item's wording. Since verified-air's CI checks this repository's `main`, rewrite it here before the proof is pushed there.
- Traveler-facing wording never says rule, theorem or criterion, and shows no requirement ID; the build checks the pages with the Lean model hidden. Those words belong in the popovers.
- Traveler-facing wording lives in `content/`, where the renderer checks it. The policy pages are the renderer's HTML as it stands. Angular templates hold the header, the footer, the not-found page, the chat, and the One ID flows in `web/src/app/one-id/`, which need state; their words still come from `content/chat.json` and `content/one-id.json`.

## What the site may claim

- Statuses and amounts come from the model's files. Never type one by hand.
- Proven means Lean checked a proof that holds for every input. Open means the theorem has no proof.
- This is a proof of concept, not affiliated with IATA. Rules from IATA's public material are described in our own words. Quote nothing from the EASD guide; its notice forbids reproduction.
- A booking flow or a support widget presents as checked only what the model computes. Label everything else as unproved, as verified-air's try-it panels do.

## Writing

Prose on the site and in the README follows one style: no em or en dashes; short declarative sentences; headings that name the topic; no "X, not Y" contrasts, rhetorical setups or filler adverbs. Text in the popovers uses the status words of verified-air's site: proven, open question, needs a decision; and for criteria, proven, example only, open, not checked.
