# OGSERC Registration & Evaluation System — Business Rules Spec

Source: `reference/OGSERC_Registration_and_Evaluation_System.xlsm` (macro workbook, created 21 Oct 2026). Every rule below was extracted from its cell formulas and VBA module (`OGSERC.bas`). Paragraph references (para 13(1) etc.) are to **Order No. OGSERC/ORD/2026/001**, the Order on Commencement of Operations and Registration of Licensees and Electricity Operators, 2026.

Reference data (fee table, activities, LGAs, drop-down lists, Schedule 2 documents, all 62 evaluation checks) is in `seed-data.json`. Seed the database from that file; do not retype it.

Users: **OGSERC staff only**. There is no public applicant portal in this version.

---

## 1. Core entities

### 1.1 Submission (one per registrant; the Excel "Register" row)

Identity and service area (Schedule 1 A–F):
- `ackNo` (generated, see §3), `registeredName`*, `dateSubmitted`*, `submissionChannel`, `registrantType`, `cacNo`, `tin`, `address`, `principalLga`*, `otherAreasServed` (free text: LGAs, feeders, estates)

Activity and assets:
- `primaryActivity`* (from activities list), `secondaryActivity` (optional), `installedCapacityMw` (decimal), `customers` (int)

Licences (Schedule 1 D):
- `licenceStatus`*, `licenceNo`, `licenceExpiry`

Contact (Schedule 1 C):
- `complianceOfficer`, `phone`, `email`

Timeline:
- `operatingOnEffectiveDate`* (Y/N), `plannedStartDate` (required when N)

Fees:
- `approvedWaiver` (money), `categoryOverride` (optional category letter) + `overrideReason` (required when override differs from auto)

Determination:
- `status`*, `dateSubmissionComplete`, `deficiencyNoticeDate`, `certificateIssueDate`, `registrationNo` (locked when issued), `remarks`

\* = required at intake.

### 1.2 DocumentChecklist (1:1 with Submission)
13 Schedule 2 items (see seed `schedule2_documents`). Each value is `Y` (received), `N` (outstanding), `N/A`, or blank (pending).

### 1.3 Evaluation (1:1 with Submission; Form OGSERC/EVAL-01)
- Assignment: `evaluatingOfficerId`, `dateEvaluationStarted`, `reviewingSupervisorId`, `approvingOfficerId`
- 55 decision checks (stages 1–7) + 7 post-approval checks (stage 9). See seed `evaluation_checks`. Each value is `Y`/`N`/`N/A`/blank.
- `evaluationRemarks`, `finalDecision`, `reasons`, `reviewDate`, `approvalDate`

### 1.4 Payment (many per Submission or per OwnUseNotification)
- `paymentNo` (generated), `dateReceived`*, `reference` (Ack No. or OUN No.)*, `purpose`, `channel`, `amount`*, `rrr` (Remita/bank reference), `verifiedWithBank` (Y/N)

### 1.5 OwnUseNotification (Category I, para 3(4), form OUN-01)
- `ounNo` (generated), `name`*, `dateFiled`*, `cacNo`, `siteAddress`, `lga`*, `natureOfBusiness`, `gridConnected` (Y/N), `distributionLicensee`, `units`, `installedCapacityKw`*, `fuel`, `avgMonthlyOutputMwh`, `contactPerson`, `phone`, `email`

### 1.6 AuditLog
Append-only. `timestamp`, `userId`, `action`, `reference` (Ack/OUN No.), `detail`. Never editable or deletable through the app.

### 1.7 Settings (single row, admin-editable)
From seed `settings`: effective date, registration period (60), extension days (0), new-operator lead days (30), determination period (30), deficiency period (14), licence application period for unlicensed (90), licence expiry window (183), amber warning days (7), own-use threshold kW (200), number prefixes, and the two certificate signatory names.

**Effective Date is a placeholder (22 Oct 2026).** Admin must set the gazetted date before go-live. Every deadline depends on it.

---

## 2. Calculated fields (derive on read or recompute on save; never let users edit them)

### 2.1 Activity code
Lookup `primaryActivity` → `code` in activities table (SDC, INT, GEN, CPT, DIS, MSL, IDN, TRD, SUP, MGD, EST, FRN, MET, OTH).

### 2.2 Category for an activity
```
cap = installedCapacityMw ?? 0
if cap >= 10   -> activity.cat_10mw_plus
elif cap >= 1  -> activity.cat_1_to_10mw
else           -> activity.cat_below_1mw
```
Computed separately for the primary and the secondary activity.

### 2.3 Category (auto) — "highest applies" (para 17(1))
```
if primaryCat is empty -> empty
if primaryCat == 'A' or secondaryCat == 'A' -> 'A'
if primaryCat == 'B' or secondaryCat == 'B' -> 'B'
if no secondaryCat -> primaryCat
else -> whichever of the two has the higher registration fee (ties -> primary)
```
`categoryApplied = categoryOverride ?? categoryAuto`. `categoryDescription` comes from the fee table.

### 2.4 Registration deadline
```
if operatingOnEffectiveDate == 'Y':
    deadline = effectiveDate + registrationPeriodDays + extensionDays   # para 11(1), 25
else:
    deadline = plannedStartDate - newOperatorLeadDays                   # para 11(2); empty if no start date
daysLate = max(0, dateSubmitted - deadline)    # whole days
```

### 2.5 Fees (Schedule 3)
```
fee        = feeTable[categoryApplied].registration_fee
lateCharge = daysLate > 0
             ? late_initial + min(late_daily * daysLate, late_daily_cap)
             : 0
totalDue   = max(0, fee - approvedWaiver) + lateCharge   # the waiver reduces the fee only, not the late charge
amountPaid = sum(payments where reference == ackNo)
lastPaymentDate = max(payment.dateReceived) when amountPaid > 0
balance    = totalDue - amountPaid
paymentStatus = totalDue == 0 ? 'Nil'
              : balance <= 0 ? 'Paid'
              : amountPaid > 0 ? 'Part-paid' : 'Unpaid'
```
Category I has no late charge (all late fields are 0 in the table).

Store money as integer kobo, or as naira in a `numeric` column. Never use float.

### 2.6 Documents
```
outstanding = count of items == 'N'
pending     = count of items blank
documentsComplete = outstanding == 0 && pending == 0
outstandingList = items that are not 'Y' and not 'N/A' (used in the deficiency notice)
receivedList    = items == 'Y' (used in the acknowledgement letter)
```

### 2.7 Submission complete (para 13(1))
```
submissionComplete = documentsComplete && amountPaid >= max(0, fee - approvedWaiver)
```
Note: the Excel compares against `fee - waiver`, **not** `totalDue`, so an unpaid late charge does not block completeness. Flag this for the Commission to confirm (see §9).

### 2.8 Clocks
```
determinationDue      = dateSubmissionComplete + determinationDays     # para 13(1)
deficiencyResponseDue = deficiencyNoticeDate + deficiencyDays          # para 13(1)(b)
licenceApplicationDue = licenceStatus == 'Unlicensed' ? effectiveDate + licenceAppDays : null   # para 18(1)
```

### 2.9 Days in queue and SLA light
```
open = status not in (Registered, Refused, Lapsed, Cancelled)
daysInQueue = open ? max(0, today - dateSubmitted) : null

SLA (null if daysInQueue is null or status == 'Provisionally Registered'):
  Red   if (determinationDue && today > determinationDue)
         or (status == 'Deficiency Notice Issued' && today > deficiencyResponseDue)
  Amber if (determinationDue && determinationDue - today <= amberDays)
         or (!determinationDue && daysInQueue > determinationDays)
  Green otherwise
```

### 2.10 Registration number in use
```
registrationNo (locked) if set
else if status == 'Provisionally Registered' -> ackNo     # para 13(4)
else null
```

### 2.11 Next action (shown on the submission page)
Evaluate in order:
1. Registered → "Complete" (or "Lock the registration number" if somehow unlocked)
2. Cancelled / Refused / Lapsed → "Closed – {status}" (Lapsed adds "; fresh application needed")
3. Deficiency Notice Issued → today > response due ? "Response overdue – lapse the submission (para 13(2))" : "Await response by {date}"
4. Provisionally Registered → "Determine and issue the certificate"
5. Not complete → "Obtain {n} outstanding document(s)" and/or "collect ₦{balance}", then " – or issue a deficiency notice"
6. Complete, no completion date → "Enter the Date Submission Complete"
7. today > determinationDue → "Overdue – provisional registration applies (para 13(4))"; else "Determine by {date}"

### 2.12 Data flags (warnings shown on the record and the dashboard)
Each condition adds a flag:
- Duplicate CAC number on another submission
- Duplicate registered name
- Missing required field
- Activity not in the activities list
- Capacity-based activity (GEN, CPT, MGD, OTH) with no installed capacity
- Category overridden with no reason
- Certificate dated but submission not complete
- Certificate dated but status not Registered/Cancelled
- Registered without certificate date
- Duplicate registration number
- Licence expires within `expiryWindowDays` of the Effective Date → renewal (para 8(5))
- CPT with capacity < 1 MW → "Own-use below 1 MW is excluded – use Own-Use Notifications"
- MSL with licence status other than "NERC licence (multi-State)" → "Check licence status for multi-State licensee"
- Not operating on Effective Date and no planned start date
- Date submitted in the future
- Unlicensed and today > licenceApplicationDue (para 18(2))

**New rules (not in the Excel; add them, see §8):**
- Licence status "Unlicensed" or "Licence application pending" with a licence number entered
- Licence status other than Unlicensed/pending with no licence number
- Primary activity is generation-related and capacity ≥ 10 MW, but the applied category is not C (or A/B)
- TIN or CAC number fails format validation

---

## 3. Number formats

| Number | Format | Rule |
|---|---|---|
| Acknowledgement | `OGSERC/ACK/{yyyy of dateSubmitted}/{00000}` | Excel uses the Register row position (one global sequence). Use a DB sequence, assigned once at save, never reused. |
| Payment | `OGSERC/PAY/{yyyy of dateReceived}/{00000}` | Global sequence. |
| Own-use | `OGSERC/OUN/{yyyy of dateFiled}/{0000}` | Global sequence. |
| Registration | `OGSERC/REG/{yyyy of certificateIssueDate}/{category}-{activityCode}/{0000}` | Serial = certificates issued in that calendar year, in issue order (not per category). Example: `OGSERC/REG/2026/F-MSL/0001`. Assign inside the approval transaction and lock it. It must never change afterwards. |
| Deficiency notice ref | `OGSERC/DEF/{yyyy}/{serial from ack}` | e.g. ack 00002 → `OGSERC/DEF/2026/00002` |
| Certificate serial | last 4 digits of the registration number | |

---

## 4. Status workflow

Statuses: `Received - Under Review`, `Deficiency Notice Issued`, `Provisionally Registered`, `Registered`, `Lapsed`, `Refused`, `Cancelled`.
Closed statuses: Registered, Refused, Lapsed, Cancelled.

### 4.1 Save submission (intake)
- Validate required fields.
- If the CAC number already exists: warn "one registration per person (para 11(4))" and require explicit confirmation.
- Create Submission + empty DocumentChecklist + Evaluation. Status = `Received - Under Review`. Assign ack number.
- If an evaluating officer was chosen at intake, set `dateEvaluationStarted = today`.
- Audit: `New submission`, detail `{name} - Category {cat}`.
- Offer to open the acknowledgement letter.

### 4.2 Record payment
- Reference must match an existing Ack No. or OUN No., else reject.
- Duplicate RRR/reference → warn and require confirmation.
- Audit: `Payment recorded`, detail `{amount} - ref {rrr}`.

### 4.3 Save own-use notification
- capacity ≥ 1000 kW → reject: "register as captive generation (para 3(3)(c))".
- capacity < threshold (200 kW) → warn "does not need to notify (para 3(4))", allow with confirmation.
- Fee due = Category I fee if eligibility is "Notification required", else 0.
- Eligibility: `< 200 kW` "Not required", `>= 1000` "Register as operator", else "Notification required".
- Flags: missing required, duplicate CAC among OUNs, CAC also on the Register, fee not fully paid. Also show "Filed after deadline?" (dateFiled > existing-operator deadline).
- Audit: `Own-use notification`.

### 4.4 Mark submission complete
- If `submissionComplete`: set `dateSubmissionComplete = today` if empty. This starts the 30-day determination clock. Audit `Submission complete`, detail `Determination due {date}`.
- Else: show outstanding documents and balance, and suggest a deficiency notice. No state change.

### 4.5 Issue deficiency notice (para 13(1)(b))
- Blocked if status is closed.
- If no checks failed and the submission is complete: warn and require confirmation.
- Set status `Deficiency Notice Issued`, `deficiencyNoticeDate = today`. Audit with response due date. Generate the deficiency notice PDF.

### 4.6 Approve and register (para 13(1)(a))
Blocked unless **all** of these hold (list every failing reason):
- Evaluating officer, reviewing supervisor and approving officer are all assigned
- `submissionComplete`
- 0 failed checks and 0 pending checks among the 55 decision checks
- **New:** no unresolved data flags, unless an approver records a written override reason
- **New:** separation of duties (see §5)

On approval, in one transaction:
- `dateSubmissionComplete = today` if empty; `certificateIssueDate = today`; status `Registered`
- Evaluation: `finalDecision = 'Register (13(1)(a))'`, `reviewDate = today` if empty, `approvalDate = today`
- Generate and lock the registration number
- Audit `Registered`, detail `{regNo} - approved by {approver}`
- Generate the certificate PDF

### 4.7 Lapse (para 13(2))
- Only when status is `Deficiency Notice Issued` and today > deficiencyResponseDue.
- Status `Lapsed`, finalDecision `Treat as lapsed (13(2))`, approvalDate today. Audit.

### 4.8 Refuse (paras 13(3), 20)
- Confirm that a show-cause notice was served and its 14-day period has ended (store the show-cause date; **new**: block if fewer than 14 days have passed).
- Grounds are required (default suggestion "False or misleading information"). Allowed grounds per the Order: false information, non-payment, activity outside the Order.
- Status `Refused`, finalDecision `Refuse (13(3)) - after show-cause`, reasons = ground, approvalDate today. Audit.

### 4.9 Cancel
A status in the list (para 14) with no button in the Excel. Add an admin-only action with a required reason and audit entry.

### 4.10 Daily review (scheduled job, plus a manual "Run now" button)
For each submission:
- `Received - Under Review` with determinationDue < today → set `Provisionally Registered` (para 13(4)); audit `Provisional registration`.
- `Deficiency Notice Issued` with response due < today → list as overdue. The Excel asks before lapsing. In the app, show them on the dashboard for a user to lapse; do not auto-lapse.
- Registered with no locked number → lock it (shouldn't happen if approval is transactional).
- Write a summary audit entry: provisional today, overdue deficiency responses, numbers locked, red count, amber count, unpaid/part-paid count.
Run at 06:00 Africa/Lagos.

### 4.11 Evaluation status and recommended outcome
```
evaluationStatus = finalDecision ? 'Decided'
                 : !evaluatingOfficer ? 'Not assigned'
                 : pending > 0 ? 'In progress' : 'Ready for decision'

recommendedOutcome:
  if check 1.3 == 'N' or check 1.4 == 'N' -> 'Redirect to OUN-01 / outside scope'
  elif status == Deficiency Notice Issued and today > responseDue -> 'Treat as lapsed (13(2))'
  elif determinationDue and no finalDecision and today > determinationDue -> 'Provisional registration (13(4))'
  elif failed > 0 -> 'Issue deficiency notice (13(1)(b))'
  elif pending > 0 -> 'Evaluation in progress'
  else -> 'Register (13(1)(a))'

progress = (satisfied + failed + na) / 55
fileClosed = all 7 post-approval checks are Y or N/A
```

---

## 5. Roles and separation of duties (new; the Excel has none)

| Role | Can do |
|---|---|
| Registry Officer | Intake, documents checklist, record payments, own-use notifications, print acknowledgement letters |
| Finance Officer | Record payments, mark payments verified with bank |
| Evaluating Officer | Complete evaluation checks on assigned submissions, mark complete, draft deficiency notices |
| Reviewing Supervisor | Review evaluations, issue deficiency notices, lapse |
| Approving Officer | Approve and register, refuse |
| Admin | Users, roles, settings, fee table, activity map, cancel |
| Viewer | Read-only, dashboard |

A user may hold several roles. Enforce on the server:
- The approving officer cannot be the evaluating officer or the reviewing supervisor on the same submission.
- The approving officer cannot be the user who created the submission.
- The reviewing supervisor cannot be the evaluating officer.
- Only the assigned evaluating officer (or a supervisor) can edit that submission's checks.
- The officer drop-downs are filtered by role.
- The audit log records the authenticated user, not a free-text name.

---

## 6. Evaluation checks: which are automatic

Checks marked **auto** are computed and read-only. "Auto-N/A unless" means N/A unless the condition holds, in which case it becomes a manual check (blank until answered). All others are manual Y/N/N/A.

| Check | Rule |
|---|---|
| 1.1 | auto: Y once an ack number exists |
| 1.3 | auto: N if the activity code is missing or unknown, else Y |
| 1.4 | auto: N if code CPT and capacity < 1 MW, else Y |
| 1.5 | auto: N if the CAC number appears on another submission, else Y |
| 1.7 | auto-N/A unless code MSL or licence status "NERC licence (multi-State)" |
| 1.8 | auto: Y if daysLate == 0, else N |
| 1.9 | auto: N/A if not late; Y if late charge > 0, else N |
| 3.0 | auto: Y if documentsComplete, else N |
| 3.1 | auto-N/A if 3.0 is Y |
| 3.2 | auto-N/A if registrant type is Company or empty |
| 4.3 | auto: N/A if no licence expiry; N if expiry − effectiveDate ≤ window; else Y |
| 4.9 | auto-N/A unless Unlicensed |
| 5.3 | auto-N/A unless waiver > 0 |
| 5.4 | auto: same as 1.9 |
| 5.5 | auto: Y if balance ≤ 0, else N |
| 7.1 | auto-N/A unless Unlicensed |
| 7.3 | auto-N/A unless MSL or multi-State NERC licence |
| 7.5 | auto: N/A (always, on REG-01 submissions) |
| 7.6 | auto: Y if there are no data flags, else N |
| 9.1 | auto: Y if certificate date set and status Registered |
| 9.2 | auto: Y if registration number locked |

**New:** make 2.4 and 4.2 auto-N/A when licence status is Unlicensed. Mighty Power had both marked Y with no licence.

---

## 7. Documents to generate (PDF, server-side)

All use the letterhead: "OGUN STATE ELECTRICITY REGULATORY COMMISSION — 5th and 6th Floors, OPIC Building, Oke-Ilewo, Abeokuta, Ogun State · registration@ogserc.gov.ng". Logo: `assets/ogserc-logo.png`. Full wording is in `docs/TEMPLATES.md`.

1. **Acknowledgement letter** (para 10(3))
2. **Evaluation form** EVAL-01 (internal): all checks with values, counts, recommended outcome, final decision, registration number, signature lines for the three officers
3. **Deficiency notice** (para 13(1)(b)): outstanding documents, fees, response deadline
4. **Registration certificate** CERT-01: A4 landscape on `assets/cert-security-background.png` (2338×1654). The original Word template is in `assets/CERT-01_template.docx` for layout reference. Generate the PDF directly; do not depend on Word or LibreOffice (that dependency is why certificate generation fails in the Excel).

Certificate fields:
| Field | Value |
|---|---|
| SERIAL | last 4 of reg no |
| REG_NO | registration number in use |
| NAME | registered name, UPPERCASE |
| CAC | CAC no, or "N/A" |
| ADDRESS | address, or "—" |
| CATEGORY | "{cat} — {description}" |
| ACTIVITY | primary activity |
| OTHER | secondary activity, or "None" |
| AREA | principal LGA + "; " + other areas (if any) |
| LICENCE | Unlicensed/empty → "None — application pending"; else "{status}, No. {licenceNo}" (number only if present) |
| DAY/MONTH/YEAR | certificate issue date: "22nd", "October", "2026" |
| CHAIR_NAME / COMM_NAME | from Settings. **Block issuing while either is "[Name]" or empty.** |

---

## 8. Known problems in the Excel: fix them, don't copy them

1. Certificate generation through Word automation fails ("This command is not available"). → Server-side PDF.
2. No separation of duties; the audit "user" is the Windows username. → §5.
3. Approval ignores data flags. → Block, or require a written override.
4. Contradictory licence data passes (Unlicensed + MSL; checks 2.4/4.2 marked Y with no licence). → New flags (§2.12) and auto-N/A (§6).
5. No format validation on TIN, CAC, phone, email. → Validate. CAC: RC/BN/IT prefix + digits. TIN: confirm format with Finance. Nigerian phone: 11 digits starting with 0, or +234.
6. Register, Checklist and Evaluation are aligned by row number and break if sorted. → Proper foreign keys.
7. Signatory names default to "[Name]" and still print. → Block issuing (§7).
8. Example rows are mixed with live data. → Seed examples only in dev/test environments.
9. Fee revision date is inconsistent (Guide says 21 Oct, Settings says 20 Oct). → Store `feesRevisedOn` once in Settings.
10. A deficiency notice can be printed for any selected submission, even one with nothing outstanding. → Only generate it from the Issue action, or show it clearly as a draft.

---

## 9. Open questions for the Commission (do not guess; make them configurable)

1. Gazetted Effective Date.
2. Does an unpaid **late charge** block "submission complete"? (The Excel says no; §2.7.)
3. Does the waiver apply to the late charge too? (The Excel says no.)
4. Should the ack serial restart each year? (The Excel uses one global sequence.)
5. Should unresolved data flags block approval outright, or allow an approver override with reasons?
6. SUP (Supply/retail) is mapped to Category K. The Lists sheet says "change if the Commission decides otherwise."
7. TIN format to validate against.
8. Who holds which role (staff list and role matrix).

---

## 10. Dashboard

Key dates: Effective Date, registration deadline, days to deadline.
Submissions: total, registered, provisionally registered, in progress, closed (refused/lapsed/cancelled), own-use notifications, late submissions.
Workflow: overdue (SLA red), due within the warning window (amber), records with flags, average days in queue (open only).
Evaluation: in progress, ready for decision, decided, not assigned.
Money: total due (fees + late charges), collected, collected and bank-verified, outstanding, collection rate.
Breakdowns: by Schedule 3 category (submissions, registered, fees, late charges, waivers, collected, outstanding; Category I comes from own-use notifications); by status; by primary activity code; by principal LGA (registrants + own-use); monthly intake for 12 months from the Effective Date month (submissions, registered by certificate date, collected by payment date).

Also show work queues: my assigned evaluations, overdue deficiency responses awaiting lapse, ready for decision.

---

## 11. Test fixtures (expected results)

| Case | Inputs | Expected |
|---|---|---|
| Example mini-grid | MGD, 2.5 MW, on time | Category E, fee ₦250,000, late ₦0 |
| Mighty Power | MSL, 60 MW, Unlicensed, submitted on Effective Date | Category F, fee ₦500,000; flag "Check licence status for multi-State licensee"; licence application due = Effective Date + 90 |
| Late tier 2 | Category D, 20 days late | late = 500,000 + min(100,000×20, 10,000,000) = ₦2,500,000; total ₦2,800,000 |
| Late tier 1 at cap | Category A, 150 days late | late = 1,000,000 + min(30,000,000, 20,000,000) = ₦21,000,000 |
| Late tier 3 | Category K, 5 days late | late = 100,000 + 50,000 = ₦150,000 |
| Highest applies | Primary GEN 5 MW (D, ₦300k) + secondary EST (G, ₦500k) | Category G |
| A dominates | Secondary SDC | Category A |
| Capacity tiers | GEN 0.5 / 5 / 15 MW | K / D / C |
| New operator | Not operating, start 2027-03-01 | deadline 2027-01-30 |
| Waiver | Fee 500k, waiver 100k, paid 400k, no late charge | Paid; submission complete if documents complete |
| Own-use | 150 / 650 / 1200 kW | warn & allow / Cat I fee ₦100,000 / reject |
| Provisional | Complete on day 0, no decision | day 31 daily review → Provisionally Registered; reg no in use = ack no |
| Lapse | Deficiency on day 0 | lapse blocked on day 14, allowed on day 15 |
| Approval blockers | each missing officer / pending check / failed check / incomplete | approval refused with every reason listed |
| Separation | approver == evaluator | approval refused |
| Reg serial | 3 certificates in 2026, 1 in 2027 | .../0001–0003 then 2027/.../0001 |
