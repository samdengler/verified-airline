# Verified Airline

Verified Airline is a fictional airline. Its site answers a traveler's
questions about fares, payment, changes and cancellations, refunds, extras and
schedule changes in plain words. Every fee and refund on it is computed from
[Verified Air](https://samdengler.github.io/verified-air/), a model of the
business rules for airline offers and orders written in Lean, and a button
shows the requirement behind each answer.

- The site: <https://air.dengler.io/>. The old addresses under
  <https://samdengler.github.io/verified-airline/> send readers there.
- The model and its proofs: <https://github.com/samdengler/verified-air>

This is a proof of concept, not affiliated with IATA. The airline, its fares
and its fees are invented.

## The pages

A home page, a travel policies hub, and six policy pages. They read as an
ordinary airline's pages. The button "Show the Lean model" (or `?lean=1` in
the address, for a demo link) adds a ∀ marker beside each section. A marker
opens the requirement behind the section: its EARS statement, how many of its
criteria are proven or open, its Lean name, and a link to its chapter in the
model's review document. A marker is blue when every criterion is proven and
amber when any is open. Where a criterion is open, the page says the point is
still being decided and tells the traveler to contact the airline; its marker
shows the open question and links to it.

The pages follow the system's light or dark setting, and a button in the
header overrides it and remembers the choice.

The site is an Angular app (`web/`). Every page is rendered to HTML when the
site is built, with every popover already in the page, so the pages need no
data fetching and read with scripts off. Once the app starts, links within the
site change the page without reloading it.

## Where the amounts and statuses come from

Nothing on the pages is typed by hand. Two files in `model/` come from
verified-air's build:

- `model/facts.json`. Verified Airline's three fares, Basic, Main and Flex,
  are written in verified-air's `Airline/Fares.lean` as change and cancel
  rules of the model. `lake exe airline-facts` evaluates them with the model's
  functions under every reading the model leaves open, and fails if two
  readings give different answers.
- `model/model.json`. Every requirement with its EARS statement and its
  criteria with their statuses, the open questions behind each open
  criterion, and links into the review document. verified-air's
  `scripts/export_airline.py` writes it from the model's status.
- `model/theorems.json`. The Lean theorem behind each fare fact, and behind
  each of the support chat's general rules, with a link to its line.
- `model/ar-policy.json`, `model/ar-rules.json` and `model/ar-checks.json`.
  The support chat's Automated Reasoning policy, each rule's Lean rule,
  requirements, sentence and theorems, and a right and a wrong answer for each
  rule. verified-air's `scripts/export_airline_policy.py` writes them.

`scripts/update-model.sh` copies the newest files from verified-air's site,
where they are served under `/airline-data/`, or from a local build. The
committed files are the version of the model this site shows, and
`source.commit` in `model.json` names the verified-air commit they were built
from. To change a fee or refund, change `Airline/Fares.lean` in verified-air,
then update `model/` here.

## Checks

`scripts/render_airline.py` fails the build if a content file cites a
requirement or criterion the model does not have, lists as still being
decided a criterion that is no longer open, uses a placeholder the facts do
not have, types an amount, or leaves a section without a marker; and if a
page shows a requirement ID or the words rule, theorem or criterion while the
model is hidden.

verified-air's CI runs the same script against each new build of the model,
through its `scripts/check-airline.sh`. A proof that settles an open question
therefore stops verified-air's build until the wording here no longer calls
the point still being decided. Rewrite the wording here first, then push the
proof.

The app takes its pages from the same script: `--content` writes each page's
band and body as JSON, checked like the static pages, with links from the
site's root. CI also runs the app's unit tests, the stack's tests, and
`web/scripts/browser-check.mjs`, which loads every page in Chrome under the
site's content security policy and fails on any console error.

## Layout

| Path | Holds |
| --- | --- |
| `content/*.md` | The wording of each page; the docstring of `scripts/render_airline.py` describes the format |
| `content/chat.json`, `content/one-id.json` | The wording of the chat and of the One ID screens |
| `assets/` | The stylesheet and the design system in `assets/design/`, shared by the static pages and the app, and the static pages' script |
| `model/` | `facts.json` and `model.json` from verified-air, committed; `model/one-id/` from verified-id |
| `web/` | The Angular app: the header and footer, the page component that shows the renderer's pages, the One ID screens in `src/app/one-id/`, the browser check |
| `infra/` | The `VerifiedAirline` CDK stack (Python): the site at air.dengler.io and its publish role |
| `scripts/render_airline.py` | The pages and their checks, written to `build/`, and with `--content` for the app |
| `scripts/update-model.sh` | Copies new model files into `model/`, and with `--one-id` into `model/one-id/` |
| `scripts/check_one_id.py` | Checks the One ID screens against a build of the One ID model |
| `scripts/test_render_one_id.py` | Shows each of the renderer's checks of `content/one-id.json` failing |
| `scripts/preview.sh` | Renders the static pages and serves them at <http://localhost:8001> |
| `scripts/deploy.sh` | Builds the app, deploys the stack and publishes the site |
| `scripts/publish-site.sh` | Uploads the app's build and invalidates CloudFront; CI runs it on a push to `main` |
| `scripts/redirect_pages.py` | github.io's pages, each a redirect to the same page at air.dengler.io |
| `scripts/export_chat.py` | The support chat's knowledge base documents, from the model's files and the rendered pages |
| `chat/` | The support chat's agent (`airline_agent/`), its container, and its scripts |

## Building locally

The renderer needs Python 3.12 and nothing else. The app needs Node 24.15 or
later, which Angular CLI 22 requires. The stack needs uv and AWS credentials
for the account that holds the dengler.io zone.

```sh
scripts/preview.sh                                          # the static pages, http://localhost:8001
npm --prefix web start                                      # the app, http://localhost:4200
npm --prefix web test                                       # the app's unit tests
npm --prefix web run build && npm --prefix web run check    # the build, checked in Chrome
(cd infra && uv run --dev pytest -q)                        # the stack's tests
scripts/update-model.sh                                     # the newest model from verified-air's site
scripts/update-model.sh ../verified-air/build/airline-data  # or from a local build of verified-air
scripts/update-model.sh --one-id                            # the One ID model, from ../verified-id/build/one-id-data
python3 scripts/check_one_id.py                             # the One ID checks, with the vectors
```

## Hosting

`scripts/deploy.sh` builds the app, deploys the `VerifiedAirline` stack to
us-east-1, and publishes the site. The stack serves the app's build from a
private S3 bucket through CloudFront at air.dengler.io, as guppi-gpt serves
chat.dengler.io. A CloudFront Function serves each page from its prerendered
`index.html`; a path with no page gets the app's shell, which shows its
not-found page, with status 404.

The content security policy is `infra/csp.txt` with the hash of each inline
script in the build, so it allows no other inline script and no inline style,
and every font is served from the site. Because the hashes come from the
build, a change to an inline script needs `scripts/deploy.sh`;
`scripts/publish-site.sh` refuses a build whose scripts the live policy lacks.

On a push to `main`, CI publishes the site with the stack's publish role,
which may only write to the site bucket and invalidate its distribution. The
job runs once the repository variable `AWS_PUBLISH_ROLE_ARN` holds the stack's
`PublishRoleArn` output.

## Support chat

The support chat is being built in steps; the design is the Claude Doc
"Verified Airline support chat: design". Its backend is the
`VerifiedAirlineChat` stack in `infra/`. Nothing in it is typed by hand from
the model:

- verified-air writes an Amazon Bedrock Automated Reasoning policy for fares
  and refunds from its model, with each rule's Lean rule, requirements and
  theorems, and right and wrong answers for every rule;
  `scripts/update-model.sh` copies them into `model/`.
  `scripts/export_chat.py` writes the knowledge base's documents into
  `build/chat/kb/`.
- The stack loads the policy as JSON, versions it, and attaches it to a
  guardrail. It also holds a Bedrock managed knowledge base, a tools gateway
  that exposes its Retrieve as an MCP tool, and the airline agent on AgentCore
  Runtime, which answers from the knowledge base and, in verified mode, sends
  its answer through the guardrail. The agent wraps Retrieve in a search tool
  that takes plain text: given Retrieve's own schema, the model sent the query
  as a bare string on every turn's first call, and Retrieve refused it.
- A chat runs on the stack's Amazon Connect instance. The Rust chat start in
  `chat/chat_start/` gets a Cognito client-credentials token and starts the
  contact with the mode and the token as attributes. The contact flow hands
  the chat to the Agentic CX designer canvas in `chat/canvas/`, which sends
  each question to the agent through the agents gateway as an A2A
  `message/send`. The agent records each turn in a DynamoDB table for 30
  days and answers with the text the traveler is shown.

```sh
python3 scripts/export_chat.py                   # the knowledge base's documents
(cd infra && npx aws-cdk@2 deploy VerifiedAirlineChat)
(cd chat && uv run scripts/sync_kb.py)           # upload the documents and ingest them
(cd chat && uv run scripts/check_policy.py --rounds 3)   # right and wrong answers through the guardrail
(cd chat && uv run scripts/policy_tests.py)      # the same answers as the policy's own tests, run in Bedrock
(cd chat && uv run scripts/ask.py --rounds 2)    # the question set, through the agent
(cd chat && uv run python -m airline_agent.cli "What does a Main change cost?")
(cd chat/canvas && npm ci && node deploy.js)    # the canvas, built and deployed in the designer
(cd chat && uv run scripts/contact_flow.py)      # the contact flow that hands a chat to the canvas
(cd chat && uv run scripts/chat.py --mode verified "My Main flight left without me. What can I get back if I cancel?")
```

The widget is the Ask about fares button in the site's header. On
air.dengler.io, CloudFront sends `/api/chat/start` to the chat start and
`/api/chat/turns/*` to the read of a chat's turn records, through function
URLs only the distribution can call; a WAF rule blocks an address after 20
chat starts in five minutes. A $100 monthly budget on the whole account emails
samdengler@gmail.com at 80% and 100% of actual spend and when the forecast
passes it. Deploy the chat stack before the site stack, which finds the two
functions by name. Under `npm start` a local server stands in for the chat's
API with your AWS credentials:

```sh
eval "$(aws configure export-credentials --format env)"
(cd chat && uv run scripts/dev_api.py)           # /api/chat/start and /api/chat/turns on 127.0.0.1:8790
npm --prefix web start                           # http://localhost:4200, which proxies /api there
```

Its wording is in `content/chat.json`, which the renderer checks as it checks
the pages. A verified reply carries a ∀ Verified mark that opens its answer
certificate: what the check took as given, what it read the answer as saying,
the rules it applied with their Lean rules and criteria, and the policy,
guardrail and verified-air versions. Compare shows the draft beside what the
traveler was shown. New chat in the panel's header ends the chat and starts an
empty one; switching Verified answers does the same, since a chat's mode is
fixed when it starts.

The canvas deploy reads the designer's API key from
`~/.config/verified-airline/acxd_api_key`. The key, the designer's workspace
and the Connect admin user were made by hand once.

The withheld, verified and not-checked states follow the bar the design doc
proposes for review. A draft the check contradicts is withheld, and the reply
says what the fares say instead. A draft is shown as verified only when every
finding is VALID with a rule and nothing in it went untranslated.

## One ID

The check-in, wallet and gate screens are built on a second model:
verified-id, IATA's One ID Technical Implementation Guide in Lean. Its design is
the Claude Doc "One ID on Verified Airline: implementation plan". This work stays
on `main` and is published with the rest of the site, by Sam's decision of 5
November 2026, although verified-id itself stays private. The files in
`model/one-id/` hold wording of our own, section numbers, identifiers and five short
quoted phrases of the guide, the longest eight words.

`scripts/update-model.sh --one-id` copies four files from a local build,
`../verified-id/build/one-id-data/`, into `model/one-id/`:

- `model.json`: every requirement with its criteria and their statuses, the open
  questions, and the identifiers of document types, namespaces and data elements.
- `scenarios.json`: the specimen travelers, one of them the default trip.
- `readings.json`: every point the guide leaves undecided, with its settings.
- `decisions.jsonl`: the model's answer for each scenario, check and setting.
- `presentation/`: the same three files for the presentation rules of §4.2: how a
  wallet answers a request, and what a relying party checks.

### The checks in TypeScript

`web/src/app/one-id/rules/` holds one file per check, in the order of the plan's
table. Each mirrors a Lean function, takes its reading as a parameter, and names
its requirement and Lean function in a comment. `support/answer.ts` puts them
behind the oracle's request format, so a line of `decisions.jsonl` runs through
them as it stands.

| Check | Runs in | Fails when |
| --- | --- | --- |
| `rules/conformance.spec.ts` | `npm test` | Any line of `decisions.jsonl` gets a different answer from the TypeScript |
| `rules/properties.spec.ts`, `rules/presentation-properties.spec.ts` | `npm test` | A proven theorem, restated with fast-check and tagged with its criterion, fails on a generated input, or a proven criterion has no property |
| `rules/traceability.spec.ts` | `npm test` | A check names no requirement, one the model lacks, or another Lean name for it; or the reading points differ from `readings.json` |
| `scripts/check_one_id.py` | `npm run content`, `scripts/update-model.sh --one-id`, verified-id's `scripts/check-airline.sh` | The same comments and reading points, and with `--model` the vectors of any build through `web/scripts/one-id-vectors.mjs` |

A pass of the vectors means the TypeScript is right on those cases. A pass of the
properties means it held on every input tried. Neither is a proof; the proofs are
about the Lean model.

No check is outside the model: `check_one_id.py` fails on one that names no
requirement of it, and a requirement of the model with no check fails
`rules/traceability.spec.ts`.

### The design system

Verified Airline has a design system of its own, extracted from its website and shared
with the gate reader. It has nothing to do with any other project's.

| File | Holds |
| --- | --- |
| `assets/design/tokens.css` | Colors, in light and dark, type and shapes |
| `assets/design/markers.css` | The Lean model's markers, popovers and status badges |
| `assets/design/components.css` | Cards, rows, buttons, labels and the result banner |

Components take their look from the tokens and type no color, so a surface with its own
look sets its own values. The website and the gate reader use the airline's. The gate
reader has its own header for staff, with the airline's brand and no site navigation,
chat or footer. The demo wallet stands in for another company's app, so it sets neutral
colors and the system's fonts in `.surface-wallet`, and shows no sign of the airline's
brand. The colors of the Lean model's markers mean the same everywhere, so a theme
leaves them alone.

### The three screens

`/check-in` is the airline's website, `/wallet` the traveler's wallet and `/gate`
the gate agent's reader. They are Angular components in `web/src/app/one-id/`,
since the flows need state, and every page is still prerendered. The words are in
`content/one-id.json`. `render_airline.py` checks them as it checks
`content/chat.json`: no rule, theorem or criterion and no requirement ID under
`traveler`; under `lean`, each cited requirement and criterion must be in the
model, and wording that calls a point still being decided must cite criteria that
are still open. `scripts/test_render_one_id.py` shows each of these failing.

The screens talk through a BroadcastChannel, so a laptop can show the three side by
side in one browser. Only the step, the traveler and the decisions travel. A new tab
says hello, and a tab further along answers with where the trip stands. The website
opens the wallet and the wallet opens the gate reader, each in a tab of its own.

With the model hidden, the trip is the scenario `scenarios.json` marks as the
default, whose result the build checks is the same under every reading. With it
shown, the existing Lean model button adds ∀ markers fed from `model.json`, the
identifiers, and at the gate the checks that ran. A marker is blue when every
criterion behind it is proven, amber when one is open, and grey for a step the
model does not cover. Popovers show no link, because verified-id's review document
has no public address yet.

Beside each computed result at the gate is the model's answer for that traveler and
those settings, read from `public/one-id-decisions.json`, which `npm run content`
writes from `decisions.jsonl`. The app loads it only with the model shown.

The default trip runs on the model's presentation rules. The website's request is
the default OpenID4VP presentation narrowed to the photoid, since the boarding pass
is issued after it. The gate's is the default proximity presentation, and a test
holds it equal to the model's. The wallet checks who is asking (OID-204), its consent
sheets list what `Wallet.respond` would send (OID-201), and the relying party decides
with `refusals` and `pairRefusals` (OID-202, OID-207). With the model shown, each of
these carries the marker of its requirement.

One step is ordinary code, with a grey marker: combining the result for a pair with
the checks of each credential's content into "Board" or "Refer to agent". A contactless
touchpoint needs both credentials, so a traveler holding one is never boarded: the gate
shows a "Credential check" with the result for that credential alone. The panel also
offers the model's 21 presentations, such as a replayed response or two travelers on
one phone. Each shows the relying party's answer under the same rules.

### Where a trip stops

With the model shown, a trip that rests on an undecided point stops at it. The gate
says "Needs a decision" with the open question, and nothing goes on until someone
decides. A point is undecided until someone chooses: every switch starts that way,
so the site chooses nothing for the business.

`one-id/decide.ts` works out where a trip stands, with nothing typed by hand. It
tries each check under every setting of the undecided points it reads. A trip stops
at a point that changes the result, and at a point whose open question names the
traveler as a worked example, a link `scenarios.json` and `readings.json` make. The
second case matters: two travelers named John Smith board under every setting, and
the credentials are about two different people. The default trip links to no open
question and every reading accepts it, so it never stops, and a test holds that
under any decisions. With the model hidden, the trip is always the default trip.

At a stop, each setting shows what it leads to for this traveler. A table shows what
each setting does to the travelers it changes, marked wrong where the result
contradicts who the credentials are about, which the scenarios record and a reader
cannot see. These travelers are examples written by hand, so the table shows kinds
of error and no rates. "None of these" keeps the trip stopped, since the model says
its settings are not the only ones. Decisions so far appear on the panel, reach every
tab, and can be undone. A list under the table names what the choice touches outside
the model; `render_airline.py` stops the build when a list names a point the model no
longer has.

`web/scripts/browser-check.mjs` runs the trip from check-in to "Board" in three
tabs under the site's content security policy, with the model hidden and with it
shown, and fails on any console error or on a banned word in the visible text.

### The presenter panel

`/gate` has a panel for whoever presents the demo, shown only with the model. Its
pickers come from the two `scenarios.json` files, so a scenario the model adds appears
with no code. It has one switch per entry of the two `readings.json` files, which share
one point, each with its settings
and its open question. Every switch starts undecided, and the setting that is the
guide as written is marked where the model names one. A switch that would change the current traveler's outcome says so.
"What the reader cannot see" compares who each credential is about, which the issuer
knows and a relying party does not, with what the gate decided.

`rules/support/readings.ts` lists the points the TypeScript reads, and
`one-id/presenter.spec.ts` fails if the panel and those files disagree on a switch, a
setting or a question. The same spec shows that test failing on a reading
added, a reading removed and a setting changed. The browser check runs each traveler
that holds both credentials under both matching settings, and every scenario under
the panel's settings, against the model's answers.

### The seeded error

To confirm the vectors catch a wrong check, on 5 November 2026 the comparison in
`rules/expired.ts` was changed from "after" to "at or after" under the reading that
a credential is valid at the end of its validity. `npm test` then failed 3 of 682
tests, and passed all 682 once the change was reverted:

- The vector `end-of-validity expired boardingPass ExpiryReading.validAtEnd=true`:
  the model answers false, and the seeded code answered true.
- The vector `boundary expired boardingPass at the end of validity
  ExpiryReading.validAtEnd=true`: the same.
- The property `valid_at_validUntil_of_validAtEnd`.

A second seeded error tested the presentation rules: `rules/refusals.ts` was changed
so the OpenID4VP profile no longer compares a response's session transcript with the
request. `npm test` then failed 18 of 1,678 tests, 16 vectors of `replay-openid4vp`
and 2 properties, and passed all 1,678 once the change was reverted.

## Planned

The support chat's widget on Amazon Connect, then a booking flow and a bookings API. On
the site, only what the model computes counts as checked: amounts from
`facts.json`, statuses from `model.json`, and later the Rust rules that
verified-air proves equal to the model. Anything else the chat or the flow
shows is unproved and is labelled that way.

## Decisions

1. **The site has its own repository.** Until 30 October 2026 the pages were
   served at `/airline/` on verified-air's site (decisions 45 and 49 in its
   README). A booking flow and a support widget need a JavaScript toolchain,
   and the widget needs a server; neither belongs in the CI of a Lean
   repository. The fares stay in verified-air, since they are values of the
   model's types and need Lean to evaluate. The model's files are copied here
   and committed, so the site's version of the model is pinned and each
   update shows as a diff. The old addresses under `verified-air/airline/`
   send readers to the same pages here.
2. **The site is an Angular app on AWS at air.dengler.io.** The booking
   flow, sign-in and a support chat that stays open from page to page need
   one app, and the chat and the bookings API need AWS. The site has its own
   stack. It is not a project on chat.dengler.io, whose page is a chat for
   signed-in members; it copies that stack's hosting instead. Angular because
   it is the framework most used at work.
3. **Every page is rendered when the site is built.** The amounts and
   statuses are fixed by the model's files, so nothing about a page needs
   computing when it is read. The pages load as HTML and read with scripts
   off, as the static pages did.
4. **The renderer still writes every page.** `render_airline.py` stays on
   Python's standard library, since verified-air's CI runs it, and keeps all
   its checks. The app shows the HTML it writes as it stands, past Angular's
   sanitizer, which would remove the markers' buttons and the sections' ids.
   That HTML is built from this repository's files when the site is built.
   Traveler-facing wording stays in `content/`.
5. **The CDK stack is in Python and deploys from a laptop.**
   `scripts/deploy.sh` follows guppi-gpt's. CI publishes only the site, with
   a role that cannot change the stack.
6. **Inline scripts are allowed by hash.** Angular's automatic policy cannot
   be used with prerendered pages, so the stack hashes the build's inline
   scripts: the one that sets the theme and the Lean model before the page
   draws, and Angular's two for replaying clicks made before the app starts.
   Critical CSS is not inlined, and the fonts come from `@fontsource`, so
   styles and fonts load only from the site.
7. **github.io redirects to air.dengler.io.** GitHub Pages serves one page
   per old address, each sending the reader to the same page at
   air.dengler.io with its query, such as `?lean=1`, and its anchor; any other
   address under the project site goes to the same path there. The static
   pages in `build/` are no longer published; the renderer still writes them
   for its checks and for `scripts/preview.sh`.
8. **The Automated Reasoning policy is generated.** Bedrock accepts a policy
   definition as JSON, so `scripts/export_chat.py` writes it from
   `facts.json` and CloudFormation loads it; no LLM writes a rule. It encodes
   only what the model decides: no rule mentions a total of refunds, which is
   the open question OO-003.2. Two axioms carry what the model's types say:
   money is never negative, and every fare's price is positive.
9. **The policy's variables are kept few and apart.** Every miss in step 1
   was in the check's translation from text to variables, never in a rule.
   A variable that duplicated another, such as one for the kind of request,
   made the translating models disagree, so the policy has none.
10. **The chat stack depends on nothing outside this repository.** guppi-hr
    and guppi-gpt are reference only. The tools gateway authorizes the agent
    by IAM; the anonymous chat's identity comes from a Cognito user pool in
    this stack.
11. **The agents gateway calls the agent with its own role.** It checks the
    chat start's Cognito token, by its client and scope, and then invokes the
    runtime with GATEWAY_IAM_ROLE. guppi-hr passes the caller's token through
    to its runtimes because its agents act for a signed-in employee. An
    anonymous traveler has no identity for the agent to carry, and an IAM
    runtime still serves `chat/scripts/ask.py`.
12. **The chat's policy is written in verified-air.** Its generator moved
    there on 31 October 2026 (verified-air decision 54), so the policy is one
    of the model's files, built with the theorems it cites and copied here by
    `scripts/update-model.sh` like `facts.json`. Every rule now names a
    theorem, the general rules and the two axioms included. One rule changed
    to match its theorem: the amount due on a change is the fee plus the fare
    difference when the price paid covers the fee. `scripts/export_chat.py`
    keeps the knowledge base's documents, which need this repository's pages.
13. **Verified Airline keeps its own design system.** Its tokens and components are
    extracted from the website as it stood and shared with the gate reader, so the two
    read as one airline's. The demo wallet takes the same components under neutral
    tokens, since a real wallet comes from another party. The review game's design
    system is a separate, internal one with its own brand, and nothing is shared with it.
