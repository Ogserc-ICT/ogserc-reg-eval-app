# Output templates (wording copied from the workbook)

Merge fields are written as `{{field}}`. Dates are formatted "22 October 2026" unless noted. Money is formatted "₦500,000".

Letterhead on every letter:
> OGUN STATE ELECTRICITY REGULATORY COMMISSION
> 5th and 6th Floors, OPIC Building, Oke-Ilewo, Abeokuta, Ogun State · registration@ogserc.gov.ng

---

## 1. Acknowledgement of Registration Submission

**ACKNOWLEDGEMENT OF REGISTRATION SUBMISSION**

| | |
|---|---|
| Our ref. | {{ackNo}} |
| Date | {{dateSubmitted}} |
| To | {{registeredName}} |
| Address | {{address}} |
| Attention | {{complianceOfficer}} |

**RE: ACKNOWLEDGEMENT OF REGISTRATION SUBMISSION — {{ackNo}}**

The Ogun State Electricity Regulatory Commission acknowledges receipt of your submission for registration under Order No. OGSERC/ORD/2026/001. This acknowledgement is issued under paragraph 10(3) of the Order. Your submission has been entered in the Register under the acknowledgement number above. Please quote it in all correspondence and as the reference for any payment.

**1. Your submission**

| | |
|---|---|
| Date received (para 10(3)) | {{dateSubmitted}} by {{submissionChannel}} |
| Activities declared | {{primaryActivity}}{{#secondaryActivity}}; {{secondaryActivity}}{{/secondaryActivity}} |
| Installed capacity | {{installedCapacityMw, 2dp}} MW |
| Schedule 3 category (provisional) | Category {{categoryApplied}} — {{categoryDescription}} (subject to evaluation) |
| Registration fee for the category | {{fee}} |
| Payment received to date | {{amountPaid}}; balance {{balance}} |
| Filed within the Registration Period? | {{daysLate == 0 ? "Yes" : "No — {{daysLate}} days late; late charge {{lateCharge}}"}} |

**2. Documents received (Schedule 2) — a record of receipt, not yet evaluated**

Received: {{receivedList}}

Pending: {{outstandingList or "none"}} — please supply these, or state the reason and propose a completion date (para 12(4)).

> Note: the Excel prints "Pending: none — please supply these…", which reads oddly. When nothing is pending, print "Pending: none." only.

**3. What happens next**

1. Evaluation. The Commission will now evaluate your submission. It is complete when it includes the information and documents required by paragraph 12 and evidence of payment of the registration fee (paragraph 13(1)).
2. Decision within 30 days. Within thirty (30) days of receiving a complete submission, the Commission will either issue a Registration Certificate bearing a unique OGSERC registration number (paragraph 13(1)(a)) or notify you in writing of any missing or deficient information (paragraph 13(1)(b)).
3. Deficiency notice. If you receive one, you must supply the information within fourteen (14) days, or your submission will lapse and you will be treated as not registered (paragraph 13(2)).
4. Provisional registration. If the Commission has not acted within thirty (30) days of receiving your complete submission, you are provisionally registered from the next day, and the acknowledgement number above serves as your registration number (paragraph 13(4)).
5. Verification. Authorized officers may inspect your installations, meters and records on not less than forty-eight (48) hours' notice (paragraph 22).
6. Refusal only on stated grounds, after written reasons and fourteen (14) days to respond (paragraphs 13(3) and 20).

(The day counts in items 2–4 come from Settings.)

**4. Your obligations in the meantime**

(a) Registration is not a licence and does not authorize any activity that requires one (paragraph 11(3)).
(b) Notify the Commission in writing within fourteen (14) days of any material change in the information submitted (paragraph 16(1)).
(c) Information claimed as commercially sensitive is treated as confidential until the Commission decides the claim (paragraph 15(3)); personal data is processed under the Nigeria Data Protection Act, 2023 (paragraph 15(4)).
{{#unlicensed}}(d) As you are not licensed, you must apply for the appropriate licence or permit by {{licenceApplicationDue}}. Until it is decided, maintain safe and continuous supply, connect no new customers and extend no network without written approval, and charge no tariff above that in force on the Effective Date (paragraph 18).{{/unlicensed}}

This acknowledgement is not a Registration Certificate.

Yours faithfully,

______________________________
{{evaluatingOfficer or signing user}}
For: Ogun State Electricity Regulatory Commission

---

## 2. Notice of Deficiency

| | |
|---|---|
| Our ref. | OGSERC/DEF/{{yyyy}}/{{ackSerial}} |
| Date of notice | {{deficiencyNoticeDate}} |
| To | {{registeredName}} |
| Address | {{address}} |
| Attention | {{complianceOfficer}} |

**RE: NOTICE OF DEFICIENCY IN REGISTRATION SUBMISSION — {{ackNo}}**

The Commission acknowledges receipt of your submission dated {{dateSubmitted}} for registration under Order No. OGSERC/ORD/2026/001 (Category {{categoryApplied}}). On review, the submission is incomplete for the reasons set out below.

Outstanding documents (Schedule 2):
{{outstandingList or "None"}}

{{#failedChecks}}Other deficiencies found in evaluation:
{{failedCheckTexts}}{{/failedChecks}}

> New: the Excel lists only documents and fees. Include the text of any failed evaluation checks and the evaluator's remarks, since those are often the actual deficiency.

Fees and charges:
Total due {{totalDue}}; paid {{amountPaid}}; balance {{balance}}

Under paragraph 13(1)(b) of the Order, you are required to supply the outstanding information and payment by {{deficiencyResponseDue}}. If they are not received by that date, your submission will lapse and you will be treated as not registered (paragraph 13(2)), without prejudice to your right to submit a fresh application.

Please quote the acknowledgement number above in all correspondence.

______________________________
For: Ogun State Electricity Regulatory Commission

---

## 3. Certificate of Registration (CERT-01, A4 landscape)

Background: `assets/cert-security-background.png`. Top right: "Certificate Serial No.: {{SERIAL}}". Footer: "Form OGSERC/CERT-01 · Version 2026.1".

> OGUN STATE ELECTRICITY REGULATORY COMMISSION
> Established under the Ogun State Power Law, 2024
>
> **CERTIFICATE OF REGISTRATION**
> Register of Licensees and Electricity Operators in Ogun State
>
> Registration No.  **{{REG_NO}}**
>
> This is to certify that
> **{{NAME}}**
> RC / Registration No. {{CAC}}   of   {{ADDRESS}}
>
> has been entered in the Register of Licensees and Electricity Operators maintained by the Commission under paragraph 15 of the OGSERC Order on Commencement of Operations and Registration of Licensees and Electricity Operators, 2026, with the following particulars:

| | |
|---|---|
| Registration category (Schedule 3) | {{CATEGORY}} |
| Primary activity | {{ACTIVITY}} |
| Other activities | {{OTHER}} |
| Principal LGA and service area | {{AREA}} |
| Licence / permit held | {{LICENCE}} |

> Issued at Abeokuta this {{DAY}} day of {{MONTH}}, {{YEAR}}
>
> [COMMISSION SEAL placeholder]
>
> ______________________________  ______________________________
> {{CHAIR_NAME}}  {{COMM_NAME}}
> Chairman / Chief Executive Officer  Commissioner
> Ogun State Electricity Regulatory Commission  Ogun State Electricity Regulatory Commission
>
> *This certificate is evidence of registration only. It is not a licence or permit and does not authorize any activity that requires one (para 13(5)). It remains valid until cancelled under paragraph 14, subject to annual confirmation by 31 January each year (para 16(2)). The registration number must be quoted on all correspondence and filings with the Commission and on customer bills issued in Ogun State (para 13(6)). Any material change must be notified within fourteen (14) days (para 16(1)).*

Shrink long names and addresses to fit (the Excel's `FitText` reduces the font size for long strings, with a minimum size). Add a QR code linking to a verification URL (new, optional; see CLAUDE.md phase 7).

---

## 4. Evaluation form EVAL-01 (internal)

Header: Acknowledgement No., Registrant, "Category / activity" ({{cat}} — {{primaryActivity}}), Evaluating officer, Reviewing supervisor, Approving officer, Date evaluation started.

Then each stage heading with its checks: `{{id}} | {{text}} | {{value}}`.

RESULT AND DECISION:
- Checks satisfied / failed / N/A / pending: `{{y}} / {{n}} / {{na}} / {{pending}}`
- Recommended outcome (automatic)
- Final decision
- Reasons / comments
- Registration No.
- Three signature rows: Evaluating officer, Reviewing supervisor, Approving officer, each with "Signature / date"

POST-APPROVAL ACTIONS: checks 9.1–9.7.
