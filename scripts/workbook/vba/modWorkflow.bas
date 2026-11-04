Attribute VB_Name = "modWorkflow"
' Status workflow (SPEC 4.4 to 4.9, 4.14). Each action lists every reason it is blocked.
' Separation of duties compares typed officer names: a reminder, not a control (see Guide).
Option Explicit

Public Sub MarkComplete(): Dim a As String: a = SelectedAck(): If a <> "" Then MarkCompleteFor a
End Sub
Public Sub IssueDeficiency(): Dim a As String: a = SelectedAck(): If a <> "" Then IssueDeficiencyFor a
End Sub
Public Sub ApproveAndRegister(): Dim a As String: a = SelectedAck(): If a <> "" Then ApproveFor a
End Sub
Public Sub LapseSubmission(): Dim a As String: a = SelectedAck(): If a <> "" Then LapseFor a
End Sub
Public Sub RefuseSubmission(): Dim a As String: a = SelectedAck(): If a <> "" Then RefuseFor a
End Sub
Public Sub CancelSubmission(): Dim a As String: a = SelectedAck(): If a <> "" Then CancelFor a
End Sub

Private Function LoadRows(ByVal ack As String, ByRef lo As ListObject, ByRef r As Long, ByRef ev As ListObject, ByRef er As Long) As Boolean
    Set lo = T("tblRegister"): Set ev = T("tblEvaluation")
    r = FindRow(lo, "Ack No.", ack): er = FindRow(ev, "Ack No.", ack)
    If r = 0 Or er = 0 Then Tell "No submission " & ack & " (with an evaluation row)." Else LoadRows = True
End Function

' --- 4.4 Mark complete -------------------------------------------------------------------------
Public Sub MarkCompleteFor(ByVal ack As String)
    Dim lo As ListObject, r As Long, ev As ListObject, er As Long, due As Date, reopens As Boolean, shortfall As Double, req As Double
    BeginAction
    On Error GoTo Failed
    If Not LoadRows(ack, lo, r, ev, er) Then GoTo Done
    If Not GateOk(ack, "Mark complete") Then GoTo Done
    If Not (SameName(CurrentUser(), GetS(ev, er, "Evaluating Officer")) Or SameName(CurrentUser(), GetS(ev, er, "Reviewing Supervisor"))) Then
        Tell "Only the assigned evaluating officer or a reviewing supervisor can do this.": GoTo Done
    End If
    If GetS(lo, r, "Closed") = "Yes" Then Tell "Cannot mark complete: submission is closed (" & GetS(lo, r, "Status") & ").": GoTo Done
    If GetS(lo, r, "Submission Complete") <> "Yes" Then
        req = IIf(IsOn("cfgLateBlocksComplete"), GetN(lo, r, "Total Due"), GetN(lo, r, "Net Fee"))
        shortfall = req - GetN(lo, r, "Amount Paid"): If shortfall < 0 Then shortfall = 0
        Tell "The submission is not complete." & vbLf & _
            IIf(GetS(lo, r, "Outstanding Documents") = "", "", "Outstanding: " & Replace(GetS(lo, r, "Outstanding Documents"), "; ", vbLf & "Outstanding: ") & vbLf) & _
            IIf(shortfall > 0, "Unpaid: " & Naira(shortfall) & vbLf, "") & "Obtain these, or issue a deficiency notice (para 13(1)(b))."
        GoTo Done
    End If
    reopens = (GetS(lo, r, "Status") = ST_DEFICIENCY)
    If GetS(lo, r, "Date Submission Complete") <> "" And Not reopens Then Tell "Already complete; determination due " & LongDate(GetV(lo, r, "Determination Due")) & ".": GoTo Done
    If GetS(lo, r, "Date Submission Complete") = "" Then SetV lo, r, "Date Submission Complete", AsOf()
    If reopens Then SetV lo, r, "Status", ST_RECEIVED
    Application.Calculate
    Audit "Submission complete", ack, "Determination due " & LongDate(GetV(lo, r, "Determination Due")) & _
        IIf(reopens, "; response to the deficiency notice received " & LongDate(AsOf()) & ", back to Received - Under Review", "")
    Tell "Marked complete. Determination due " & LongDate(GetV(lo, r, "Determination Due")) & " (para 13(1))."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Mark complete failed: " & Err.Description
    Resume Done
End Sub

' --- 4.5 Deficiency notice ----------------------------------------------------------------------
Public Sub IssueDeficiencyFor(ByVal ack As String)
    Dim lo As ListObject, r As Long, ev As ListObject, er As Long, noticeRef As String, due As Date, n As Long, i As Long
    BeginAction
    On Error GoTo Failed
    If Not LoadRows(ack, lo, r, ev, er) Then GoTo Done
    If Not GateOk(ack, "Deficiency notice") Then GoTo Done
    If GetS(ev, er, "Reviewing Supervisor") <> "" And Not SameName(CurrentUser(), GetS(ev, er, "Reviewing Supervisor")) Then
        Tell "Only the reviewing supervisor (" & GetS(ev, er, "Reviewing Supervisor") & ") issues deficiency notices.": GoTo Done
    End If
    If GetS(lo, r, "Closed") = "Yes" Then Tell "A deficiency notice cannot be issued: submission is closed (" & GetS(lo, r, "Status") & ").": GoTo Done
    If GetS(lo, r, "Status") = ST_DEFICIENCY Then Tell "A deficiency notice is already outstanding: mark the submission complete or lapse it.": GoTo Done
    If GetN(ev, er, "Failed") = 0 And GetS(lo, r, "Submission Complete") = "Yes" Then
        If Not Ask("No checks have failed and the submission is complete. Issue a deficiency notice anyway?") Then GoTo Done
    End If
    ' A second or later notice on the same submission gets a -2, -3 ... suffix.
    For i = 1 To T("tblAudit").ListRows.Count
        If GetS(T("tblAudit"), i, "Reference") = ack And GetS(T("tblAudit"), i, "Action") = "Deficiency notice issued" Then n = n + 1
    Next i
    noticeRef = CStr(Setting("cfgDefPrefix")) & "/" & Year(AsOf()) & "/" & Mid$(ack, InStrRev(ack, "/") + 1) & IIf(n > 0, "-" & (n + 1), "")
    due = AsOf() + CLng(Setting("cfgDeficiencyDays"))
    SetV lo, r, "Status", ST_DEFICIENCY
    SetV lo, r, "Deficiency Notice Date", AsOf()
    Audit "Deficiency notice issued", ack, noticeRef & "; response due " & LongDate(due) & "; " & _
        (GetN(lo, r, "Documents Outstanding") + GetN(lo, r, "Documents Pending")) & " document(s) outstanding; balance " & _
        Naira(IIf(GetN(lo, r, "Balance") > 0, GetN(lo, r, "Balance"), 0)) & "; " & GetN(ev, er, "Failed") & " check(s) failed"
    Tell "Deficiency notice " & noticeRef & " recorded; response due " & LongDate(due) & ". Produce the notice from the web app."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Deficiency notice failed: " & Err.Description
    Resume Done
End Sub

' --- 4.6 Approve and register / apply an update (4.14) -------------------------------------------
Public Sub ApproveFor(ByVal ack As String)
    Dim lo As ListObject, r As Long, ev As ListObject, er As Long, blockers As String, regNo As String
    Dim linked As Boolean, lr As Long, overridden As String, changes As String, nChanges As Long, reissue As Boolean
    BeginAction
    On Error GoTo Failed
    If Not LoadRows(ack, lo, r, ev, er) Then GoTo Done
    If GetS(lo, r, "Closed") <> "Yes" Then
        If Not GateOk(ack, "Approval") Then GoTo Done
    End If
    Application.Calculate
    blockers = GetS(ev, er, "Approval Blockers")
    If GetS(ev, er, "Approving Officer") <> "" And Not SameName(CurrentUser(), GetS(ev, er, "Approving Officer")) Then
        blockers = "Only the assigned approving officer can decide" & IIf(blockers = "", "", vbLf & blockers)
    End If
    If blockers <> "" Then Tell "Approval is blocked:" & vbLf & blockers: GoTo Done
    If GetN(lo, r, "Flag Count") > 0 Then overridden = "; " & GetN(lo, r, "Flag Count") & " data flag(s) overridden: " & GetS(ev, er, "Flag Override Reason")
    linked = (GetS(lo, r, "Filing Type") <> FILING_NEW)
    If GetS(lo, r, "Date Submission Complete") = "" Then SetV lo, r, "Date Submission Complete", AsOf()
    If GetS(ev, er, "Review Date") = "" Then SetV ev, er, "Review Date", AsOf()
    SetV ev, er, "Approval Date", AsOf()
    If linked Then
        lr = FindRow(lo, "Registration No.", GetS(lo, r, "Linked Registration No."))
        ApplyChanges lo, r, lr, changes, nChanges, reissue
        SetV lo, r, "Status", ST_APPLIED
        SetV ev, er, "Final Decision", "Accept filing and apply changes (para 16)"
        If nChanges = 0 And GetS(lo, r, "Filing Type") = FILING_ANNUAL Then
            Audit "Annual confirmation accepted", GetS(lo, lr, "Ack No."), ack & ": no changes"
        Else
            Audit "Changes applied", GetS(lo, lr, "Ack No."), ack & ": " & IIf(changes = "", "no changes", changes) & IIf(reissue, "; certificate needs reissue", "")
        End If
        Audit "Changes applied", ack, "Approved by " & CurrentUser() & "; changes applied to " & GetS(lo, lr, "Registration No.") & ": " & nChanges & " change(s)" & IIf(reissue, "; certificate needs reissue", "") & overridden
        Tell "Changes applied to " & GetS(lo, lr, "Registration No.") & " (" & nChanges & " change(s))." & IIf(reissue, " The certificate needs reissue (web app).", "")
    Else
        regNo = CStr(Setting("cfgRegPrefix")) & "/" & Year(AsOf()) & "/" & GetS(lo, r, "Category Applied") & "-" & GetS(lo, r, "Primary Code") & "/" & Pad(NextRegistrationSerial(Year(AsOf())), 4)
        SetV lo, r, "Certificate Issue Date", AsOf()
        SetV lo, r, "Registration No.", regNo
        SetV lo, r, "Status", ST_REGISTERED
        SetV ev, er, "Final Decision", "Register (13(1)(a))"
        Audit "Registered", ack, regNo & " - approved by " & CurrentUser() & overridden
        Tell "Registered as " & regNo & ". Issue the CERT-01 certificate from the web app."
    End If
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Approval failed: " & Err.Description
    Resume Done
End Sub

' Copy each changed field of an approved filing to its registration (filing.ts FILING_FIELDS).
Private Sub ApplyChanges(ByVal lo As ListObject, ByVal r As Long, ByVal lr As Long, ByRef changes As String, ByRef n As Long, ByRef reissue As Boolean)
    Dim fields As Variant, certFields As String, i As Long, f As String, before As String, after As String
    fields = Array("Registered Name", "Trading Name", "Registrant Type", "CAC No.", "TIN", "Registered Address", _
        "Principal LGA", "Other LGAs Served", "Towns / Estates Served", "Primary Activity", "Other Activity 1", _
        "Other Activity 2", "Other Activity 3", "Installed Capacity (MW)", "Customers", "Licence Status", _
        "Licence 1 No.", "Licence 1 Expiry", "Licence 2 No.", "Licence 2 Expiry", "Licence 3 No.", "Licence 3 Expiry", _
        "Compliance Officer", "Phone", "Email")
    certFields = "|Registered Name|CAC No.|Registered Address|Principal LGA|Other LGAs Served|Towns / Estates Served|Primary Activity|Other Activity 1|Other Activity 2|Other Activity 3|Licence Status|Licence 1 No.|Licence 2 No.|Licence 3 No.|Licence 1 Expiry|Licence 2 Expiry|Licence 3 Expiry|"
    For i = LBound(fields) To UBound(fields)
        f = fields(i)
        before = GetS(lo, lr, f): after = GetS(lo, r, f)
        If before <> after Then
            SetV lo, lr, f, GetV(lo, r, f)
            changes = changes & IIf(changes = "", "", "; ") & f & ": " & IIf(before = "", "(blank)", before) & " " & ARROW() & " " & IIf(after = "", "(blank)", after)
            n = n + 1
            If InStr(certFields, "|" & f & "|") > 0 Then reissue = True
        End If
    Next i
    If reissue Then SetV lo, lr, "Certificate Needs Reissue", "Y"
End Sub

' --- 4.7 Lapse ----------------------------------------------------------------------------------
Public Sub LapseFor(ByVal ack As String)
    Dim lo As ListObject, r As Long, ev As ListObject, er As Long, due As Variant
    BeginAction
    On Error GoTo Failed
    If Not LoadRows(ack, lo, r, ev, er) Then GoTo Done
    If GetS(lo, r, "Status") <> ST_DEFICIENCY Then Tell "The submission cannot lapse yet: only a submission with a deficiency notice issued can lapse.": GoTo Done
    due = GetV(lo, r, "Deficiency Response Due")
    If Not IsDate(due) Or CStr(due) = "" Then Tell "The submission cannot lapse yet: no deficiency notice date recorded.": GoTo Done
    If Not (AsOf() > CDate(due)) Then Tell "The submission cannot lapse yet. The response period runs until " & LongDate(due) & ".": GoTo Done
    SetV lo, r, "Status", ST_LAPSED
    SetV ev, er, "Final Decision", "Treat as lapsed (13(2))"
    SetV ev, er, "Approval Date", AsOf()
    Audit "Lapsed", ack, "No complete response by " & LongDate(due) & " (para 13(2))"
    Tell ack & " has lapsed (para 13(2)). A fresh application is needed."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Lapse failed: " & Err.Description
    Resume Done
End Sub

' --- 4.8 Refuse ---------------------------------------------------------------------------------
Public Sub RefuseFor(ByVal ack As String)
    Dim lo As ListObject, r As Long, ev As ListObject, er As Long, errs As String, sc As Variant, ground As String, details As String, choice As String, reasons As String
    BeginAction
    On Error GoTo Failed
    If Not LoadRows(ack, lo, r, ev, er) Then GoTo Done
    If GetS(lo, r, "Closed") = "Yes" Then errs = errs & vbLf & "Submission is closed (" & GetS(lo, r, "Status") & ")"
    sc = GetV(lo, r, "Show-Cause Date")
    If Not IsDate(sc) Or CStr(sc) = "" Then
        errs = errs & vbLf & "No show-cause notice date recorded"
    ElseIf AsOf() - CDate(sc) < CLng(Setting("cfgShowCauseDays")) Then
        errs = errs & vbLf & "The " & Setting("cfgShowCauseDays") & "-day show-cause period has not ended"
    End If
    If GetS(ev, er, "Approving Officer") = "" Then
        errs = errs & vbLf & "No approving officer assigned"
    ElseIf Not SameName(CurrentUser(), GetS(ev, er, "Approving Officer")) Then
        errs = errs & vbLf & "Only the assigned approving officer can decide"
    End If
    If SameName(GetS(ev, er, "Approving Officer"), GetS(ev, er, "Evaluating Officer")) Then errs = errs & vbLf & "The approving officer cannot be the evaluating officer"
    If SameName(GetS(ev, er, "Approving Officer"), GetS(ev, er, "Reviewing Supervisor")) Then errs = errs & vbLf & "The approving officer cannot be the reviewing supervisor"
    If SameName(GetS(ev, er, "Approving Officer"), GetS(lo, r, "Created By")) Then errs = errs & vbLf & "The approving officer cannot be the user who created the submission"
    If SameName(GetS(ev, er, "Reviewing Supervisor"), GetS(ev, er, "Evaluating Officer")) Then errs = errs & vbLf & "The reviewing supervisor cannot be the evaluating officer"
    If errs <> "" Then Tell "Refusal is blocked:" & errs: GoTo Done
    choice = AskText("Grounds for refusal (paras 13(3), 20). Type 1, 2 or 3:" & vbLf & "1 False or misleading information" & vbLf & "2 Non-payment of fees or charges" & vbLf & "3 Activity outside the scope of the Order", "1")
    Select Case choice
        Case "1": ground = "False or misleading information"
        Case "2": ground = "Non-payment of fees or charges"
        Case "3": ground = "Activity outside the scope of the Order"
        Case Else: Tell "Refusal is blocked: grounds must be one allowed by the Order.": GoTo Done
    End Select
    details = AskText("Details (optional):")
    reasons = ground & IIf(details = "", "", ": " & details)
    SetV lo, r, "Status", ST_REFUSED
    SetV ev, er, "Final Decision", "Refuse (13(3)) - after show-cause"
    SetV ev, er, "Reasons", reasons
    SetV ev, er, "Approval Date", AsOf()
    Audit "Refused", ack, reasons
    Tell ack & " refused: " & reasons
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Refusal failed: " & Err.Description
    Resume Done
End Sub

' --- 4.9 Cancel (Admin; para 14) ----------------------------------------------------------------
Public Sub CancelFor(ByVal ack As String)
    Dim lo As ListObject, r As Long, ev As ListObject, er As Long, st As String, reason As String
    BeginAction
    On Error GoTo Failed
    If Not LoadRows(ack, lo, r, ev, er) Then GoTo Done
    st = GetS(lo, r, "Status")
    If st = ST_CANCELLED Or st = ST_REFUSED Or st = ST_LAPSED Or st = ST_APPLIED Then Tell "Submission is already closed (" & st & ").": GoTo Done
    reason = AskText("Admin only. Reason for cancelling " & ack & " (para 14):")
    If reason = "" Then Tell "A reason is required.": GoTo Done
    SetV lo, r, "Status", ST_CANCELLED
    Audit "Cancelled", ack, reason & " (was " & st & ")"
    Tell ack & " cancelled."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Cancel failed: " & Err.Description
    Resume Done
End Sub
