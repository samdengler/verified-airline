# Verified Airline

Verified Airline is a fictional airline. Its site answers a traveler's
questions about fares, payment, changes and cancellations, refunds, extras and
schedule changes in plain words. Every fee and refund on it is computed from
[Verified Air](https://samdengler.github.io/verified-air/), a model of the
business rules for airline offers and orders written in Lean, and a button
shows the requirement behind each answer.

- The site: <https://samdengler.github.io/verified-airline/>
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

The pages are static HTML with every popover already in the page, so they
need no data fetching and read with scripts off.

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

## Layout

| Path | Holds |
| --- | --- |
| `content/*.md` | The wording of each page; the docstring of `scripts/render_airline.py` describes the format |
| `assets/` | The stylesheet, and the script that shows and hides the Lean model |
| `model/` | `facts.json` and `model.json` from verified-air, committed |
| `scripts/render_airline.py` | The pages and their checks, written to `build/` |
| `scripts/update-model.sh` | Copies new model files into `model/` |
| `scripts/preview.sh` | Renders the pages and serves them at <http://localhost:8001> |

## Building locally

The build needs Python 3.12 and nothing else.

```sh
scripts/preview.sh                                          # http://localhost:8001
scripts/update-model.sh                                     # the newest model from verified-air's site
scripts/update-model.sh ../verified-air/build/airline-data  # or from a local build of verified-air
```

## Planned

A booking flow and a customer support widget. On the site, only what the
model computes counts as checked: amounts from `facts.json`, statuses from
`model.json`, and later the Rust rules that verified-air proves equal to the
model, compiled to WebAssembly. Anything else the flow or the widget shows is
unproved and is labelled that way.

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
