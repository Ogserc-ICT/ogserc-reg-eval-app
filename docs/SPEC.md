# OGSERC Registration & Evaluation System — Business Rules Spec

Source: `reference/OGSERC_Registration_and_Evaluation_System.xlsm` (macro workbook, created 21 Oct 2026). Every rule below was extracted from its cell formulas and VBA module (`OGSERC.bas`). Paragraph references (para 13(1) etc.) are to **Order No. OGSERC/ORD/2026/001**, the Order on Commencement of Operations and Registration of Licensees and Electricity Operators, 2026.

Reference data (fee table, activities, LGAs, drop-down lists, all 63 evaluation checks) is in `seed-data.json`. The 11 category-specific forms REG-01A to REG-01K, with each form's Schedule 2 document list and the document conditions, are in `registration-forms.json` (the Word forms are in `reference/forms/`). Seed the database from those files; do not retype them.

Users: **OGSERC staff only**. There is no public applicant portal in this version.

---

## 1. Core entities

### 1.1 Submission (one per registrant, plus one per update or annual confirmation; the Excel "Register" row)

Registrants file on the form for their Schedule 3 category: REG-01A to REG-01K (REG-01I is the own-use notification, §1.5). The common sections below are on every form except REG-01I; the category-specific technical sections come in part 2.

Filing:
- `filingType`*: New registration / Update: material change (para 16(1)) / Annual confirmation (para 16(2)). Never changes once saved (DB trigger).
- `formFiled`*: REG-01A to REG-01K (not REG-01I). The category is still calculated (§2.3); the evaluator confirms it (§4.13).
- `linkedSubmissionId`: updates and annual confirmations link to an existing **Registered** submission, quoted by its registration number at intake. Never changes once saved (DB trigger).

A. Applicant:
- `ackNo` (generated, see §3), `registeredName`*, `tradingName`, `dateSubmitted`*, `submissionChannel`, `registrantType`, `cacNo`, `incorporationDate`, `tin`, `address` (registered), `operationalAddress` (in Ogun State), `website`

B. Ownership and management:
- shareholders or members holding 5% or more (child table: name, nationality/country, % holding, beneficial owner Y/N)
- directors and key officers (child table: name, position, phone, email)
- managing director / principal officer: `mdName`, `mdPhone`, `mdEmail`
- regulatory compliance officer: `complianceOfficer`, `phone`, `email`

C. Licences, permits and registrations held:
- `licenceStatus`*; licences (child table: type, issuing authority, number, issue date, expiry date, activity/site covered). This replaces the single licence number and expiry. Licence flags and check 4.3 use the **nearest** (earliest) expiry date in the table.

D. Service area:
- `principalLga`*, `lgasServed` (multi-select of the 20 LGAs; the principal LGA counts as served whether ticked or not), `otherAreasServed` (towns, communities, estates or industrial clusters)

Activities and assets:
- `primaryActivity`* (from the activities list), other activities (multi-select of the activities list, replacing the single secondary activity), `installedCapacityMw` (decimal), `customers` (int)

Other common sections: HSE incidents in the last 24 months (child table: date, location, type — incident / fatality / outage over 24 h — description and action); confidentiality claims (child table: item, reasons; para 15(3)); declaration: two signatories (name, designation, date each).

Document conditions (yes/no/blank, one field each; §2.6): holds any licence, multi-State licensee, generation for sale, grid connected, interconnected mini-grid, Form F Part 1 (distribution), Form F Part 2 (trading), DisCo bulk supply (REG-01G), sub-franchisee.

Evaluation: `confirmedCategory`, `categoryConfirmedReason` (required when it differs from the form filed), who confirmed it and when (§4.13).

Only the fields that were required before, plus the form filed, the filing type and (for updates and annual confirmations) the registration number, are required at intake; the new sections are optional and folded on the form so intake stays quick.

Timeline:
- `operatingOnEffectiveDate`* (Y/N), `plannedStartDate` (required when N)

Fees:
- `approvedWaiver` (money), `categoryOverride` (optional category letter) + `overrideReason` (required when override differs from auto)

Determination:
- `status`*, `releasedForEvaluationDate` (set by the Finance gate release, §4.12; locked), `dateSubmissionComplete`, `deficiencyNoticeDate`, `certificateIssueDate`, `registrationNo` (locked when issued), `remarks`

\* = required at intake.

### 1.2 DocumentChecklist (1:1 with Submission)
The Schedule 2 list of the submission's form (`registration-forms.json`, seeded into `RegistrationForm` / `FormDocument`). Items are stored by their **shared key** (e.g. `incorporation` is the same document on every form), so a value carries over when the list changes (re-categorisation, §4.13). Each value is `Y` (received), `N` (outstanding), `N/A`, or blank (pending). Rows for keys not on the current list are kept but not shown. Some items are set automatically (§2.6) and cannot be set by hand. The uniform 13-item list (seed `schedule2_documents_legacy`) is kept only to read the workbook and migrate old records.

### 1.3 Evaluation (1:1 with Submission; Form OGSERC/EVAL-01)
- Assignment: `evaluatingOfficerId`, `dateEvaluationStarted`, `reviewingSupervisorId`, `approvingOfficerId`
- 56 decision checks (stages 1–7, including 1.10) + 7 post-approval checks (stage 9). See seed `evaluation_checks`. Each value is `Y`/`N`/`N/A`/blank.
- `evaluationRemarks`, `finalDecision`, `reasons`, `reviewDate`, `approvalDate`

### 1.4 Payment (many per Submission or per OwnUseNotification)
- `paymentNo` (generated), `dateReceived`*, `reference` (Ack No. or OUN No.)*, `purpose`, `channel`, `amount`*, `rrr` (Remita/bank reference), `verifiedWithBank` (Y/N)
- **Finance status** (§4.12): `Pending` (default) → `Confirmed` or `Rejected`, with who decided, when, and remarks (a rejection needs a reason). Confirming records the bank/Remita verification. A decision is final; a confirmed payment is undone only by reversal (Finance or Admin, with a reason). **Only Confirmed payments count** towards amount paid, balance, completeness and collections, for submissions and own-use notifications alike.

### 1.5 OwnUseNotification (Category I, para 3(4), Form REG-01I; one per site)
- `ounNo` (generated), `name`*, `dateFiled`*, `cacNo`, `siteAddress`, `lga`*, `natureOfBusiness`, `gridConnected` (Y/N), `distributionLicensee`, `contactPerson`, `phone`, `email`
- generator units* (child table, at least one: make/model, installed kW, fuel/technology, average monthly MWh). **Installed capacity is the sum of the units** (calculated, not stored).
- documents: REG-01I's list (certificate of incorporation, generator nameplate photographs, evidence of payment), as §1.2.
- registration (only while the setting "own-use gets a certificate" is on, §4.15): `registrationNo`, `certificateIssueDate`, who registered it; locked once set (DB trigger).

### 1.6 AuditLog
Append-only. `timestamp`, `userId`, `action`, `reference` (Ack/OUN No.), `detail`. Never editable or deletable through the app.

### 1.7 Settings (single row, admin-editable)
From seed `settings`: effective date, registration period (60), extension days (0), new-operator lead days (30), determination period (30), deficiency period (14), licence application period for unlicensed (90), licence expiry window (183), amber warning days (7), own-use threshold kW (200), number prefixes, and the two certificate signatory names.

Category forms (open policy points; admin settings, every change audited):
- **Supply / retail category at 1 MW or more** (default K, as the activity map has it). Below 1 MW Supply / retail is K.
- **Wrong form handling** (default "accept and re-categorise"; the alternative is "require the correct form", §4.13).
- **Other activities require their form's documents** (default off, §2.6).
- **Own-use gets a certificate** (default off, §4.15).
- **Registration fee on updates and annual confirmations** (default off: no fee, §2.5).
- **Annual confirmation due date** (default 31 January, "01-31", para 16(2)).

Finance gate policy (undecided by the Commission; admin settings, audited, applying to every submission from the moment they change, §4.12):
- **Late charge required to release for evaluation** (default off): when on, the gate requires the total due instead of fee − waiver.
- **Unpaid acknowledgement reminder after (days)** (default blank = no automatic action): when set, unpaid acknowledged submissions at or past that age are marked "reminder due" on the dashboard queue and counted by the daily review. No messages are sent.

**Effective Date is a placeholder (22 Oct 2026).** Admin must set the gazetted date before go-live. Every deadline depends on it.

---

## 2. Calculated fields (derive on read or recompute on save; never let users edit them)

### 2.1 Activity code
Lookup `primaryActivity` → `code` in activities table (SDC, INT, GEN, CPT, DIS, MSL, IDN, TRD, SUP, MGD, EST, FRN, MET, OTH).

### 2.2 Category for an activity
```
cap = installedCapacityMw ?? 0
if code == 'SUP' and cap >= 1 -> setting "Supply / retail category at 1 MW or more" (K)
if cap >= 10   -> activity.cat_10mw_plus
elif cap >= 1  -> activity.cat_1_to_10mw
else           -> activity.cat_below_1mw
```
Computed separately for the primary and every other activity, all at the same installed capacity.

### 2.3 Category (auto) — "highest applies" (para 17(1)), across every activity ticked
```
cats = [primaryCat, ...otherCats]          # unknown activities are left out (and flagged)
if primaryCat is empty -> empty
if 'A' in cats -> 'A'
if 'B' in cats -> 'B'
else -> the category with the highest registration fee (ties -> primary, then the earlier activity ticked)
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
Updates and annual confirmations have no registration deadline (so no late charge).

### 2.5 Fees (Schedule 3)
```
fee        = feeTable[categoryApplied].registration_fee
lateCharge = daysLate > 0
             ? late_initial + min(late_daily * daysLate, late_daily_cap)
             : 0
totalDue   = max(0, fee - approvedWaiver) + lateCharge   # the waiver reduces the fee only, not the late charge
amountPaid = sum(payments where reference == ackNo and not reversed and financeStatus == Confirmed)   # §4.12
lastPaymentDate = max(payment.dateReceived) when amountPaid > 0
balance    = totalDue - amountPaid
paymentStatus = totalDue == 0 ? 'Nil'
              : balance <= 0 ? 'Paid'
              : amountPaid > 0 ? 'Part-paid' : 'Unpaid'
```
Category I has no late charge (all late fields are 0 in the table).

Updates and annual confirmations: `fee = 0` and no late charge, unless the setting "registration fee on updates and annual confirmations" is on (then the category's registration fee, still no late charge). With nothing to pay, the Finance gate is clear (§4.12) and the filing is released for evaluation when it is saved.

Store money as integer kobo, or as naira in a `numeric` column. Never use float.

### 2.6 Documents
The list is the Schedule 2 list of one form (`registration-forms.json`):
```
form = the form filed
     | the confirmed category's form, once the evaluator has confirmed a different category and
       wrong forms are accepted and re-categorised (§4.13)
list = form.documents
     + (setting "other activities require their form's documents" on)
         the items of each other activity's form (REG-01{its category}) not already on the list,
         matched by shared key; evidence of payment stays last
```
Each item's value:
```
evidence of payment  -> automatic: 'N/A' if fee − waiver is 0; 'Y' once Finance-confirmed payments
                        cover fee − waiver; else blank (a pending, rejected or reversed payment does
                        not tick it)
required_when C      -> automatic 'N/A' when condition C is answered No; otherwise entered by staff
                        (Yes or not answered: the item applies)
any other item       -> entered by staff
```
Then, over that list:
```
outstanding = count of items == 'N'
pending     = count of items blank
documentsComplete = list not empty && outstanding == 0 && pending == 0
outstandingList = items that are not 'Y' and not 'N/A' (used in the deficiency notice and the acknowledgement's "Pending")
receivedList    = items == 'Y' (used in the acknowledgement letter)
```
The document conditions are in `registration-forms.json` `document_conditions`. `g_disco_bulk_supply` (REG-01G bulk supply agreement) is inferred by the forms' editor; the Commission should confirm it (§9).

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
(No SLA light while the status is "Acknowledged - Awaiting Payment": the clock starts after Finance confirmation, §4.12.)
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
4a. Acknowledged - Awaiting Payment (§4.12) → gate cleared ? "Payment confirmed – release for evaluation (runs automatically)" : payment with Finance ? "Payment with Finance – awaiting confirmation" : "Await payment of ₦{required − confirmed}, then Finance confirmation"
5. Not complete → "Obtain {n} outstanding document(s)" and/or "collect ₦{balance}", then " – or issue a deficiency notice"
6. Complete, no completion date → "Enter the Date Submission Complete"
7. today > determinationDue → "Overdue – provisional registration applies (para 13(4))"; else "Determine by {date}"

### 2.12 Data flags (warnings shown on the record and the dashboard)
Each condition adds a flag:
- Duplicate CAC number on another submission
- Duplicate registered name

  (Both compare registrations: a registration and its own updates and annual confirmations share a CAC number and name by design.)
- Missing required field
- Activity not in the activities list (primary, or any other activity ticked)
- Capacity-based activity (GEN, CPT, MGD, OTH) with no installed capacity
- Category overridden with no reason
- Certificate dated but submission not complete
- Certificate dated but status not Registered/Cancelled
- Registered without certificate date
- Duplicate registration number
- Licence expires within `expiryWindowDays` of the Effective Date → renewal (para 8(5)), using the nearest expiry in the licences table
- CPT with capacity < 1 MW → "Own-use below 1 MW is excluded – use Form REG-01I (own-use notification)"
- MSL with licence status other than "NERC licence (multi-State)" → "Check licence status for multi-State licensee"
- Not operating on Effective Date and no planned start date
- Date submitted in the future
- Unlicensed and today > licenceApplicationDue (para 18(2))

**New rules (not in the Excel; add them, see §8):**
- Licence status "Unlicensed" or "Licence application pending" with a licence number in the licences table
- Licence status other than Unlicensed/pending with no licence number in the licences table
- Primary activity is generation-related and capacity ≥ 10 MW, but the applied category is not C (or A/B)
- TIN or CAC number fails format validation
- **Form filed (§4.13):** "Form filed (REG-01X) does not match the calculated category (Y) – confirm the category" until the category is confirmed; once confirmed as another category: no flag when wrong forms are accepted and a reason is recorded, "…the applicant must file on REG-01Y" when the correct form is required, "…with no reason recorded" otherwise.
- **Confirmed category not charged:** the confirmed category differs from the category charged (the pricing snapshot). Correct the activities or capacity, or override the category, then an admin recalculates. The evaluator's confirmation never changes a fee.
- **Updates and annual confirmations (§4.14):** not linked to a registered submission; the linked registration is no longer Registered (while the filing is open); an annual confirmation filed after the due date in a year when one was due (the registration is from an earlier year).
- **Annual confirmation overdue** (on a Registered new registration): registered before this year, today is after this year's due date (31 January), and no annual confirmation was filed this calendar year (one refused, lapsed or cancelled does not count).
- **Finance gate (§4.12):** "Evaluation started before Finance confirmed payment" (an evaluation start date with no release, or before the release date); "Status moved past acknowledgement without Finance confirmation" (Received, Deficiency, Provisionally Registered, Registered or Lapsed with no release date; Refused and Cancelled can be reached before release and do not raise it)

---

## 3. Number formats

| Number | Format | Rule |
|---|---|---|
| Acknowledgement | `OGSERC/ACK/{yyyy of dateSubmitted}/{00000}` | Excel uses the Register row position (one global sequence). Use a DB sequence, assigned once at save, never reused. |
| Payment | `OGSERC/PAY/{yyyy of dateReceived}/{00000}` | Global sequence. |
| Own-use | `OGSERC/OUN/{yyyy of dateFiled}/{0000}` | Global sequence. |
| Registration | `OGSERC/REG/{yyyy of certificateIssueDate}/{category}-{activityCode}/{0000}` | Serial = certificates issued in that calendar year, in issue order (not per category). Example: `OGSERC/REG/2026/F-MSL/0001`. Assign inside the approval transaction and lock it. It must never change afterwards. An own-use registration (§4.15) is `…/I-CPT/{0000}` from the same yearly series. Updates and annual confirmations get none. |
| Deficiency notice ref | `OGSERC/DEF/{yyyy}/{serial from ack}` | e.g. ack 00002 → `OGSERC/DEF/2026/00002` |
| Certificate serial | last 4 digits of the registration number | |

---

## 4. Status workflow

Statuses: `Acknowledged - Awaiting Payment` (first, §4.12), `Received - Under Review`, `Deficiency Notice Issued`, `Provisionally Registered`, `Registered`, `Lapsed`, `Refused`, `Cancelled`, `Changes Applied` (updates and annual confirmations, §4.14).
Closed statuses: Registered, Refused, Lapsed, Cancelled, Changes Applied.

### 4.1 Save submission (intake)
- Validate required fields, including the form filed (REG-01A to K; REG-01I is refused and recorded under own-use) and the filing type. LGAs served and other activities must be on their lists; table rows are validated row by row ("Row 2: …"), and entirely blank rows are dropped.
- Update / annual confirmation: the registration number must belong to a **Registered** new registration; the filing links to it. The form starts as a copy of the registered record (only real changes then differ, §4.14).
- If the CAC number already exists on another registration: warn "one registration per person (para 11(4))" and require explicit confirmation. A registration's own updates and annual confirmations are not duplicates.
- Create Submission + empty DocumentChecklist + Evaluation. Status = `Acknowledged - Awaiting Payment` (§4.12). Assign ack number.
- An evaluating officer may be chosen at intake; `dateEvaluationStarted` is set when the submission is released for evaluation (§4.12), not at intake.
- Audit: `New submission`, detail `{name} - Category {cat} - Form {form}` (plus the filing type and registration for updates and annual confirmations, which are also noted on the registration's own history).
- Nothing to pay (an update or annual confirmation without a fee): released for evaluation at once (§4.12).
- Offer to open the acknowledgement letter.

### 4.2 Record payment
- Reference must match an existing Ack No. or OUN No., else reject.
- Duplicate RRR/reference → warn and require confirmation.
- Audit: `Payment recorded`, detail `{amount} - ref {rrr}`.
- The payment is `Pending` until Finance confirms or rejects it on the Finance Desk (§4.12).

### 4.3 Save own-use notification (Form REG-01I, one per site)
- At least one generator unit; capacity = the sum of the units.
- capacity ≥ 1000 kW → reject: "register as captive generation (para 3(3)(c))".
- capacity < threshold (200 kW) → warn "does not need to notify (para 3(4))", allow with confirmation.
- Fee due = Category I fee if eligibility is "Notification required", else 0.
- Eligibility: `< 200 kW` "Not required", `>= 1000` "Register as operator", else "Notification required".
- The same CAC number at the same site address as another notification → warn and require confirmation (one notification per site; one registrant may notify several sites).
- Flags: missing required (no generator units), same CAC number and site address as another notification, CAC also on the Register, fee not fully paid. (No duplicate-CAC flag between notifications.) Also show "Filed after deadline?" (dateFiled > existing-operator deadline).
- Documents: REG-01I's list, §2.6 (evidence of payment ticks itself).
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

Updates and annual confirmations: also blocked unless the linked registration is still Registered; the signatory names are not needed (no certificate). On approval they are applied instead (§4.14).

On approval of a new registration, in one transaction:
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
- `Acknowledged - Awaiting Payment` whose confirmed payments clear the gate (§4.12) → release for evaluation (catches missed releases, e.g. after a settings change); audit `Released for evaluation`. When the reminder setting is set, count unpaid acknowledgements at or past it.
- `Received - Under Review` with determinationDue < today → set `Provisionally Registered` (para 13(4)); audit `Provisional registration`. New registrations only: updates and annual confirmations are never provisionally registered (they show the red SLA light and "Overdue – determine and apply the changes").
- `Deficiency Notice Issued` with response due < today → list as overdue. The Excel asks before lapsing. In the app, show them on the dashboard for a user to lapse; do not auto-lapse.
- Registered with no locked number → lock it (shouldn't happen if approval is transactional).
- Write a summary audit entry: provisional today, overdue deficiency responses, numbers locked, red count, amber count, unpaid/part-paid count.
Run at 06:00 Africa/Lagos.

### 4.11 Evaluation status and recommended outcome
(While Acknowledged - Awaiting Payment and the gate is not cleared, the recommended outcome is "Awaiting Finance confirmation".)
```
evaluationStatus = finalDecision ? 'Decided'
                 : !evaluatingOfficer ? 'Not assigned'
                 : pending > 0 ? 'In progress' : 'Ready for decision'

recommendedOutcome:
  if check 1.3 == 'N' or check 1.4 == 'N' -> 'Redirect to REG-01I / outside scope'
  elif status == Deficiency Notice Issued and today > responseDue -> 'Treat as lapsed (13(2))'
  elif determinationDue and no finalDecision and today > determinationDue -> 'Provisional registration (13(4))'
  elif failed > 0 -> 'Issue deficiency notice (13(1)(b))'
  elif pending > 0 -> 'Evaluation in progress'
  else -> 'Register (13(1)(a))', or 'Accept filing and apply changes (para 16)' for an update or annual confirmation

progress = (satisfied + failed + na) / 56
fileClosed = all 7 post-approval checks are Y or N/A
```

### 4.12 Finance confirmation gate (Commission's updated workbook)
A submission is acknowledged first and evaluated only after Finance has confirmed payment.

```
required  = policy.lateChargeRequiredForRelease ? totalDue : max(0, fee - approvedWaiver)
confirmed = sum(payments not reversed and Confirmed)
cleared   = confirmed >= required
```

- **Process stage** (derived): 1 Acknowledged – awaiting payment (no payment with Finance); 2 Payment with Finance (a Pending payment); 3 Payment confirmed (cleared, release pending); 4 Evaluation and determination (released, open); 5 Closed – {status}.
- **Finance Desk** (Finance role): pending payments, oldest first, with days waiting. **Confirm** requires ticking "verified against bank/Remita" (remarks optional); **Reject** requires a reason. The user who recorded a payment cannot confirm it (also enforced by the database). Audit `Payment confirmed` / `Payment rejected`.
- **Release:** when a confirmation (or a waiver, or a settings change) clears the gate of an `Acknowledged - Awaiting Payment` submission, in the same transaction: status → `Received - Under Review`, `releasedForEvaluationDate = today`, `dateEvaluationStarted = today` if an evaluating officer is assigned and it is empty; audit `Released for evaluation`. The daily review releases any that were missed.
- **Gate:** while not cleared, these are blocked and **every blocked attempt is audited** (`Blocked - awaiting Finance confirmation`, with the action and the amounts): opening the evaluation (open submissions), saving checks, recording the review, mark complete, deficiency notice (issue and draft), approval, the evaluation form PDF and the certificate PDF. **Refusal stays available**, as do show-cause, cancel and officer assignment. A later reversal of a confirmed payment closes the gate again (the status stays as released).
- **Reopen decision:** a Refused or Cancelled submission that was never released goes back to `Acknowledged - Awaiting Payment`.
- **Existing records** (data migration): every submission not yet closed with no Confirmed payment returns to `Acknowledged - Awaiting Payment`, one audit entry each; payments recorded before the gate are Pending. A dry run (`npm run finance-gate:dry-run`) lists the effect first.

---

### 4.13 Category confirmed (official-use box; check 1.10)
- The assigned evaluating officer, or a reviewing supervisor, records the Schedule 3 category the submission belongs in, with a reason when it differs from the form filed. Gated like the other evaluation actions (§4.12); refused once a final decision is recorded; may be confirmed again until then. Audit `Category confirmed`.
- It does not change the fee or the calculated category. If the confirmed category is not the one charged, the record is flagged (§2.12) until the details are corrected or overridden and an admin recalculates (snapshot pricing).
- Check 1.10 "Form filed matches the confirmed category (or accepted and re-categorised with reasons)": pending until confirmed; Y when the confirmed category is the form's; for a different category, Y when wrong forms are accepted and a reason is recorded, otherwise N; N when no form is recorded.
- **Wrong form handling** (setting): *accept and re-categorise* (default) — the confirmed category's form's documents apply (shared keys carry over); *require the correct form* — check 1.10 fails, so the recommended outcome is a deficiency notice, which asks for the right form; the form filed's documents stay.

### 4.14 Updates and annual confirmations (para 16)
- A new record (its own Ack No., Finance gate, EVAL-01 and approval rules, as a registration), linked to a Registered new registration. It never edits the registered record directly.
- The submission page lists what approving it would change, field by field (registered now → after approval), including the tables; certificate fields are marked.
- On approval, in one transaction: the filing → `Changes Applied`, final decision `Accept filing and apply changes (para 16)`, no registration number or certificate; each changed field is copied to the registration and each changed table replaced; a changed certificate field marks the registration "certificate needs reissue". Audited on the registration with every old and new value (`Changes applied`, or `Annual confirmation accepted` with "no changes" when nothing changed) and on the filing.
- A `Changes Applied` decision cannot be reopened (file another update instead) or cancelled.
- Fields an approved filing applies: name, trading name, registrant type, CAC no., incorporation date, TIN, addresses, website, principal LGA, LGAs served, towns/estates, primary and other activities, capacity, customers, licence status and licences, shareholders, directors, MD, compliance officer and contacts, HSE incidents, confidentiality claims, signatories. Not applied: receipt details, form filed, documents, pricing and category override, remarks.
- Annual confirmations are due by the setting's date (31 January) each year after the year of registration. One counts for the calendar year in which it is filed.

### 4.15 Own-use registration with a certificate (setting "own-use gets a certificate", default off)
- While the setting is on, an approving officer (not the user who recorded it) can register a notification whose fee Finance has confirmed in full, whose documents are complete and whose capacity needs notification; data flags block it unless an override reason is given (or outright under the strict flags policy); the signatory names must be set.
- In one transaction: registration number `OGSERC/REG/{yyyy}/I-CPT/{0000}` from the year's registration counter, `certificateIssueDate = today`, CERT-01 produced and stored (§7). Audit `Registered`. The number, date and approver are locked (DB trigger); the notification's details can no longer be edited.

## 5. Roles and separation of duties (new; the Excel has none)

| Role | Can do |
|---|---|
| Registry Officer | Intake, documents checklist, record payments, own-use notifications, print acknowledgement letters |
| Finance Officer | Record payments; confirm or reject payments on the Finance Desk (not ones they recorded, §4.12); reverse payments |
| Evaluating Officer | Complete evaluation checks on assigned submissions, confirm the category, mark complete, draft deficiency notices |
| Reviewing Supervisor | Review evaluations, issue deficiency notices, lapse |
| Approving Officer | Approve and register (or apply an update), refuse, register an own-use notification (when the setting is on) |
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
| 1.10 | auto: §4.13 (pending until the category is confirmed) |
| 3.0 | auto: Y if documentsComplete (the per-form list, §2.6), else N |
| 3.1 | auto-N/A if 3.0 is Y |
| 3.2 | auto-N/A if registrant type is Company or empty |
| 4.3 | auto: N/A if no licence expiry in the table; N if nearest expiry − effectiveDate ≤ window; else Y |
| 4.9 | auto-N/A unless Unlicensed |
| 5.3 | auto-N/A unless waiver > 0 |
| 5.4 | auto: same as 1.9 |
| 5.5 | auto: Y if balance ≤ 0, else N |
| 7.1 | auto-N/A unless Unlicensed |
| 7.3 | auto-N/A unless MSL or multi-State NERC licence |
| 7.5 | auto: N/A (always, on REG-01 submissions) |
| 7.6 | auto: Y if there are no data flags, else N |
| 9.1 | auto: Y if certificate date set and status Registered; N/A for updates and annual confirmations |
| 9.2 | auto: Y if registration number locked; N/A for updates and annual confirmations |
| 9.3–9.5 | auto-N/A for updates and annual confirmations (no certificate); manual otherwise |

**New:** make 2.4 and 4.2 auto-N/A when licence status is Unlicensed. Mighty Power had both marked Y with no licence.

Check texts 1.2 and 7.5 name Form REG-01I (it was OUN-01); 9.6 and 9.7 stay manual for updates and annual confirmations.

---

## 7. Documents to generate (PDF, server-side)

All use the letterhead: "OGUN STATE ELECTRICITY REGULATORY COMMISSION — 5th and 6th Floors, OPIC Building, Oke-Ilewo, Abeokuta, Ogun State · registration@ogserc.gov.ng". Logo: `assets/ogserc-logo.png`. Full wording is in `docs/TEMPLATES.md`.

1. **Acknowledgement letter** (para 10(3)): lists the filing and form, every activity declared, and the per-form documents received and pending
2. **Evaluation form** EVAL-01 (internal): all checks with values, counts, recommended outcome, final decision, registration number, signature lines for the three officers
3. **Deficiency notice** (para 13(1)(b)): outstanding documents (the per-form list), fees, response deadline
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
| OTHER | every other activity, joined with "; ", or "None" |
| AREA | principal LGA, then the other LGAs served (", "), then "; " + towns/estates (if any) |
| LICENCE | Unlicensed/empty → "None — application pending"; else "{status}, No. {numbers}" with every licence number in the table (", "), or just the status if none |
| DAY/MONTH/YEAR | certificate issue date: "22nd", "October", "2026" |
| CHAIR_NAME / COMM_NAME | from Settings. **Block issuing while either is "[Name]" or empty.** |

Own-use certificate (§4.15): NAME, CAC, ADDRESS = site address, CATEGORY "I — {description}", ACTIVITY "Own-use generation, {total kW} kW (para 3(4))", OTHER "None", AREA = LGA, LICENCE "Not applicable (own-use notification)". Its QR code links to `APP_URL/verify/own-use/{id}`.

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
9. The category-form policy points in §1.7 (Supply / retail at 1 MW or more; wrong form handling; other activities' documents; own-use certificates; fees on updates and annual confirmations).
10. REG-01G: is the bulk supply agreement required only for networks supplied by DisCo bulk supply (`g_disco_bulk_supply`)? The forms do not mark it conditional; the condition was inferred.

---

## 10. Dashboard

Key dates: Effective Date, registration deadline, days to deadline.
Submissions: total, registered, provisionally registered, in progress, closed (refused/lapsed/cancelled), own-use notifications, late submissions.
Workflow: overdue (SLA red), due within the warning window (amber), records with flags, average days in queue (open only).
Evaluation: in progress, ready for decision, decided, not assigned.
Money: total due (fees + late charges), collected, collected and bank-verified, outstanding, collection rate.
Breakdowns: by Schedule 3 category (submissions, registered, fees, late charges, waivers, collected, outstanding; Category I comes from own-use notifications); by status; by primary activity code; by principal LGA (registrants + own-use); monthly intake for 12 months from the Effective Date month (submissions, registered by certificate date, collected by payment date).

Also show work queues: my assigned evaluations, overdue deficiency responses awaiting lapse, ready for decision, and **awaiting payment, oldest first** (days since acknowledgement, process stage, "reminder due" when the setting applies, §4.12). Submissions awaiting payment are counted on their own ("Awaiting payment") and stay out of the evaluation counts and queues. Money: collected counts Finance-confirmed payments only; payments still with Finance are shown separately.

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
| Finance gate | New submission; ₦250k fee recorded | "Acknowledged - Awaiting Payment", stage 2, amount paid ₦0, evaluation and approval blocked (attempts audited) |
| Finance gate | ₦100k confirmed, then ₦150k confirmed (fee ₦250k) | not released after the first; released ("Received - Under Review") by the second, in the same transaction |
| Finance gate | Fee confirmed, late charge unpaid | released by default; not released when "late charge required to release" is on |
| Separation | Finance officer confirms a payment they recorded | refused |
| Forms | GEN 5 MW on REG-01D | REG-01D's 12-item list; 1.10 pending until the category is confirmed, then Y |
| Highest applies | GEN 5 MW + MET (H) + EST (G) | Category G |
| Supply / retail | SUP 2 MW | K by default; F when the setting is F; SUP 0.5 MW stays K |
| Wrong form | GEN 5 MW filed on REG-01K, confirmed D with a reason | accept: 1.10 Y, REG-01D's documents apply; require: 1.10 N, flag "must file on REG-01D", recommended outcome deficiency notice |
| Conditions | REG-01D, generation for sale = N | "PPAs and offtake" N/A automatically |
| Evidence of payment | fee ₦250k: pending payment / confirmed / reversed / fully waived | blank / Y / blank / N/A |
| Finance gate + documents | all documents in, fee recorded but pending | gate closed, evidence of payment outstanding, not complete; confirmed → complete |
| Update | update of a Registered record, no fee setting | fee ₦0, no late charge, released at intake; approval → Changes Applied, changes applied to the registration with old → new audit, certificate needs reissue, no new number |
| Annual confirmation | registration in 2026; none filed by 31 Jan 2027 | 1 Feb 2027: registration flagged overdue; one filed 20 Jan 2027 clears it; filed 1 Feb 2027 → flagged late |
| Licences | expiries 2029 and ED + 100 days | renewal flag from the nearer one |
| Own-use units | 400 + 250 kW | 650 kW, notification required, Category I fee |
| Own-use certificate | setting off / on, paid, complete | blocked / `OGSERC/REG/{yyyy}/I-CPT/0001` and CERT-01 |
| Migration | old record, category E, 13 items all Y, licence no. and expiry, secondary EST | REG-01E, New registration; 9 values carried over (7, 9, 12, 13 not); one licence row; EST as other activity; audit entry lists what was not carried over |
