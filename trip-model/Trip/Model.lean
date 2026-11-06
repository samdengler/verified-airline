/-!
# The trip

Check-in and boarding move between three apps: the airline's website, the wallet
and the gate reader.  verified-id proves what the wallet may send.  This model is
about the order: which step can follow which, what has been sent at each, and what
the gate may show for any result of the checks.

The checks themselves are verified-id's, so here a check's result is an input.  The
model holds no cryptography and no network, and in one browser no credential
travels: `sentToWebsite` and `sentToGate` say what a real wallet would have sent.
-/

namespace Trip

/-- The three apps a trip moves between. -/
inductive App where
  | website | wallet | gate
  deriving DecidableEq, Repr

/-- How far a trip has gone. -/
inductive Step where
  | start | asked | declined | shared | passAdded | gateAsked | gateDeclined | presented
  deriving DecidableEq, Repr

/-- What a traveler can do.  The presenter's picks are not here: they are no part of
a traveler's trip, and they show only with the model. -/
inductive Action where
  | openWallet | share | decline | addPass | present | shareGate | declineGate | startAgain
  deriving DecidableEq, Repr

/-- The step an action leads to, or `none` when the action is not allowed at a step. -/
def next : Step → Action → Option Step
  | _, .startAgain => some .start
  | .start, .openWallet => some .asked
  | .declined, .openWallet => some .asked
  | .asked, .share => some .shared
  | .asked, .decline => some .declined
  | .shared, .addPass => some .passAdded
  | .passAdded, .present => some .gateAsked
  | .gateDeclined, .present => some .gateAsked
  | .gateAsked, .shareGate => some .presented
  | .gateAsked, .declineGate => some .gateDeclined
  | _, _ => none

/-- A trip: its step, and what the traveler has sent on this trip. -/
structure State where
  step : Step
  sentToWebsite : Bool
  sentToGate : Bool
  deriving DecidableEq, Repr

/-- A trip before anything has happened. -/
def initial : State := ⟨.start, false, false⟩

/-- One action.  Only the two shares send anything, and starting again begins a new trip. -/
def act (s : State) (a : Action) : Option State :=
  (next s.step a).map fun step =>
    match a with
    | .share => { s with step, sentToWebsite := true }
    | .shareGate => { s with step, sentToGate := true }
    | .startAgain => ⟨step, false, false⟩
    | _ => { s with step }

/-- A path of actions, which stops at the first one not allowed. -/
def run (s : State) : List Action → Option State
  | [] => some s
  | a :: rest => (act s a).bind fun t => run t rest

/-! ## The gate -/

/-- A check's result, under every setting of the undecided points it reads. -/
inductive CheckState where
  | passed | failed | depends
  deriving DecidableEq, Repr

/-- What the gate's checks come to. -/
inductive Outcome where
  | board | refer | depends
  deriving DecidableEq, Repr

/-- The checks' results as one outcome: any failure refers, and otherwise anything
undecided leaves the outcome undecided. -/
def outcomeOf (checks : List CheckState) : Outcome :=
  if checks.contains .failed then .refer
  else if checks.contains .depends then .depends
  else .board

/-- What the gate is asked about: one presentation, or a traveler's credentials. -/
structure Subject where
  presentation : Bool
  photoid : Bool
  pass : Bool
  deriving DecidableEq, Repr

/-- A pair can be boarded.  One credential only gets a result for itself. -/
inductive Kind where
  | pair | credential | presentation
  deriving DecidableEq, Repr

def kindOf (s : Subject) : Kind :=
  if s.presentation then .presentation
  else if s.photoid && s.pass then .pair
  else .credential

/-- What the gate reader shows. -/
inductive Shows where
  | waiting | decide
  | credentialAccepted | credentialRefused
  | presentationAccepted | presentationRefused
  | board | refer
  deriving DecidableEq, Repr

/-- What the gate shows, for any result of the checks.  `stops` says whether the trip
rests on an undecided point, and `presentation` is the outcome of the presentation
the default trip also makes at the gate. -/
def gateShows (step : Step) (subject : Subject) (outcome : Outcome) (stops : Bool)
    (presentation : Option Outcome) : Shows :=
  if step ≠ .presented then .waiting
  else if stops = true ∨ outcome = .depends ∨ presentation = some .depends then .decide
  else match kindOf subject with
    | .credential => if outcome = .board then .credentialAccepted else .credentialRefused
    | .presentation => if outcome = .board then .presentationAccepted else .presentationRefused
    | .pair => if outcome = .board ∧ presentation ≠ some .refer then .board else .refer

/-! ## The route the trip map draws -/

/-- The stops of the route, in order. -/
inductive Stop where
  | openWallet | share | addPass | present | shareGate | answer
  deriving DecidableEq, Repr

/-- The route, in order. -/
def route : List Stop := [.openWallet, .share, .addPass, .present, .shareGate, .answer]

/-- The app each stop happens in. -/
def Stop.app : Stop → App
  | .openWallet | .addPass => .website
  | .share | .present | .shareGate => .wallet
  | .answer => .gate

/-- The action that moves a trip on from a stop.  The last stop has none. -/
def Stop.action : Stop → Option Action
  | .openWallet => some .openWallet
  | .share => some .share
  | .addPass => some .addPass
  | .present => some .present
  | .shareGate => some .shareGate
  | .answer => none

/-- The stop a trip waits at after a step.  A decline goes back to the stop before the wallet asked. -/
def stopAfter : Step → Stop
  | .start | .declined => .openWallet
  | .asked => .share
  | .shared => .addPass
  | .passAdded | .gateDeclined => .present
  | .gateAsked => .shareGate
  | .presented => .answer

/-- A stop's place in the route. -/
def Stop.index : Stop → Nat
  | .openWallet => 0
  | .share => 1
  | .addPass => 2
  | .present => 3
  | .shareGate => 4
  | .answer => 5

/-! ## Every value, for the site's table -/

def Step.all : List Step :=
  [.start, .asked, .declined, .shared, .passAdded, .gateAsked, .gateDeclined, .presented]

def Action.all : List Action :=
  [.openWallet, .share, .decline, .addPass, .present, .shareGate, .declineGate, .startAgain]

def Outcome.all : List Outcome := [.board, .refer, .depends]

def CheckState.all : List CheckState := [.passed, .failed, .depends]

end Trip
