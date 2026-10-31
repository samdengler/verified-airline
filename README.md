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
| `assets/` | The stylesheet, shared by the static pages and the app, and the static pages' script |
| `model/` | `facts.json` and `model.json` from verified-air, committed |
| `web/` | The Angular app: the header and footer, the page component that shows the renderer's pages, the browser check |
| `infra/` | The `VerifiedAirline` CDK stack (Python): the site at air.dengler.io and its publish role |
| `scripts/render_airline.py` | The pages and their checks, written to `build/`, and with `--content` for the app |
| `scripts/update-model.sh` | Copies new model files into `model/` |
| `scripts/preview.sh` | Renders the static pages and serves them at <http://localhost:8001> |
| `scripts/deploy.sh` | Builds the app, deploys the stack and publishes the site |
| `scripts/publish-site.sh` | Uploads the app's build and invalidates CloudFront; CI runs it on a push to `main` |
| `scripts/redirect_pages.py` | github.io's pages, each a redirect to the same page at air.dengler.io |
| `scripts/export_chat.py` | The support chat's files from the model's: the Automated Reasoning policy, its checks, the knowledge base's documents |
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

- `scripts/export_chat.py` writes, into `build/chat/`, an Amazon Bedrock
  Automated Reasoning policy for fares and refunds, generated from
  `facts.json`, with each rule's Lean rule and requirements; right and wrong
  answers for every rule; and the knowledge base's documents.
- The stack loads the policy as JSON, versions it, and attaches it to a
  guardrail. It also holds a Bedrock managed knowledge base, a tools gateway
  that exposes its Retrieve as an MCP tool, and the airline agent on AgentCore
  Runtime, which answers from the knowledge base and, in verified mode, sends
  its answer through the guardrail.
- A chat runs on the stack's Amazon Connect instance. The Rust chat start in
  `chat/chat_start/` gets a Cognito client-credentials token and starts the
  contact with the mode and the token as attributes. The contact flow hands
  the chat to the Agentic CX designer canvas in `chat/canvas/`, which sends
  each question to the agent through the agents gateway as an A2A
  `message/send`. The agent records each turn in a DynamoDB table for 30
  days and answers with the text the traveler is shown.

```sh
python3 scripts/export_chat.py                   # the policy, its checks, the documents
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
traveler was shown.

The canvas deploy reads the designer's API key from
`~/.config/verified-airline/acxd_api_key`. The key, the designer's workspace
and the Connect admin user were made by hand once.

The withheld, verified and not-checked states follow the bar the design doc
proposes for review. A draft the check contradicts is withheld, and the reply
says what the fares say instead. A draft is shown as verified only when every
finding is VALID with a rule and nothing in it went untranslated.

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
