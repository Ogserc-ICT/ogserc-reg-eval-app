Attribute VB_Name = "modPayments"
' Payments ledger and the Finance confirmation gate (SPEC 4.2, 4.12; docs/DECISIONS.md).
' Only payments Finance has confirmed count. Payments are never deleted: they are reversed.
Option Explicit

Public Sub NewPaymentRow()
    Dim lo As ListObject, r As Long
    BeginAction
    Set lo = T("tblPayments")
    r = AddRow(lo)
    SetV lo, r, "Date Received", AsOf()
    EndAction
    lo.DataBodyRange.Cells(r, lo.ListColumns("Reference").Index).Select
End Sub

Public Sub RecordPayment()
    Dim r As Long
    r = SelectedRow(T("tblPayments"))
    If r = 0 Then Tell "Select the new payment row on the Payments sheet first.": Exit Sub
    RecordPaymentAt r
End Sub

' The payment selected on the Finance Desk (or on the Payments sheet).
Private Function SelectedPayment() As Long
    Dim lo As ListObject, no As String
    Set lo = T("tblPayments")
    If ActiveSheet.Name = "Finance Desk" Then
        If ActiveCell.Row >= 7 Then no = CStr(ActiveSheet.Cells(ActiveCell.Row, 1).Value)
        SelectedPayment = FindRow(lo, "Payment No.", no)
    ElseIf ActiveSheet.Name = "Payments" Then
        SelectedPayment = SelectedRow(lo)
    End If
    If SelectedPayment = 0 Then Tell "Select a payment on the Finance Desk (or the Payments sheet) first."
End Function

Public Sub ConfirmSelectedPayment()
    Dim r As Long
    r = SelectedPayment(): If r > 0 Then ConfirmPaymentAt r
End Sub

Public Sub RejectSelectedPayment()
    Dim r As Long
    r = SelectedPayment(): If r > 0 Then RejectPaymentAt r
End Sub

Public Sub ReversePayment()
    Dim r As Long
    r = SelectedPayment(): If r > 0 Then ReversePaymentAt r
End Sub

Public Sub RecordPaymentAt(ByVal r As Long)
    Dim lo As ListObject, errs As String, ref As String, rrr As String, i As Long, no As String, v As Variant
    Set lo = T("tblPayments")
    BeginAction
    On Error GoTo Failed
    If GetS(lo, r, "Payment No.") <> "" Then Tell "Already recorded as " & GetS(lo, r, "Payment No.") & ".": GoTo Done
    v = GetV(lo, r, "Date Received")
    If Not IsDate(v) Then
        errs = errs & vbLf & "- Date received is required"
    ElseIf CDate(v) > AsOf() Then
        errs = errs & vbLf & "- Date received cannot be in the future"
    End If
    ref = GetS(lo, r, "Reference")
    If FindRow(T("tblRegister"), "Ack No.", ref) = 0 And FindRow(T("tblOwnUse"), "OUN No.", ref) = 0 Then
        errs = errs & vbLf & "- Reference must be an existing Ack No. or OUN No."
    End If
    If GetN(lo, r, "Amount") <= 0 Then errs = errs & vbLf & "- Amount must be more than zero"
    If errs <> "" Then Tell "The payment was not recorded:" & errs: GoTo Done
    rrr = GetS(lo, r, "RRR / Bank Reference")
    If rrr <> "" Then
        For i = 1 To lo.ListRows.Count
            If i <> r And LCase$(GetS(lo, i, "RRR / Bank Reference")) = LCase$(rrr) Then
                If Not Ask("RRR / bank reference " & rrr & " is already on " & GetS(lo, i, "Payment No.") & ". Record it anyway?") Then GoTo Done
                Exit For
            End If
        Next i
    End If
    no = CStr(Setting("cfgPayPrefix")) & "/" & Year(CDate(v)) & "/" & Pad(NextSerial("cfgNextPay"), 5)
    SetV lo, r, "Payment No.", no
    SetV lo, r, "Recorded By", CurrentUser()
    SetV lo, r, "Recorded On", NowStamp()
    SetV lo, r, "Finance Status", "Pending"
    Audit "Payment recorded", ref, Naira(GetN(lo, r, "Amount")) & " - ref " & IIf(rrr = "", "(none)", rrr) & " - " & no
    Tell "Recorded as " & no & ". It counts once Finance confirms it on the Finance Desk."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Record payment failed: " & Err.Description
    Resume Done
End Sub

Public Sub ConfirmPaymentAt(ByVal r As Long)
    Dim lo As ListObject, remarks As String, ref As String
    Set lo = T("tblPayments")
    BeginAction
    On Error GoTo Failed
    If GetS(lo, r, "Payment No.") = "" Then Tell "Record the payment first.": GoTo Done
    If GetS(lo, r, "Reversed") = "Y" Then Tell "A reversed payment cannot be confirmed.": GoTo Done
    If GetS(lo, r, "Finance Status") <> "Pending" Then Tell "This payment is already " & GetS(lo, r, "Finance Status") & ": Finance decisions are final.": GoTo Done
    If SameName(CurrentUser(), GetS(lo, r, "Recorded By")) Then
        Tell "Refused: the officer who recorded a payment cannot confirm a payment they recorded (SPEC 4.12). Ask another Finance officer.": GoTo Done
    End If
    If Not Ask("Confirm " & GetS(lo, r, "Payment No.") & " (" & Naira(GetN(lo, r, "Amount")) & ", ref " & GetS(lo, r, "RRR / Bank Reference") & "). Have you verified it against the bank / Remita?") Then
        Tell "Not confirmed: confirming requires the bank / Remita check.": GoTo Done
    End If
    remarks = AskText("Remarks (optional):")
    SetV lo, r, "Finance Status", "Confirmed"
    SetV lo, r, "Verified with Bank", "Y"
    SetV lo, r, "Decided By", CurrentUser()
    SetV lo, r, "Decided On", NowStamp()
    If remarks <> "" Then SetV lo, r, "Finance Remarks", remarks
    ref = GetS(lo, r, "Reference")
    Audit "Payment confirmed", ref, Naira(GetN(lo, r, "Amount")) & " - " & GetS(lo, r, "Payment No.") & " - verified with bank/Remita" & IIf(remarks = "", "", "; " & remarks)
    Application.Calculate
    If TryRelease(ref) Then Tell "Payment confirmed. " & ref & " is released for evaluation." Else Tell "Payment confirmed."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Confirm failed: " & Err.Description
    Resume Done
End Sub

Public Sub RejectPaymentAt(ByVal r As Long)
    Dim lo As ListObject, reason As String
    Set lo = T("tblPayments")
    BeginAction
    On Error GoTo Failed
    If GetS(lo, r, "Finance Status") <> "Pending" Or GetS(lo, r, "Reversed") = "Y" Then Tell "Only a pending payment can be rejected.": GoTo Done
    reason = AskText("Reason for rejecting " & GetS(lo, r, "Payment No.") & ":")
    If reason = "" Then Tell "A reason is required.": GoTo Done
    SetV lo, r, "Finance Status", "Rejected"
    SetV lo, r, "Decided By", CurrentUser()
    SetV lo, r, "Decided On", NowStamp()
    SetV lo, r, "Finance Remarks", reason
    Audit "Payment rejected", GetS(lo, r, "Reference"), Naira(GetN(lo, r, "Amount")) & " - " & GetS(lo, r, "Payment No.") & ": " & reason
    Tell "Payment rejected."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Reject failed: " & Err.Description
    Resume Done
End Sub

Public Sub ReversePaymentAt(ByVal r As Long)
    Dim lo As ListObject, reason As String
    Set lo = T("tblPayments")
    BeginAction
    On Error GoTo Failed
    If GetS(lo, r, "Reversed") = "Y" Then Tell "Already reversed (a reversal is final).": GoTo Done
    If GetS(lo, r, "Finance Status") = "Rejected" Then Tell "A rejected payment never counted, so it cannot be reversed.": GoTo Done
    reason = AskText("Finance or Admin only. Reason for reversing " & GetS(lo, r, "Payment No.") & ":")
    If reason = "" Then Tell "A reason is required.": GoTo Done
    SetV lo, r, "Reversed", "Y"
    SetV lo, r, "Reversed By", CurrentUser()
    SetV lo, r, "Reversed On", NowStamp()
    SetV lo, r, "Reversal Reason", reason
    Audit "Payment reversed", GetS(lo, r, "Reference"), Naira(GetN(lo, r, "Amount")) & " - " & GetS(lo, r, "Payment No.") & ": " & reason
    Tell "Payment reversed. A released submission stays released, but its gate is closed again until payments are confirmed."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Reverse failed: " & Err.Description
    Resume Done
End Sub

' Release for evaluation once confirmed payments clear the gate (SPEC 4.12). True if released.
Public Function TryRelease(ByVal ack As String) As Boolean
    Dim lo As ListObject, r As Long, ev As ListObject, er As Long
    Application.Calculate
    Set lo = T("tblRegister")
    r = FindRow(lo, "Ack No.", ack)
    If r = 0 Then Exit Function
    If GetS(lo, r, "Status") <> ST_AWAITING Or GetS(lo, r, "Gate Cleared") <> "Yes" Then Exit Function
    SetV lo, r, "Status", ST_RECEIVED
    SetV lo, r, "Released for Evaluation", AsOf()
    Set ev = T("tblEvaluation")
    er = FindRow(ev, "Ack No.", ack)
    If er > 0 Then
        If GetS(ev, er, "Evaluating Officer") <> "" And GetS(ev, er, "Date Evaluation Started") = "" Then SetV ev, er, "Date Evaluation Started", AsOf()
    End If
    Audit "Released for evaluation", ack, "Confirmed payments " & Naira(GetN(lo, r, "Amount Paid")) & " cover " & Naira(GetN(lo, r, "Release Requires"))
    Application.Calculate
    TryRelease = True
End Function

' The gate for evaluation actions on open submissions; every blocked attempt is audited.
Public Function GateOk(ByVal ack As String, ByVal actionName As String) As Boolean
    Dim lo As ListObject, r As Long
    Application.Calculate
    Set lo = T("tblRegister")
    r = FindRow(lo, "Ack No.", ack)
    If r = 0 Then Exit Function
    If GetS(lo, r, "Closed") = "Yes" Or GetS(lo, r, "Gate Cleared") = "Yes" Then
        TryRelease ack
        GateOk = True
        Exit Function
    End If
    Audit "Blocked - awaiting Finance confirmation", ack, actionName & ": " & GetS(lo, r, "Gate Reason")
    Tell actionName & " is blocked. " & GetS(lo, r, "Gate Reason") & "."
End Function
