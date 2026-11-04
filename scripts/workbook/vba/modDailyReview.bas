Attribute VB_Name = "modDailyReview"
' Daily review (SPEC 4.10, workflow.ts dailyReview). Run it each morning; the workbook offers it when
' opened. It never lapses anything: overdue deficiency responses are listed for a person to lapse.
Option Explicit

Public Sub DailyReview()
    RunDailyReview
End Sub

Public Sub DailyReviewSilent()
    RunDailyReview
End Sub

Public Sub OfferDailyReview()
    Dim last As Variant
    last = Setting("cfgLastReview")
    If IsDate(last) And CStr(last) <> "" Then
        If Int(CDate(last)) >= AsOf() Then Exit Sub
    End If
    If Ask("The daily review has not run today. Run it now?") Then RunDailyReview
End Sub

Private Sub RunDailyReview()
    Dim lo As ListObject, i As Long, st As String, today As Date, n As Long
    Dim release As New Collection, prov As New Collection, overdue As New Collection, lockRows As New Collection
    Dim red As Long, amber As Long, unpaid As Long, reminder As Long, remDays As Variant, det As Variant, dd As Variant, it As Variant
    Dim summary As String, regNo As String, yr As Long
    BeginAction
    On Error GoTo Failed
    today = AsOf()
    remDays = Setting("cfgUnpaidReminderDays")
    Set lo = T("tblRegister")
    Application.Calculate
    ' Work out everything first, from the state before any change (as the app does).
    For i = 1 To lo.ListRows.Count
        If GetS(lo, i, "Ack No.") <> "" Then
            st = GetS(lo, i, "Status")
            If st = ST_AWAITING Then
                If GetS(lo, i, "Gate Cleared") = "Yes" Then
                    release.Add GetS(lo, i, "Ack No.")
                ElseIf CStr(remDays) <> "" And IsDate(GetV(lo, i, "Date Submitted")) Then
                    If today - CDate(GetV(lo, i, "Date Submitted")) >= CDbl(remDays) Then reminder = reminder + 1
                End If
            End If
            det = GetV(lo, i, "Determination Due")
            If st = ST_RECEIVED And GetS(lo, i, "Filing Type") = FILING_NEW And IsDate(det) And CStr(det) <> "" Then
                If CDate(det) < today Then prov.Add i
            End If
            dd = GetV(lo, i, "Deficiency Response Due")
            If st = ST_DEFICIENCY And IsDate(dd) And CStr(dd) <> "" Then
                If CDate(dd) < today Then overdue.Add GetS(lo, i, "Ack No.")
            End If
            If st = ST_REGISTERED And GetS(lo, i, "Registration No.") = "" Then lockRows.Add i
            If GetS(lo, i, "SLA") = "Red" Then red = red + 1
            If GetS(lo, i, "SLA") = "Amber" Then amber = amber + 1
            If (GetS(lo, i, "Closed") = "No" Or st = ST_REGISTERED) And (GetS(lo, i, "Payment Status") = "Unpaid" Or GetS(lo, i, "Payment Status") = "Part-paid") Then unpaid = unpaid + 1
        End If
    Next i
    For Each it In release
        TryRelease CStr(it)
    Next it
    For Each it In prov
        SetV lo, CLng(it), "Status", ST_PROVISIONAL
        Audit "Provisional registration", GetS(lo, CLng(it), "Ack No."), "Determination due " & LongDate(GetV(lo, CLng(it), "Determination Due")) & " has passed: provisionally registered (para 13(4)); the Ack No. serves as the registration number"
    Next it
    For Each it In lockRows
        If IsDate(GetV(lo, CLng(it), "Certificate Issue Date")) Then yr = Year(CDate(GetV(lo, CLng(it), "Certificate Issue Date"))) Else yr = Year(today)
        regNo = CStr(Setting("cfgRegPrefix")) & "/" & yr & "/" & GetS(lo, CLng(it), "Category Applied") & "-" & GetS(lo, CLng(it), "Primary Code") & "/" & Pad(NextRegistrationSerial(yr), 4)
        SetV lo, CLng(it), "Registration No.", regNo
        Audit "Registration number locked", GetS(lo, CLng(it), "Ack No."), regNo
    Next it
    summary = "Provisional today: " & prov.Count & "; overdue deficiency responses: " & overdue.Count & _
        "; numbers locked: " & lockRows.Count & "; red: " & red & "; amber: " & amber & "; unpaid/part-paid: " & unpaid & _
        "; released for evaluation: " & release.Count
    If CStr(remDays) <> "" Then summary = summary & "; unpaid acknowledgements " & remDays & "+ days: " & reminder
    Audit "Daily review", "", summary
    ThisWorkbook.Names("cfgLastReview").RefersToRange.Value = NowStamp()
    Dim list As String
    For Each it In overdue
        list = list & vbLf & "  " & CStr(it)
    Next it
    Tell "Daily review done." & vbLf & summary & IIf(list = "", "", vbLf & vbLf & "Overdue deficiency responses (lapse them from the Evaluation sheet):" & list)
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Daily review failed: " & Err.Description
    Resume Done
End Sub
