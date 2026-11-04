Attribute VB_Name = "modIntake"
' Intake: save submission (SPEC 4.1), documents checklist (2.6), category confirmed (4.13),
' pricing recalculation, own-use notifications (4.3, 4.15).
Option Explicit

' --- Buttons ---------------------------------------------------------------------------------
Public Sub NewSubmissionRow()
    Dim lo As ListObject, r As Long
    BeginAction
    Set lo = T("tblRegister")
    r = AddRow(lo)
    SetV lo, r, "Filing Type", FILING_NEW
    SetV lo, r, "Date Submitted", AsOf()
    EndAction
    lo.DataBodyRange.Cells(r, lo.ListColumns("Form Filed").Index).Select
End Sub

Public Sub SaveSubmission()
    Dim r As Long
    r = SelectedRow(T("tblRegister"))
    If r = 0 Then Tell "Select the new row on the Register first.": Exit Sub
    SaveSubmissionAt r
End Sub

Public Sub NewOwnUseRow()
    Dim lo As ListObject, r As Long
    BeginAction
    Set lo = T("tblOwnUse")
    r = AddRow(lo)
    SetV lo, r, "Date Filed", AsOf()
    EndAction
    lo.DataBodyRange.Cells(r, lo.ListColumns("Name").Index).Select
End Sub

Public Sub SaveOwnUse()
    Dim r As Long
    r = SelectedRow(T("tblOwnUse"))
    If r = 0 Then Tell "Select the new row on the Own-Use sheet first.": Exit Sub
    SaveOwnUseAt r
End Sub

Public Sub RegisterOwnUse()
    Dim r As Long
    r = SelectedRow(T("tblOwnUse"))
    If r = 0 Then Tell "Select a saved notification on the Own-Use sheet first.": Exit Sub
    RegisterOwnUseFor GetS(T("tblOwnUse"), r, "OUN No.")
End Sub

Public Sub ConfirmCategory()
    Dim ack As String
    ack = SelectedAck(): If ack = "" Then Exit Sub
    ConfirmCategoryFor ack
End Sub

Public Sub RecalculatePricing()
    Dim ack As String
    ack = SelectedAck(): If ack = "" Then Exit Sub
    RecalculatePricingFor ack
End Sub

Public Sub RefreshSelectedDocuments()
    Dim r As Long, ref As String
    If ActiveSheet.Name = "Documents" Then
        r = SelectedRow(T("tblDocuments"))
        If r > 0 Then ref = GetS(T("tblDocuments"), r, "Reference")
    Else
        ref = SelectedAck()
    End If
    If ref = "" Then Exit Sub
    BeginAction
    RefreshDocuments ref
    EndAction
    Tell "Checklist refreshed for " & ref & "."
End Sub

' --- Save submission (SPEC 4.1) ---------------------------------------------------------------
Public Sub SaveSubmissionAt(ByVal r As Long)
    Dim lo As ListObject, errs As String, ft As String, form As String, linked As String
    Dim i As Long, lr As Long, ack As String, cat As String, detail As String, v As Variant
    Set lo = T("tblRegister")
    BeginAction
    On Error GoTo Failed
    If GetS(lo, r, "Ack No.") <> "" Then Tell "This submission is already saved as " & GetS(lo, r, "Ack No.") & ".": GoTo Done

    ft = GetS(lo, r, "Filing Type")
    form = GetS(lo, r, "Form Filed")
    If GetS(lo, r, "Registered Name") = "" Then errs = errs & vbLf & "- Registered name is required"
    v = GetV(lo, r, "Date Submitted")
    If Not IsDate(v) Then
        errs = errs & vbLf & "- Date submitted is required"
    ElseIf CDate(v) > AsOf() Then
        errs = errs & vbLf & "- Date submitted cannot be in the future"
    End If
    If ft = "" Then
        errs = errs & vbLf & "- Filing type is required"
    ElseIf Not InList("lstFilingType", ft) Then
        errs = errs & vbLf & "- Filing type must be one of the list"
    End If
    If form = "REG-01I" Then
        errs = errs & vbLf & "- REG-01I is the own-use notification: record it on the Own-Use sheet"
    ElseIf form = "" Then
        errs = errs & vbLf & "- Form filed is required (REG-01A to REG-01K)"
    ElseIf Not InList("lstForms", form) Then
        errs = errs & vbLf & "- Form filed must be REG-01A to REG-01K"
    End If
    If Not InList("lstLGA", GetS(lo, r, "Principal LGA")) Then errs = errs & vbLf & "- Principal LGA is required (from the list)"
    If Not InList("lstActivity", GetS(lo, r, "Primary Activity")) Then errs = errs & vbLf & "- Primary activity is required (from the list)"
    For i = 1 To 3
        If GetS(lo, r, "Other Activity " & i) <> "" Then
            If Not InList("lstActivity", GetS(lo, r, "Other Activity " & i)) Then errs = errs & vbLf & "- Other activity " & i & " is not in the activities list"
        End If
    Next i
    If Not InList("lstLicenceStatus", GetS(lo, r, "Licence Status")) Then errs = errs & vbLf & "- Licence status is required (from the list)"
    Select Case GetS(lo, r, "Operating on Effective Date (Y/N)")
        Case "Y"
        Case "N"
            If Not IsDate(GetV(lo, r, "Planned Start Date")) Then errs = errs & vbLf & "- Planned start date is required for a new operator"
        Case Else
            errs = errs & vbLf & "- Operating on the Effective Date must be Y or N"
    End Select
    If GetS(lo, r, "CAC No.") <> "" And Not ValidCac(GetS(lo, r, "CAC No.")) Then errs = errs & vbLf & "- CAC number: RC, BN or IT followed by digits"
    If GetS(lo, r, "Phone") <> "" And Not ValidPhone(GetS(lo, r, "Phone")) Then errs = errs & vbLf & "- Phone: 11 digits starting with 0, or +234 and 10 digits"
    If GetS(lo, r, "Email") <> "" And Not ValidEmail(GetS(lo, r, "Email")) Then errs = errs & vbLf & "- Email address is not valid"
    If GetN(lo, r, "Approved Waiver") < 0 Then errs = errs & vbLf & "- The waiver cannot be negative"
    If GetN(lo, r, "Approved Waiver") > GetN(lo, r, "Current Fee") Then errs = errs & vbLf & "- The waiver cannot be more than the registration fee"
    If GetS(lo, r, "Category Override") <> "" And GetS(lo, r, "Category Override") <> GetS(lo, r, "Category Auto") And GetS(lo, r, "Override Reason") = "" Then
        errs = errs & vbLf & "- Give the reason for the category override"
    End If
    If ft <> FILING_NEW And ft <> "" Then
        linked = GetS(lo, r, "Linked Registration No.")
        lr = FindRow(lo, "Registration No.", linked)
        If linked = "" Then
            errs = errs & vbLf & "- Quote the registration number this filing is for"
        ElseIf lr = 0 Then
            errs = errs & vbLf & "- No registration " & linked & " on the Register"
        ElseIf GetS(lo, lr, "Status") <> ST_REGISTERED Or GetS(lo, lr, "Filing Type") <> FILING_NEW Then
            errs = errs & vbLf & "- " & linked & " is not a Registered new registration"
        End If
    End If
    If errs <> "" Then Tell "The submission was not saved:" & errs: GoTo Done

    ' One registration per person (para 11(4)): the same CAC number on another registration.
    If GetS(lo, r, "CAC No.") <> "" Then
        For i = 1 To lo.ListRows.Count
            If i <> r And GetS(lo, i, "Ack No.") <> "" And LCase$(GetS(lo, i, "CAC No.")) = LCase$(GetS(lo, r, "CAC No.")) Then
                If GetS(lo, i, "Family") <> GetS(lo, r, "Family") Then
                    If Not Ask("CAC number " & GetS(lo, r, "CAC No.") & " is already on " & GetS(lo, i, "Ack No.") & " (" & GetS(lo, i, "Registered Name") & "). One registration per person (para 11(4)). Save anyway?") Then GoTo Done
                    Exit For
                End If
            End If
        Next i
    End If

    ack = CStr(Setting("cfgAckPrefix")) & "/" & Year(CDate(GetV(lo, r, "Date Submitted"))) & "/" & Pad(NextSerial("cfgNextAck"), 5)
    SetV lo, r, "Ack No.", ack
    Snapshot lo, r
    SetV lo, r, "Status", ST_AWAITING
    SetV lo, r, "Created By", CurrentUser()
    Dim ev As ListObject, er As Long
    Set ev = T("tblEvaluation")
    er = AddRow(ev)
    SetV ev, er, "Ack No.", ack
    Application.Calculate
    RefreshDocuments ack
    cat = GetS(lo, r, "Category Applied")
    detail = GetS(lo, r, "Registered Name") & " - Category " & cat & " - Form " & form
    If ft <> FILING_NEW Then
        detail = detail & "; " & ft & " of " & linked
        Audit "Filing received", GetS(lo, lr, "Ack No."), ft & " " & ack & " filed for " & linked
    End If
    Audit "New submission", ack, detail
    TryRelease ack
    Tell "Saved as " & ack & ". Status: " & GetS(lo, r, "Status") & "." & vbLf & "Next: record the payment on the Payments sheet (Finance confirms it on the Finance Desk). Print the acknowledgement letter from the web app."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Save submission failed: " & Err.Description
    Resume Done
End Sub

' Freeze the pricing on the row (docs/DECISIONS.md "Snapshot pricing").
Private Sub Snapshot(ByVal lo As ListObject, ByVal r As Long)
    Application.Calculate
    If GetS(lo, r, "Current Category") = "" Then
        SetV lo, r, "Priced Category", Empty
        Exit Sub
    End If
    SetV lo, r, "Priced Category", GetS(lo, r, "Current Category")
    SetV lo, r, "Priced Fee", GetN(lo, r, "Current Fee")
    SetV lo, r, "Priced Late Initial", GetN(lo, r, "Current Late Initial")
    SetV lo, r, "Priced Late Daily", GetN(lo, r, "Current Late Daily")
    SetV lo, r, "Priced Late Cap", GetN(lo, r, "Current Late Cap")
    If IsDate(GetV(lo, r, "Current Deadline")) And GetS(lo, r, "Current Deadline") <> "" Then
        SetV lo, r, "Priced Deadline", CDate(GetV(lo, r, "Current Deadline"))
    Else
        SetV lo, r, "Priced Deadline", Empty
    End If
    SetV lo, r, "Priced Effective Date", CDate(Setting("cfgEffectiveDate"))
End Sub

' Add a checklist row for each item on the current list that has none (shared keys carry over).
Public Sub RefreshDocuments(ByVal ref As String)
    Dim src As ListObject, sr As Long, dv As String, form As String, items() As String, i As Long
    Dim key As String, docs As ListObject, fd As ListObject, d As Long, fr As Long
    Application.Calculate
    Set src = T("tblRegister")
    sr = FindRow(src, "Ack No.", ref)
    If sr > 0 Then
        dv = GetS(src, sr, "Document Values"): form = GetS(src, sr, "Documents Form")
    Else
        Set src = T("tblOwnUse")
        sr = FindRow(src, "OUN No.", ref)
        If sr = 0 Then Exit Sub
        dv = GetS(src, sr, "Document Values"): form = "REG-01I"
    End If
    If dv = "" Then Exit Sub
    Set docs = T("tblDocuments")
    Set fd = T("tblFormDocs")
    items = Split(dv, "|")
    For i = LBound(items) To UBound(items)
        key = Left$(items(i), InStr(items(i), "=") - 1)
        If FindRow(docs, "Lookup Key", ref & "|" & key) = 0 Then
            fr = FindRow(fd, "Form Key", form & "|" & key)
            If fr = 0 Then fr = FindRow(fd, "Key", key)
            d = AddRow(docs)
            SetV docs, d, "Reference", ref
            SetV docs, d, "Form", IIf(fr > 0, GetS(fd, fr, "Form"), form)
            SetV docs, d, "Key", key
            If fr > 0 Then SetV docs, d, "Document", GetS(fd, fr, "Document")
            Application.Calculate
        End If
    Next i
End Sub

' --- Category confirmed (SPEC 4.13, check 1.10) ---------------------------------------------
Public Sub ConfirmCategoryFor(ByVal ack As String)
    Dim lo As ListObject, r As Long, ev As ListObject, er As Long, cat As String, reason As String
    Dim formCat As String, notes As String, prev As String
    Set lo = T("tblRegister"): Set ev = T("tblEvaluation")
    BeginAction
    On Error GoTo Failed
    r = FindRow(lo, "Ack No.", ack): er = FindRow(ev, "Ack No.", ack)
    If r = 0 Or er = 0 Then Tell "No submission " & ack: GoTo Done
    If Not GateOk(ack, "Category confirmation") Then GoTo Done
    If Not (SameName(CurrentUser(), GetS(ev, er, "Evaluating Officer")) Or SameName(CurrentUser(), GetS(ev, er, "Reviewing Supervisor"))) Then
        Tell "Only the assigned evaluating officer or a reviewing supervisor can do this.": GoTo Done
    End If
    If GetS(lo, r, "Closed") = "Yes" Then Tell "The category cannot be confirmed now: submission is closed (" & GetS(lo, r, "Status") & ").": GoTo Done
    If GetS(ev, er, "Final Decision") <> "" Then Tell "The category cannot be confirmed now: a final decision is already recorded.": GoTo Done
    formCat = GetS(lo, r, "Form Category")
    cat = UCase$(AskText("Schedule 3 category this submission belongs in (A to K). Form filed: " & GetS(lo, r, "Form Filed") & " (Category " & formCat & "); calculated: " & GetS(lo, r, "Category Auto") & ".", GetS(lo, r, "Category Auto")))
    If cat = "" Then GoTo Done
    If Not InList("lstCategories", cat) Then Tell "Choose a Schedule 3 category (A to K).": GoTo Done
    If cat <> formCat Then
        reason = AskText("Give the reason: the form filed (" & GetS(lo, r, "Form Filed") & ") is for Category " & formCat & ".")
        If reason = "" Then Tell "A reason is required when the category differs from the form filed.": GoTo Done
    End If
    prev = GetS(lo, r, "Confirmed Category")
    SetV lo, r, "Confirmed Category", cat
    SetV lo, r, "Category Confirmed Reason", IIf(cat <> formCat, reason, Empty)
    RefreshDocuments ack
    notes = "Category " & cat & " confirmed (form filed " & GetS(lo, r, "Form Filed") & ")"
    If prev <> "" And prev <> cat Then notes = notes & "; was " & prev
    If cat <> formCat Then
        If CStr(Setting("cfgWrongForm")) = "Accept and re-categorise" Then
            notes = notes & "; accepted and re-categorised: " & reason & "; documents now follow REG-01" & cat
        Else
            notes = notes & "; differs from the form: " & reason & "; the applicant must file on REG-01" & cat
        End If
    End If
    If GetS(lo, r, "Category Applied") <> "" And GetS(lo, r, "Category Applied") <> cat Then
        notes = notes & "; Category " & GetS(lo, r, "Category Applied") & " is charged: correct the details or override, then an admin recalculates"
    End If
    Audit "Category confirmed", ack, notes
    Tell notes
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Confirm category failed: " & Err.Description
    Resume Done
End Sub

' --- Pricing recalculation (Admin; docs/DECISIONS.md) ----------------------------------------
Public Sub RecalculatePricingFor(ByVal ack As String)
    Dim lo As ListObject, r As Long, reason As String, before As String, after As String
    Set lo = T("tblRegister")
    BeginAction
    On Error GoTo Failed
    r = FindRow(lo, "Ack No.", ack)
    If r = 0 Then GoTo Done
    If GetS(lo, r, "Registration No.") <> "" Then Tell "Recalculation is refused once the registration number is locked.": GoTo Done
    reason = AskText("Admin only. Reason for recalculating the pricing of " & ack & ":")
    If reason = "" Then Tell "A reason is required.": GoTo Done
    before = GetS(lo, r, "Priced Category") & " " & Naira(GetN(lo, r, "Priced Fee"))
    Snapshot lo, r
    Application.Calculate
    after = GetS(lo, r, "Priced Category") & " " & Naira(GetN(lo, r, "Priced Fee"))
    Audit "Pricing recalculated", ack, before & " " & ARROW() & " " & after & "; reason: " & reason
    TryRelease ack
    Tell "Pricing recalculated: " & after
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Recalculation failed: " & Err.Description
    Resume Done
End Sub

' --- Own-use notification (SPEC 4.3) ----------------------------------------------------------
Public Sub SaveOwnUseAt(ByVal r As Long)
    Dim lo As ListObject, errs As String, cap As Double, i As Long, oun As String, v As Variant
    Set lo = T("tblOwnUse")
    BeginAction
    On Error GoTo Failed
    If GetS(lo, r, "OUN No.") <> "" Then Tell "Already saved as " & GetS(lo, r, "OUN No.") & ".": GoTo Done
    If GetS(lo, r, "Name") = "" Then errs = errs & vbLf & "- Name is required"
    v = GetV(lo, r, "Date Filed")
    If Not IsDate(v) Then
        errs = errs & vbLf & "- Date filed is required"
    ElseIf CDate(v) > AsOf() Then
        errs = errs & vbLf & "- Date filed cannot be in the future"
    End If
    If Not InList("lstLGA", GetS(lo, r, "LGA")) Then errs = errs & vbLf & "- LGA is required (from the list)"
    If GetS(lo, r, "Installed Capacity (kW)") = "" Then errs = errs & vbLf & "- At least one generator unit (kW) is required"
    If GetS(lo, r, "CAC No.") <> "" And Not ValidCac(GetS(lo, r, "CAC No.")) Then errs = errs & vbLf & "- CAC number: RC, BN or IT followed by digits"
    If GetS(lo, r, "Phone") <> "" And Not ValidPhone(GetS(lo, r, "Phone")) Then errs = errs & vbLf & "- Phone: 11 digits starting with 0, or +234 and 10 digits"
    If GetS(lo, r, "Email") <> "" And Not ValidEmail(GetS(lo, r, "Email")) Then errs = errs & vbLf & "- Email address is not valid"
    If errs <> "" Then Tell "The notification was not saved:" & errs: GoTo Done
    cap = GetN(lo, r, "Installed Capacity (kW)")
    If cap >= 1000 Then Tell "Register as captive generation (para 3(3)(c)): " & cap & " kW is 1 MW or more.": GoTo Done
    If cap < CDbl(Setting("cfgOwnUseThresholdKw")) Then
        If Not Ask("Below " & Setting("cfgOwnUseThresholdKw") & " kW: does not need to notify (para 3(4)). Save anyway?") Then GoTo Done
    End If
    If GetS(lo, r, "OU_DUPLICATE_SITE") <> "" Then
        If Not Ask("Another own-use notification has the same CAC number and site address (one notification per site). Save anyway?") Then GoTo Done
    End If
    oun = CStr(Setting("cfgOunPrefix")) & "/" & Year(CDate(GetV(lo, r, "Date Filed"))) & "/" & Pad(NextSerial("cfgNextOun"), 4)
    SetV lo, r, "OUN No.", oun
    Application.Calculate
    SetV lo, r, "Priced Fee", GetN(lo, r, "Current Fee")
    SetV lo, r, "Priced Threshold (kW)", CDbl(Setting("cfgOwnUseThresholdKw"))
    SetV lo, r, "Created By", CurrentUser()
    Application.Calculate
    RefreshDocuments oun
    Audit "Own-use notification", oun, GetS(lo, r, "Name") & " - " & cap & " kW - " & GetS(lo, r, "Eligibility") & " - fee " & Naira(GetN(lo, r, "Fee Due"))
    Tell "Saved as " & oun & ". Fee due: " & Naira(GetN(lo, r, "Fee Due")) & "."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Save notification failed: " & Err.Description
    Resume Done
End Sub

' --- Own-use registration with a certificate (SPEC 4.15) -------------------------------------
Public Sub RegisterOwnUseFor(ByVal oun As String)
    Dim lo As ListObject, r As Long, blockers As String, regNo As String
    Set lo = T("tblOwnUse")
    BeginAction
    On Error GoTo Failed
    r = FindRow(lo, "OUN No.", oun)
    If r = 0 Then Tell "No notification " & oun: GoTo Done
    blockers = GetS(lo, r, "Registration Blockers")
    If SameName(CurrentUser(), GetS(lo, r, "Created By")) Then
        blockers = blockers & IIf(blockers = "", "", vbLf) & "The approving officer cannot be the user who created the submission"
    End If
    If blockers <> "" Then Tell "Registration is blocked:" & vbLf & blockers: GoTo Done
    regNo = CStr(Setting("cfgRegPrefix")) & "/" & Year(AsOf()) & "/I-CPT/" & Pad(NextRegistrationSerial(Year(AsOf())), 4)
    SetV lo, r, "Registration No.", regNo
    SetV lo, r, "Certificate Issue Date", AsOf()
    SetV lo, r, "Registered By", CurrentUser()
    Audit "Registered", oun, regNo & " - approved by " & CurrentUser()
    Tell "Registered as " & regNo & ". Issue the CERT-01 certificate from the web app."
Done:
    EndAction
    Exit Sub
Failed:
    Tell "Registration failed: " & Err.Description
    Resume Done
End Sub

' Certificates issued in a calendar year, in issue order, across categories and own-use (SPEC 3).
Public Function NextRegistrationSerial(ByVal yr As Long) As Long
    Dim prefix As String, maxS As Long, lo As Variant, i As Long, s As String, n As Long
    prefix = CStr(Setting("cfgRegPrefix")) & "/" & yr & "/"
    For Each lo In Array(T("tblRegister"), T("tblOwnUse"))
        For i = 1 To lo.ListRows.Count
            s = GetS(lo, i, "Registration No.")
            If Left$(s, Len(prefix)) = prefix Then
                n = CLng(Val(Mid$(s, InStrRev(s, "/") + 1)))
                If n > maxS Then maxS = n
            End If
        Next i
    Next lo
    NextRegistrationSerial = maxS + 1
End Function
