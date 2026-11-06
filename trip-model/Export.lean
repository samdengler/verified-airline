import Lean
import Trip

/-!
# The site's files

`lake exe trip-export ../model/trip` writes three files from the compiled model:

* `model.json`, the requirements and their criteria.  A criterion's status comes
  from the axioms of the theorem it names, so nobody can mark one proven by hand.
* `route.json`, the stops the trip map draws.
* `decisions.jsonl`, the model's answer for every step and action, and every input
  to the gate.  The inputs are finite, so a table with every one of them leaves
  nothing out, and the site's tests hold its TypeScript to the table.

It exits nonzero if a theorem depends on `sorry`.  The files carry no commit or
date, so CI can compare them with the committed ones.
-/

open Lean Trip

namespace Export

structure Criterion where
  id : String
  ears : String
  proof : Name

structure Requirement where
  id : String
  lean : Name
  ears : String
  criteria : List Criterion

/-- Our own statements of what the trip guarantees, each tied to the theorem behind it. -/
def requirements : List Requirement :=
  [ { id := "TRIP-001", lean := ``Trip.next
      ears := "THE SYSTEM SHALL move a trip only by the steps of its route."
      criteria :=
        [ ⟨"TRIP-001.1", "THE SYSTEM SHALL let a trip reach the gate by following the route's stops in order.", ``Trip.route_reaches_the_gate⟩
        , ⟨"TRIP-001.2", "WHEN a traveler takes the action at a stop THE SYSTEM SHALL move the trip to the next stop.", ``Trip.route_moves_forward⟩
        , ⟨"TRIP-001.3", "IF a trip is short of the gate THEN THE SYSTEM SHALL offer an action that moves it on.", ``Trip.no_dead_ends⟩ ] }
  , { id := "TRIP-002", lean := ``Trip.act
      ears := "THE SYSTEM SHALL send nothing to the website or the gate until the traveler shares it in the wallet."
      criteria :=
        [ ⟨"TRIP-002.1", "IF a trip reaches the gate THEN THE SYSTEM SHALL have come from the wallet's consent sheet by its Share.", ``Trip.presented_only_after_share⟩
        , ⟨"TRIP-002.2", "IF any path of a traveler's actions reaches the gate THEN THE SYSTEM SHALL have had both of the traveler's shares on that trip.", ``Trip.reaching_gate_needs_both_shares⟩
        , ⟨"TRIP-002.3", "IF a trip is short of the gate on any path THEN THE SYSTEM SHALL have sent the gate nothing.", ``Trip.nothing_sent_to_gate_before_it⟩
        , ⟨"TRIP-002.4", "WHEN a traveler declines THE SYSTEM SHALL send nothing.", ``Trip.decline_sends_nothing⟩
        , ⟨"TRIP-002.5", "IF a trip stands at a decline of the website's request on any path THEN THE SYSTEM SHALL have sent the website nothing.", ``Trip.declined_sent_nothing⟩
        , ⟨"TRIP-002.6", "IF a trip stands at a decline at the gate on any path THEN THE SYSTEM SHALL have sent the gate nothing.", ``Trip.gate_declined_sent_nothing⟩ ] }
  , { id := "TRIP-003", lean := ``Trip.gateShows
      ears := "THE SYSTEM SHALL show a result at the gate only for a trip the traveler presented, and Board only when nothing stands against it."
      criteria :=
        [ ⟨"TRIP-003.1", "IF a trip is not presented THEN THE SYSTEM SHALL show the gate waiting.", ``Trip.gate_waits_until_presented⟩
        , ⟨"TRIP-003.2", "IF the gate shows a result on any path THEN THE SYSTEM SHALL have had the traveler's shares.", ``Trip.gate_result_needs_consent⟩
        , ⟨"TRIP-003.3", "IF a traveler holds one credential THEN THE SYSTEM SHALL NOT show Board.", ``Trip.one_credential_never_boards⟩
        , ⟨"TRIP-003.4", "IF a trip rests on an undecided point THEN THE SYSTEM SHALL show neither Board nor Refer.", ``Trip.stop_never_answers⟩
        , ⟨"TRIP-003.5", "IF the gate shows Board THEN THE SYSTEM SHALL have a presented trip, nothing undecided and no check against it.", ``Trip.board_needs_everything⟩ ] }
  , { id := "TRIP-004", lean := ``Trip.outcomeOf
      ears := "THE SYSTEM SHALL combine the results of the gate's checks into one outcome."
      criteria :=
        [ ⟨"TRIP-004.1", "IF any check failed THEN THE SYSTEM SHALL refer the traveler, and only then.", ``Trip.outcome_refer_iff⟩
        , ⟨"TRIP-004.2", "IF no check failed and a check rests on an undecided point THEN THE SYSTEM SHALL leave the outcome undecided, and only then.", ``Trip.outcome_depends_iff⟩
        , ⟨"TRIP-004.3", "IF every check passed THEN THE SYSTEM SHALL give the outcome Board, and only then.", ``Trip.outcome_board_iff⟩ ] } ]

def App.id : App → String
  | .website => "website" | .wallet => "wallet" | .gate => "gate"

def Step.id : Step → String
  | .start => "start" | .asked => "asked" | .declined => "declined" | .shared => "shared"
  | .passAdded => "passAdded" | .gateAsked => "gateAsked" | .gateDeclined => "gateDeclined"
  | .presented => "presented"

def Action.id : Action → String
  | .openWallet => "openWallet" | .share => "share" | .decline => "decline" | .addPass => "addPass"
  | .present => "present" | .shareGate => "shareGate" | .declineGate => "declineGate"
  | .startAgain => "startAgain"

def Stop.id : Stop → String
  | .openWallet => "openWallet" | .share => "share" | .addPass => "addPass"
  | .present => "present" | .shareGate => "shareGate" | .answer => "answer"

def Outcome.id : Outcome → String
  | .board => "board" | .refer => "refer" | .depends => "depends"

def CheckState.id : CheckState → String
  | .passed => "passed" | .failed => "failed" | .depends => "depends"

def Shows.id : Shows → String
  | .waiting => "waiting" | .decide => "decide"
  | .credentialAccepted => "credentialAccepted" | .credentialRefused => "credentialRefused"
  | .presentationAccepted => "presentationAccepted" | .presentationRefused => "presentationRefused"
  | .board => "board" | .refer => "refer"

def bools : List Bool := [false, true]

/-- The model's answer for every step and action. -/
def nextRows : List Json :=
  Step.all.flatMap fun s => Action.all.map fun a =>
    Json.mkObj
      [ ("kind", "next"), ("name", s!"next {Step.id s} {Action.id a}"), ("step", Step.id s), ("action", Action.id a)
      , ("to", match next s a with | some t => Json.str (Step.id t) | none => Json.null) ]

/-- The model's answer for every input to the gate. -/
def gateRows : List Json :=
  Step.all.flatMap fun step => bools.flatMap fun pr => bools.flatMap fun ph => bools.flatMap fun pa =>
    Outcome.all.flatMap fun o => bools.flatMap fun stops =>
      (none :: Outcome.all.map some).map fun p =>
        let name := s!"gate {Step.id step} presentation={pr} photoid={ph} pass={pa} {Outcome.id o} stops={stops} also={(p.map Outcome.id).getD "none"}"
        Json.mkObj
          [ ("kind", "gate"), ("name", name), ("step", Step.id step), ("presentation", toJson pr), ("photoid", toJson ph)
          , ("pass", toJson pa), ("outcome", Outcome.id o), ("stops", toJson stops)
          , ("also", match p with | some x => Json.str (Outcome.id x) | none => Json.null)
          , ("shows", Shows.id (gateShows step ⟨pr, ph, pa⟩ o stops p)) ]

/-- Every list of up to three checks: the theorems hold for any length. -/
def checkLists : List (List CheckState) :=
  let one := CheckState.all.map fun c => [c]
  let two := CheckState.all.flatMap fun a => one.map (a :: ·)
  let three := CheckState.all.flatMap fun a => two.map (a :: ·)
  [[]] ++ one ++ two ++ three

def outcomeRows : List Json :=
  checkLists.map fun cs =>
    let ids := cs.map CheckState.id
    Json.mkObj
      [ ("kind", "outcome"), ("name", s!"outcome {ids}"), ("checks", toJson ids), ("outcome", Outcome.id (outcomeOf cs)) ]

def routeJson : Json :=
  Json.mkObj
    [ ("steps", toJson (Step.all.map Step.id))
    , ("actions", toJson (Action.all.map Action.id))
    , ("stops", Json.arr (route.map fun s => Json.mkObj
        [ ("id", Stop.id s), ("app", App.id s.app)
        , ("action", match s.action with | some a => Json.str (Action.id a) | none => Json.null) ]).toArray)
    , ("stopAfter", Json.mkObj (Step.all.map fun s => (Step.id s, Json.str (Stop.id (stopAfter s))))) ]

/-- A criterion's status, from the axioms of its theorem. -/
def statusOf (n : Name) : CoreM String := do
  unless (← getEnv).contains n do throwError "the model has no theorem {n}"
  return if (← collectAxioms n).contains ``sorryAx then "open" else "proven"

def modelJson : CoreM Json := do
  let rows ← requirements.mapM fun r => do
    let criteria ← r.criteria.mapM fun c => do
      return Json.mkObj [("id", c.id), ("status", ← statusOf c.proof), ("ears", c.ears), ("theorem", c.proof.toString)]
    return (r.id, Json.mkObj
      [("name", r.lean.toString), ("ears", r.ears), ("review", Json.null), ("criteria", Json.arr criteria.toArray)])
  return Json.mkObj [("requirements", Json.mkObj rows), ("openQuestions", Json.mkObj [])]

end Export

open Export in
def main (args : List String) : IO UInt32 := do
  let some dir := args.head? | do
    IO.eprintln "usage: lake exe trip-export <directory>"
    return 2
  initSearchPath (← findSysroot)
  unsafe enableInitializersExecution
  let env ← importModules #[{ module := `Trip }] {} (loadExts := true)
  let ctx : Core.Context := { fileName := "<trip-export>", fileMap := default }
  let (model, _) ← modelJson.toIO ctx { env }
  let unproven := requirements.flatMap fun r => r.criteria.map (·.proof)
  let (open_, _) ← (unproven.filterM fun n => do return (← statusOf n) != "proven").toIO ctx { env }
  unless open_.isEmpty do
    IO.eprintln s!"trip-export: these depend on sorry: {open_}"
    return 1
  IO.FS.createDirAll dir
  IO.FS.writeFile s!"{dir}/model.json" (model.pretty ++ "\n")
  IO.FS.writeFile s!"{dir}/route.json" (routeJson.pretty ++ "\n")
  let rows := nextRows ++ gateRows ++ outcomeRows
  IO.FS.writeFile s!"{dir}/decisions.jsonl" ("\n".intercalate (rows.map Json.compress) ++ "\n")
  IO.println s!"trip-export: {requirements.length} requirements, {rows.length} decisions, in {dir}"
  return 0
