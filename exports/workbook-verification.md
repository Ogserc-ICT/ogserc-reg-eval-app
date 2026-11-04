# Workbook verification

Generated 2026-11-04T22:04:02.146Z. Macros imported.

| SPEC §11 row | Fixture | Checks | Result |
|---|---|---|---|
| Example mini-grid | MGD 2.5 MW on time: Category E, fee ₦250,000, no late charge | 53 | match |
| Mighty Power | MSL 60 MW Unlicensed on the Effective Date: Category F, ₦500,000, multi-State flag, licence application due ED + 90 | 53 | match |
| Late tier 2 | Category D 20 days late: late ₦2,500,000, total ₦2,800,000 | 53 | match |
| Late tier 1 at cap | Category A 150 days late: late ₦21,000,000 (capped) | 53 | match |
| Late tier 3 | Category K 5 days late: late ₦150,000 | 53 | match |
| Highest applies | GEN 5 MW + EST: Category G | 53 | match |
| A dominates | Primary GEN + secondary SDC: Category A | 53 | match |
| A dominates | Primary EST + secondary SDC: Category A | 53 | match |
| A dominates | Primary MGD + secondary SDC: Category A | 53 | match |
| A dominates | Primary INT + secondary SDC: Category A | 53 | match |
| Capacity tiers | GEN 0.5 MW | 53 | match |
| Capacity tiers | GEN 5 MW | 53 | match |
| Capacity tiers | GEN 15 MW | 53 | match |
| New operator | Not operating, start 2027-03-01: deadline 2027-01-30 | 53 | match |
| Waiver | Fee 500k, waiver 100k, paid 400k: Paid and complete | 53 | match |
| Waiver | Same, one document outstanding: Paid, not complete | 53 | match |
| Provisional | Complete on day 0, day 30: still under review, determine by day 30 | 53 | match |
| Provisional | Day 31, no decision: recommended outcome provisional registration | 53 | match |
| Provisional | Provisionally Registered: registration number in use = ack number | 53 | match |
| Approval blockers | Fully ready: no blockers, recommended Register | 53 | match |
| Approval blockers | Missing evaluatingOfficerId | 53 | match |
| Approval blockers | Missing reviewingSupervisorId | 53 | match |
| Approval blockers | Missing approvingOfficerId | 53 | match |
| Approval blockers | A pending check | 53 | match |
| Approval blockers | A failed check | 53 | match |
| Approval blockers | Incomplete submission | 53 | match |
| Approval blockers | Several at once: every reason listed | 53 | match |
| Separation | Approver = evaluator: refused | 53 | match |
| Finance gate | ₦250k recorded, pending: Awaiting Payment, stage 2, amount paid ₦0, approval blocked | 53 | match |
| Finance gate | ₦100k confirmed of ₦250k: gate still closed | 53 | match |
| Finance gate | ₦100k + ₦150k confirmed: gate cleared | 53 | match |
| Finance gate | Fee confirmed, late charge unpaid: cleared by default | 53 | match |
| Finance gate | Same with “late charge required to release” on: not cleared | 53 | match |
| Finance gate + documents | All documents in, fee pending: gate closed, evidence of payment outstanding, not complete | 53 | match |
| Finance gate + documents | Confirmed: complete | 53 | match |
| Forms | GEN 5 MW on REG-01D: 12-item list, 1.10 pending until confirmed | 53 | match |
| Forms | Confirmed D: 1.10 Y | 53 | match |
| Highest applies | GEN 5 MW + MET + EST: Category G | 53 | match |
| Supply / retail | SUP 2 MW: K by default | 53 | match |
| Supply / retail | SUP 2 MW with the setting F: F | 53 | match |
| Supply / retail | SUP 0.5 MW with the setting F: stays K | 53 | match |
| Wrong form | Filed on REG-01K, confirmed D with a reason, accept: 1.10 Y, REG-01D documents | 53 | match |
| Wrong form | Same with “require the correct form”: 1.10 N, must file on REG-01D, deficiency notice | 53 | match |
| Conditions | REG-01D, generation for sale = N: PPAs N/A automatically | 53 | match |
| Evidence of payment | Pending payment: blank | 53 | match |
| Evidence of payment | Confirmed: Y | 53 | match |
| Evidence of payment | Reversed: blank | 53 | match |
| Evidence of payment | Fully waived: N/A | 53 | match |
| Update | Update, no fee setting: fee ₦0, no late charge, gate clear, recommended apply changes | 53 | match |
| Update | Update filed 40 days after the deadline: still no late charge | 53 | match |
| Update | Fee on updates setting on: the category's fee | 53 | match |
| Annual confirmation | Registered 2026, nothing filed by 31 Jan 2027: flagged overdue on 1 Feb 2027 | 53 | match |
| Annual confirmation | One filed 20 Jan 2027 clears it | 53 | match |
| Annual confirmation | Filed 1 Feb 2027: flagged late | 53 | match |
| Annual confirmation | A refused one does not count | 53 | match |
| Licences | Expiries 2029 and ED + 100 days: renewal flag from the nearer one | 53 | match |
| Technical sections | REG-01D captive only, network none: offtake and connection agreements N/A | 53 | match |
| Technical sections | Plant 3 + 1.5 MW, installed 5 MW: capacity flag | 53 | match |
| Technical sections | REG-01K 250 + 252 kW at 0.5 MW: agrees | 53 | match |
| Technical sections | REG-01D with two sections empty, operations does not apply: flag lists the two | 53 | match |
| Own-use | 150 kW: not required, no fee | 11 | match |
| Own-use | 650 kW: notification required, Category I fee ₦100,000 | 11 | match |
| Own-use | 1200 kW: register as operator | 11 | match |
| Own-use units | 400 + 250 kW: 650 kW, notification required, Category I fee | 11 | match |
| Own-use certificate | Setting off, paid, complete: blocked | 11 | match |
| Own-use certificate | Setting on, paid, complete: no blockers | 11 | match |
| Own-use certificate | Setting on, unpaid: fee and evidence of payment blockers | 11 | match |
| Finance gate | Save, record ₦250k: Awaiting Payment, stage 2, paid ₦0; mark complete and approval blocked and audited | 7 | match |
| Finance gate | ₦100k confirmed: not released; ₦150k confirmed: released in the same action | 8 | match |
| Finance gate | Fee confirmed, late charge unpaid: released (default) | 1 | match |
| Finance gate | Fee confirmed, late charge unpaid: not released (setting on) | 1 | match |
| Separation | Finance officer confirms a payment they recorded: refused | 2 | match |
| Provisional | Complete on day 0: day 30 review leaves it; day 31 review → Provisionally Registered, ack no. in use | 5 | match |
| Lapse | Deficiency on day 0: lapse blocked on day 14, allowed on day 15 | 9 | match |
| Reg serial | 3 certificates in 2026, 1 in 2027: …/0001–0003 then 2027/…/0001 | 17 | match |
| Approval blockers | The Approve button refuses with every reason listed | 3 | match |
| Separation | Approver = evaluator: the button refuses | 2 | match |
| Forms | REG-01D: 1.10 pending, then Confirm category D → Y | 4 | match |
| Update | Update of a Registered record: fee ₦0, released at intake; approval → Changes Applied, changes copied, certificate needs reissue, no new number | 12 | match |
| Own-use | 150 kW: warned and allowed on confirmation | 3 | match |
| Own-use | 1200 kW: rejected | 2 | match |
| Own-use certificate | Setting off, paid, complete: blocked | 2 | match |
| Own-use certificate | Setting on, paid, complete: registered OGSERC/REG/2026/I-CPT/0001 | 1 | match |
| Migration | not applicable: Migrating old 13-item records into the app's database is an app-only operation (the workbook has no old records to migrate). It is covered by the app's own tests. | – | n/a |

## All fixtures match the domain functions

