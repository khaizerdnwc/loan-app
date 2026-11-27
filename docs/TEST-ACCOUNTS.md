# Test accounts

**Published test credentials for synthetic data. They are not secrets.** Every applicant and
every external service in this MVP is simulated (Program Mechanics 1a: "test sign-in … for
at least three seeded roles").

**Password for every account: `Password123!`**

The repository is public, so anyone who reads it can sign in to any environment seeded with
these accounts, including the deployed dev environment. That is acceptable only because all
data is synthetic. A deployment holding anything real would need its own passwords; see
`docs/DEPLOY.md`.

| Username | Name | Role | Can | Cannot | Lands on |
|---|---|---|---|---|---|
| `paolo` | Paolo Tan | Loan officer | Capture and submit applications; review referred cases; recommend approve, counter-offer or decline (an override needs a reason code) | Approve, sign, book | Work queue |
| `rina` | Rina Aquino | Approver | Approve up to **₱1,000,000** for grades **A–C**; decline or return to the officer | Book; approve above her authority | Work queue (approvals within her authority) |
| `ben` | Ben Castro | Approver | Approve up to **₱100,000** for grades **A–B** (shows the authority breach: Joel's ₱120,000 grade C case is refused and escalated) | Approve above ₱100,000 or grade C–E | Work queue |
| `marco` | Marco Bautista | Loan operations (booking **maker**) | Record the simulated e-signature; submit a booking for a checker | Approve a booking | Work queue (signing and booking) |
| `ella` | Ella Reyes | Loan operations supervisor (**checker**) | Approve or retry a booking another person submitted; also act as maker | Approve a booking she submitted herself | Work queue (bookings to check) |
| `lito` | Lito Garcia | Loan operations supervisor (**checker**) | Same as Ella; the second checker for maker-checker demos | Approve a booking he submitted himself | Work queue |
| `diane` | Diane Yu | Compliance / audit | Read every case, decision record and history; reproduce a decision | Any change (every write returns 403) | All applications |
| `leo` | Leo Santiago | Admin | Switch the simulated services' failure modes (OK, outage, timeout, malformed, lost reply); a mode resets itself after 15 minutes. Draft an automation mode change, turn a product's kill switch on, approve or reject Celia's automation changes | Any lending action; approve his own automation change | Simulated services |
| `celia` | Celia Ortiz | Admin (credit risk manager) | The second administrator: draft and approve automation changes (off, shadow, live; kill switch off) that Leo drafted, and the reverse; simulation controls like Leo | Any lending action; approve her own automation change | Simulated services |

Usernames are case-insensitive. A wrong password and an unknown username get the same
message. Sign-in allows 20 attempts a minute per account and 60 a minute per source address.

The F1/F2 walkthroughs, step by step and naming who acts at each step, are in
`docs/ACCEPTANCE.md`. The applicant personas (Maria, Joel, …) are in `docs/ASSUMPTIONS.md`.
