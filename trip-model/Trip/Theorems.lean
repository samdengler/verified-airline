import Trip.Model

/-!
# What is proven about the trip

The paths have no limit, since a traveler can decline and try again and can start
again at any step, so these hold by induction over every path.
-/

namespace Trip

/-! ## The site's table leaves nothing out -/

theorem Step.mem_all (s : Step) : s ∈ Step.all := by cases s <;> simp [Step.all]
theorem Action.mem_all (a : Action) : a ∈ Action.all := by cases a <;> simp [Action.all]
theorem Outcome.mem_all (o : Outcome) : o ∈ Outcome.all := by cases o <;> simp [Outcome.all]

/-! ## Consent -/

/-- What has been sent follows from the step, on every trip. -/
def Consistent (s : State) : Prop :=
  match s.step with
  | .start | .asked | .declined => s.sentToWebsite = false ∧ s.sentToGate = false
  | .shared | .passAdded | .gateAsked | .gateDeclined => s.sentToWebsite = true ∧ s.sentToGate = false
  | .presented => s.sentToWebsite = true ∧ s.sentToGate = true

theorem consistent_initial : Consistent initial := by simp [Consistent, initial]

theorem act_consistent {s t : State} {a : Action} (h : Consistent s) (e : act s a = some t) :
    Consistent t := by
  obtain ⟨step, w, g⟩ := s
  cases step <;> cases a <;> simp [act, next] at e <;> subst e <;> simp_all [Consistent]

theorem run_consistent {s t : State} {path : List Action} (h : Consistent s)
    (e : run s path = some t) : Consistent t := by
  induction path generalizing s with
  | nil => simp [run] at e; subst e; exact h
  | cons a rest ih =>
    simp only [run] at e
    cases hact : act s a with
    | none => simp [hact] at e
    | some u =>
      simp [hact] at e
      exact ih (act_consistent h hact) e

/-- Every trip that follows a path of a traveler's actions from the start. -/
theorem reached_consistent {t : State} {path : List Action} (e : run initial path = some t) :
    Consistent t := run_consistent consistent_initial e

/-- A trip reaches the gate only from the wallet's consent sheet, by its Share. -/
theorem presented_only_after_share {s : Step} {a : Action} :
    next s a = some .presented ↔ s = .gateAsked ∧ a = .shareGate := by
  cases s <;> cases a <;> simp [next]

/-- On every path, a trip at the gate has had both of the traveler's shares. -/
theorem reaching_gate_needs_both_shares {t : State} {path : List Action}
    (e : run initial path = some t) (h : t.step = .presented) :
    t.sentToWebsite = true ∧ t.sentToGate = true := by
  have c := reached_consistent e
  simp only [Consistent, h] at c
  exact c

/-- Nothing is sent to the gate at any step short of it, on every path. -/
theorem nothing_sent_to_gate_before_it {t : State} {path : List Action}
    (e : run initial path = some t) (h : t.step ≠ .presented) : t.sentToGate = false := by
  have c := reached_consistent e
  obtain ⟨step, w, g⟩ := t
  cases step <;> simp_all [Consistent]

/-- Declining sends nothing, at the website's request or the gate's. -/
theorem decline_sends_nothing {s t : State} {a : Action} (ha : a = .decline ∨ a = .declineGate)
    (e : act s a = some t) : t.sentToWebsite = s.sentToWebsite ∧ t.sentToGate = s.sentToGate := by
  obtain ⟨step, w, g⟩ := s
  rcases ha with rfl | rfl <;> cases step <;> simp [act, next] at e <;> subst e <;> simp

/-- A trip that declined the website's request has sent it nothing, on every path. -/
theorem declined_sent_nothing {t : State} {path : List Action}
    (e : run initial path = some t) (h : t.step = .declined) : t.sentToWebsite = false := by
  have c := reached_consistent e
  simp only [Consistent, h] at c
  exact c.1

/-- A trip that declined at the gate has sent the gate nothing, on every path. -/
theorem gate_declined_sent_nothing {t : State} {path : List Action}
    (e : run initial path = some t) (h : t.step = .gateDeclined) : t.sentToGate = false := by
  have c := reached_consistent e
  simp only [Consistent, h] at c
  exact c.2

/-! ## The gate -/

/-- The gate shows nothing about a traveler until the trip is presented. -/
theorem gate_waits_until_presented {step : Step} (h : step ≠ .presented) (subject : Subject)
    (outcome : Outcome) (stops : Bool) (presentation : Option Outcome) :
    gateShows step subject outcome stops presentation = .waiting := by
  simp [gateShows, h]

/-- On every path, a result at the gate means the traveler shared with it. -/
theorem gate_result_needs_consent {t : State} {path : List Action} {subject : Subject}
    {outcome : Outcome} {stops : Bool} {presentation : Option Outcome}
    (e : run initial path = some t)
    (h : gateShows t.step subject outcome stops presentation ≠ .waiting) :
    t.sentToWebsite = true ∧ t.sentToGate = true := by
  by_cases hs : t.step = .presented
  · exact reaching_gate_needs_both_shares e hs
  · exact absurd (gate_waits_until_presented hs subject outcome stops presentation) h

/-- Board needs the trip presented, nothing undecided, no check against it, and both credentials. -/
theorem board_needs_everything {step : Step} {subject : Subject} {outcome : Outcome} {stops : Bool}
    {presentation : Option Outcome}
    (h : gateShows step subject outcome stops presentation = .board) :
    step = .presented ∧ stops = false ∧ outcome = .board ∧
      (presentation = none ∨ presentation = some .board) ∧
      subject.presentation = false ∧ subject.photoid = true ∧ subject.pass = true := by
  by_cases hs : step = .presented
  · subst hs
    obtain ⟨pr, ph, pa⟩ := subject
    rcases presentation with _ | (_ | _ | _) <;> cases pr <;> cases ph <;> cases pa <;>
      cases stops <;> cases outcome <;> revert h <;> decide
  · rw [gate_waits_until_presented hs] at h; cases h

/-- One credential never boards. -/
theorem one_credential_never_boards {step : Step} {subject : Subject} {outcome : Outcome}
    {stops : Bool} {presentation : Option Outcome}
    (h : gateShows step subject outcome stops presentation = .board) :
    subject.presentation = false ∧ subject.photoid = true ∧ subject.pass = true :=
  let ⟨_, _, _, _, r⟩ := board_needs_everything h
  r

/-- A stop never shows an answer: nothing undecided gets Board or Refer. -/
theorem stop_never_answers {step : Step} {subject : Subject} {outcome : Outcome} {stops : Bool}
    {presentation : Option Outcome}
    (h : stops = true ∨ outcome = .depends ∨ presentation = some .depends) :
    gateShows step subject outcome stops presentation = .waiting ∨
      gateShows step subject outcome stops presentation = .decide := by
  by_cases hs : step = .presented
  · right; simp [gateShows, hs, h]
  · left; exact gate_waits_until_presented hs subject outcome stops presentation

/-! ## The checks' outcome -/

/-- Any failed check refers, and nothing else does. -/
theorem outcome_refer_iff (checks : List CheckState) :
    outcomeOf checks = .refer ↔ CheckState.failed ∈ checks := by
  unfold outcomeOf
  by_cases hf : CheckState.failed ∈ checks
  · simp [hf]
  · by_cases hd : CheckState.depends ∈ checks <;> simp [hf, hd]

/-- An undecided check leaves the outcome undecided, unless a check has failed. -/
theorem outcome_depends_iff (checks : List CheckState) :
    outcomeOf checks = .depends ↔ CheckState.failed ∉ checks ∧ CheckState.depends ∈ checks := by
  unfold outcomeOf
  by_cases hf : CheckState.failed ∈ checks
  · simp [hf]
  · by_cases hd : CheckState.depends ∈ checks <;> simp [hf, hd]

/-- The outcome is Board only when every check passed. -/
theorem outcome_board_iff (checks : List CheckState) :
    outcomeOf checks = .board ↔ ∀ c ∈ checks, c = .passed := by
  constructor
  · intro h c hc
    cases c with
    | passed => rfl
    | failed =>
      have r := (outcome_refer_iff checks).2 hc
      rw [h] at r; cases r
    | depends =>
      by_cases hf : CheckState.failed ∈ checks
      · have r := (outcome_refer_iff checks).2 hf
        rw [h] at r; cases r
      · have r := (outcome_depends_iff checks).2 ⟨hf, hc⟩
        rw [h] at r; cases r
  · intro h
    have hf : CheckState.failed ∉ checks := fun m => by have := h _ m; cases this
    have hd : CheckState.depends ∉ checks := fun m => by have := h _ m; cases this
    simp [outcomeOf, hf, hd]

/-! ## The route -/

/-- Following the route's stops from the start reaches the gate. -/
theorem route_reaches_the_gate :
    run initial [.openWallet, .share, .addPass, .present, .shareGate] =
      some ⟨.presented, true, true⟩ := rfl

/-- The stops the route lists are the stops in their places. -/
theorem route_in_order : route.map Stop.index = [0, 1, 2, 3, 4, 5] := rfl

/-- Short of the gate, a trip's stop has an action that is allowed at its step. -/
theorem no_dead_ends (s : Step) (h : s ≠ .presented) :
    ∃ a t, (stopAfter s).action = some a ∧ next s a = some t := by
  cases s <;> simp_all [stopAfter, Stop.action, next]

/-- Taking a stop's action moves the trip to the next stop. -/
theorem route_moves_forward {s t : Step} {a : Action} (ha : (stopAfter s).action = some a)
    (e : next s a = some t) : (stopAfter t).index = (stopAfter s).index + 1 := by
  cases s <;> simp [stopAfter, Stop.action] at ha <;> subst ha <;> simp [next] at e <;> subst e <;> rfl

end Trip
