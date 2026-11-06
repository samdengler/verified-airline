title: Where are you headed?
kind: home
lede: Plain answers about fares, payment, changes and refunds. Each one is written from the same model our booking systems are checked against.
---

## Three tours of this site {#tours}

Verified Airline is a demonstration. Pick a tour to see it working.

```tours
Check in and board | Run one trip across the airline's website, a wallet and the gate reader. A map shows where you are at each step. | /check-in?lean=0&traveler=default-trip
Stop at an open decision | Two travelers named John Smith reach the gate. See the choice the airline has to make, and who each answer gets wrong. | /gate?lean=1&traveler=two-john-smiths
See what the model checks | Read a travel policy beside its Lean model, with what is proven and what is still an open question. | @refunds?lean=1
```

## Questions before you fly {#questions}

```questions
Changes | Can I change my flight, and what will it cost? | @changes#change-cost
Cancellations | If I cancel, how much do I get back? | @changes#cancel
Paying | How long do I have to pay for a booking? | @paying#deadline
Fares | How long is a price I was quoted good for? | @fares#quote
Bags and seats | What happens to my bag and seat if my flight changes? | @extras#flight-changes
Schedule changes | What are my options if Verified Airline changes my flight? | @schedule-changes#options
```
