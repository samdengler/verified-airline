title: Changes and cancellations
kind: policy
lede: What it costs to change a flight you booked, and what you get back if you cancel. The answer depends on your fare and where you are in your trip.
summary: What a change costs and what a cancellation returns, at each point in your trip.
questions: Can I change my flight? | If I cancel, what do I get back? | Can I cancel a booking I have not paid for?
requirements: ONE-202, ONE-203, ONE-503, ONE-504, ONE-505
related: schedule-changes, refunds, paying
---

## Where you are in your trip {#stages} {model: ONE-503}

What a change costs, and what you get back if you cancel, depends on your fare and on how far along your trip is. We always use the terms in effect on the day you ask.

```stages
Before you pay
Paid, before departure
After your first flight
You missed a flight
```

## What each fare allows {#fares} {model: ONE-503, ONE-504, ONE-505}

```fares
refused: Not allowed
fee: {fee} fee plus fare difference
no fee: Fare difference only
nothing: Nothing back
full: Full price back
fixed: {refund} back
Change before departure | change beforeDeparture
Change after your first flight | change afterDeparture
Change after a missed flight | change noShow
Cancel before departure | cancel beforeDeparture
Cancel after your first flight | cancel afterDeparture
Cancel after a missed flight | cancel noShow
```

Amounts are per traveler, per booked item. Your booking confirmation shows the terms of your fare.

## What a change costs {#change-cost} {model: ONE-504}

If your fare allows the change, you pay the change fee plus the difference between the new fare and what you paid. Nothing else is added. If your fare has no change fee, you pay only the difference.

```example
Example: moving a Main fare to a later flight
New flight | {{examples.mainChange.newPrice}}
What you paid | −{{examples.mainChange.oldPrice}}
Change fee | {{examples.mainChange.fee}}
= You pay | {{examples.mainChange.youPay}}
```

A fee costs you the same whether we take it out of money we return to you or charge it separately. {model: ONE-202}

## What a cancellation returns {#cancel} {model: ONE-505}

When you cancel a flight you have not used, you get back what your fare allows at that point in your trip: the full price, a set amount, or nothing. We tell you the amount before you confirm. Money we return goes back to the card or account you paid with.

```example
Example: cancelling before departure
Basic, paid {{examples.basicCancel.price}} | {{examples.basicCancel.refund}} back
Main, paid {{examples.mainCancel.price}} | {{examples.mainCancel.refund}} back
Flex, paid {{examples.flexCancel.price}} | {{examples.flexCancel.refund}} back
```

If you have not paid for your booking yet, you can cancel it at any time and there is nothing to pay. {model: ONE-203}

## Still being decided {#deciding}

### Bookings paid before a fare's terms start {open: ONE-503.5}

Once in a while a booking is paid before its fare's change terms start. We have not yet decided what applies in that gap. If this is your case, contact us and we will quote your change or cancellation directly.

### Taxes back on a fare with no refund {open: ONE-505.5}

Some taxes in a fare can be returned when a flight is cancelled. We have not yet decided whether you get those taxes back when your fare returns nothing, or after a missed flight. If this is your case, contact us and we will quote your refund directly.
