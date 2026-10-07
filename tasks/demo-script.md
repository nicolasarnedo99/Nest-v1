# Turtle demo — saved activity, investments paused

Allow about 90 seconds. Open https://morty.tail73d5db.ts.net on the iPhone
with Tailscale connected. Use the existing saved simulation to preserve
history; the script does not require a transfer or new production event.
Complete login privately and keep codes and Shortcut tokens out of frame.

## 1. Login

Show the login screen, then the authenticated dashboard.

“Turtle shows a private testnet wallet and records spending simulations.
Investments are paused.”

## 2. Wallet and funding balance

Show the current balance and Add test USDC panel, then refresh once. Do not
request faucet funds for this walkthrough.

“This is the existing wallet. The receive panel explains where test funds
would go. Refresh reads the balance; it does not move money.”

## 3. Simulated purchase

Show Try a simulated purchase and the saved Aplle store madrid, 500 USD
example in Your activity. Preserve the spelling and amount. If demonstrating
a new save in an isolated test environment, enter an explicitly manual
example and select Save simulation once.

“The form saves manually entered spending, not a real Apple Pay payment.
This example was entered on the phone. Its planned allocation has not been
invested.”

## 4. Persistence

Point to Simulation and Not purchased. Reload and show the same entry.

“The event survives reload. No card was charged or tokens bought by this
simulation, and it will not invest automatically later.”

A page reload is not a duplicate POST test. If an actual save times out, use
Retry saving this simulation to retain its ID; re-entering the form creates
a new event. Failed balance or activity reads must be shown as unavailable.

## 5. What comes next

“Login, balance reads, simulations and persistent activity work today. Scoped
Shortcut intake is implemented, but real Revolut payment fields and delivery
are still pending. The saved phone diagnostic sends nothing to Turtle.
Classification is deferred; automatic investments remain disabled.”

End on activity and the paused explanation. A card tap would not prove
settlement. The historical manual testnet round trip is separate evidence,
not a result of this simulation.

## Verification boundaries

Real iPhone verification covered HTTPS, allowed Privy login, scoped-token
creation and the saved simulation after reload. Browser layout/error tests
use isolated authentication and API fixtures. Duplicate handling is tested
with isolated HTTP/SQLite requests; no real iPhone duplicate POST has been
verified. Current counts and state-preservation evidence are in
[tasks/todo.md](todo.md).
