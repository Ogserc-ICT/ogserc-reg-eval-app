Attribute VB_Name = "modCommon"
' OGSERC workbook v2: shared helpers for the workflow buttons.
' Generated from the repository (scripts/workbook/vba); edit there and rebuild, not in Excel.
' The web app is the system of record. These macros cannot enforce logins, separation of duties or
' a tamper-proof audit log (see the Guide sheet).
Option Explicit

Public Const PWD As String = "ogserc-v2"
Public Const ST_AWAITING As String = "Acknowledged - Awaiting Payment"
Public Const ST_RECEIVED As String = "Received - Under Review"
Public Const ST_DEFICIENCY As String = "Deficiency Notice Issued"
Public Const ST_PROVISIONAL As String = "Provisionally Registered"
Public Const ST_REGISTERED As String = "Registered"
Public Const ST_LAPSED As String = "Lapsed"
Public Const ST_REFUSED As String = "Refused"
Public Const ST_CANCELLED As String = "Cancelled"
Public Const ST_APPLIED As String = "Changes Applied"
Public Const FILING_NEW As String = "New registration"
Public Const FILING_UPDATE As String = "Update: material change (para 16(1))"
Public Const FILING_ANNUAL As String = "Annual confirmation (para 16(2))"

' Test hooks: verify-workbook.ps1 sets these so the buttons run without dialogs.
Public gTest As Boolean
Public gUser As String
Public gAnswers As Collection
Public gMessages As String
Public gInAction As Boolean
Private gOld As Object

Public Function TestBegin(ByVal user As String) As Boolean
    gTest = True
    gUser = user
    Set gAnswers = New Collection
    gMessages = ""
    TestBegin = True
End Function

Public Sub TestQueue(ByVal answer As String)
    If gAnswers Is Nothing Then Set gAnswers = New Collection
    gAnswers.Add answer
End Sub

Public Function TestEnd() As String
    TestEnd = gMessages
    gMessages = ""
End Function

' --- Characters outside ASCII ----------------------------------------------------------------
Public Function NAIRA_SIGN() As String: NAIRA_SIGN = ChrW(&H20A6): End Function
Public Function DASH() As String: DASH = ChrW(8211): End Function
Public Function ARROW() As String: ARROW = ChrW(8594): End Function

' --- User, date, dialogs -----------------------------------------------------------------------
Public Function CurrentUser() As String
    If gTest Then CurrentUser = gUser Else CurrentUser = Application.UserName
End Function

Public Function AsOf() As Date
    Dim v As Variant
    v = ThisWorkbook.Names("cfgTodayOverride").RefersToRange.Value
    If IsEmpty(v) Or CStr(v) = "" Then AsOf = Date Else AsOf = CDate(v)
End Function

Public Function NowStamp() As Date
    NowStamp = AsOf + Time
End Function

Public Sub Tell(ByVal msg As String)
    If gTest Then
        gMessages = gMessages & msg & vbLf
    Else
        MsgBox msg, vbInformation, "OGSERC"
    End If
End Sub

Public Function Ask(ByVal msg As String) As Boolean
    If gTest Then
        gMessages = gMessages & msg & vbLf
        Ask = (PopAnswer() = "Y")
    Else
        Ask = (MsgBox(msg, vbYesNo + vbQuestion, "OGSERC") = vbYes)
    End If
End Function

Public Function AskText(ByVal msg As String, Optional ByVal def As String = "") As String
    If gTest Then
        gMessages = gMessages & msg & vbLf
        AskText = PopAnswer()
    Else
        AskText = Trim$(InputBox(msg, "OGSERC", def))
    End If
End Function

Private Function PopAnswer() As String
    If gAnswers Is Nothing Then Exit Function
    If gAnswers.Count = 0 Then Exit Function
    PopAnswer = CStr(gAnswers(1))
    gAnswers.Remove 1
End Function

' --- Tables ------------------------------------------------------------------------------------
Public Function T(ByVal name As String) As ListObject
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        On Error Resume Next
        Set T = ws.ListObjects(name)
        On Error GoTo 0
        If Not T Is Nothing Then Exit Function
    Next ws
    Err.Raise vbObjectError + 1, , "Table " & name & " not found"
End Function

Public Function GetV(ByVal lo As ListObject, ByVal r As Long, ByVal col As String) As Variant
    GetV = lo.DataBodyRange.Cells(r, lo.ListColumns(col).Index).Value
End Function

Public Function GetS(ByVal lo As ListObject, ByVal r As Long, ByVal col As String) As String
    Dim v As Variant
    v = GetV(lo, r, col)
    If IsError(v) Then GetS = "" Else GetS = Trim$(CStr(v))
End Function

Public Function GetN(ByVal lo As ListObject, ByVal r As Long, ByVal col As String) As Double
    Dim v As Variant
    v = GetV(lo, r, col)
    If IsError(v) Or IsEmpty(v) Or CStr(v) = "" Then GetN = 0 Else GetN = CDbl(v)
End Function

Public Sub SetV(ByVal lo As ListObject, ByVal r As Long, ByVal col As String, ByVal v As Variant)
    lo.DataBodyRange.Cells(r, lo.ListColumns(col).Index).Value = v
End Sub

Public Function FindRow(ByVal lo As ListObject, ByVal col As String, ByVal value As String) As Long
    Dim i As Long
    If lo.ListRows.Count = 0 Or value = "" Then Exit Function
    For i = 1 To lo.ListRows.Count
        If CStr(lo.DataBodyRange.Cells(i, lo.ListColumns(col).Index).Value) = value Then FindRow = i: Exit Function
    Next i
End Function

Public Function AddRow(ByVal lo As ListObject) As Long
    lo.ListRows.Add
    AddRow = lo.ListRows.Count
End Function

Public Function SelectedRow(ByVal lo As ListObject) As Long
    If lo.DataBodyRange Is Nothing Then Exit Function
    If ActiveCell Is Nothing Then Exit Function
    If ActiveCell.Worksheet.Name <> lo.Parent.Name Then Exit Function
    If Intersect(ActiveCell, lo.DataBodyRange) Is Nothing Then Exit Function
    SelectedRow = ActiveCell.Row - lo.HeaderRowRange.Row
End Function

' The Ack No. of the row selected on the Register or Evaluation sheet.
Public Function SelectedAck() As String
    Dim r As Long
    If ActiveSheet.Name = "Evaluation" Then
        r = SelectedRow(T("tblEvaluation"))
        If r > 0 Then SelectedAck = GetS(T("tblEvaluation"), r, "Ack No.")
    ElseIf ActiveSheet.Name = "Register" Then
        r = SelectedRow(T("tblRegister"))
        If r > 0 Then SelectedAck = GetS(T("tblRegister"), r, "Ack No.")
    End If
    If SelectedAck = "" Then Tell "Select a saved submission's row on the Register or Evaluation sheet first."
End Function

Public Function SameName(ByVal a As String, ByVal b As String) As Boolean
    SameName = (Trim$(a) <> "" And LCase$(Trim$(a)) = LCase$(Trim$(b)))
End Function

' --- Actions: protection, events, audit -------------------------------------------------------
Public Sub BeginAction()
    gInAction = True
    Application.EnableEvents = False
    If Not gTest Then Application.ScreenUpdating = False
    Dim ws As Worksheet
    If Not gTest Then
        For Each ws In ThisWorkbook.Worksheets
            If ws.ProtectContents Then ws.Unprotect PWD
        Next ws
    End If
    Application.Calculate
End Sub

Public Sub EndAction()
    Application.Calculate
    Dim ws As Worksheet
    If Not gTest Then
        For Each ws In ThisWorkbook.Worksheets
            If ws.Name <> "Guide" Or True Then
                ws.Protect Password:=PWD, DrawingObjects:=True, Contents:=True, Scenarios:=True, _
                    AllowFormattingCells:=True, AllowFormattingColumns:=True, AllowFormattingRows:=True, _
                    AllowFiltering:=True
            End If
        Next ws
        Application.ScreenUpdating = True
    End If
    Application.EnableEvents = True
    gInAction = False
End Sub

Public Sub Audit(ByVal action As String, ByVal reference As String, ByVal detail As String)
    Dim lo As ListObject, r As Long, wasProtected As Boolean
    Set lo = T("tblAudit")
    wasProtected = lo.Parent.ProtectContents
    If wasProtected Then lo.Parent.Unprotect PWD
    r = AddRow(lo)
    SetV lo, r, "Timestamp", NowStamp()
    SetV lo, r, "User", CurrentUser()
    SetV lo, r, "Action", action
    SetV lo, r, "Reference", reference
    SetV lo, r, "Detail", detail
    If wasProtected Then lo.Parent.Protect Password:=PWD, DrawingObjects:=True, Contents:=True, Scenarios:=True, AllowFormattingColumns:=True, AllowFiltering:=True
End Sub

Public Function NextSerial(ByVal name As String) As Long
    Dim rg As Range
    Set rg = ThisWorkbook.Names(name).RefersToRange
    NextSerial = CLng(Val(rg.Value))
    If NextSerial < 1 Then NextSerial = 1
    rg.Value = NextSerial + 1
End Function

Public Function Setting(ByVal name As String) As Variant
    Setting = ThisWorkbook.Names(name).RefersToRange.Value
End Function

Public Function Pad(ByVal n As Long, ByVal width As Integer) As String
    Pad = Right$(String$(width, "0") & CStr(n), width)
End Function

Public Function Naira(ByVal x As Double) As String
    Dim k As Double, w As Double, r As Long
    k = Round(Abs(x) * 100, 0)
    w = Int(k / 100)
    r = CLng(k - w * 100)
    Naira = IIf(x < 0, "-", "") & NAIRA_SIGN() & Format$(w, "#,##0") & IIf(r > 0, "." & Format$(r, "00"), "")
End Function

Public Function LongDate(ByVal d As Variant) As String
    Dim m As Variant
    m = Array("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
    If IsEmpty(d) Or CStr(d) = "" Then Exit Function
    LongDate = Day(CDate(d)) & " " & m(Month(CDate(d)) - 1) & " " & Year(CDate(d))
End Function

Public Function IsOn(ByVal name As String) As Boolean
    IsOn = (UCase$(Trim$(CStr(Setting(name)))) = "Y")
End Function

' --- Format checks at entry (SPEC 8.5) ---------------------------------------------------------
Public Function ValidCac(ByVal s As String) As Boolean
    Dim t As String, rest As String, i As Long
    t = UCase$(Trim$(s))
    If Len(t) < 3 Then Exit Function
    If Left$(t, 2) <> "RC" And Left$(t, 2) <> "BN" And Left$(t, 2) <> "IT" Then Exit Function
    rest = Mid$(t, 3)
    If Left$(rest, 1) = " " Then rest = Mid$(rest, 2)
    If rest = "" Then Exit Function
    For i = 1 To Len(rest)
        If InStr("0123456789", Mid$(rest, i, 1)) = 0 Then Exit Function
    Next i
    ValidCac = True
End Function

Public Function ValidPhone(ByVal s As String) As Boolean
    Dim t As String, i As Long
    t = Replace(Replace(Trim$(s), " ", ""), "-", "")
    If Left$(t, 4) = "+234" Then
        t = Mid$(t, 5)
        If Len(t) <> 10 Then Exit Function
    ElseIf Left$(t, 1) = "0" Then
        If Len(t) <> 11 Then Exit Function
    Else
        Exit Function
    End If
    For i = 1 To Len(t)
        If InStr("0123456789", Mid$(t, i, 1)) = 0 Then Exit Function
    Next i
    ValidPhone = True
End Function

Public Function ValidEmail(ByVal s As String) As Boolean
    Dim t As String, at As Long, dot As Long
    t = Trim$(s)
    If InStr(t, " ") > 0 Then Exit Function
    at = InStr(t, "@")
    If at < 2 Then Exit Function
    If InStr(at + 1, t, "@") > 0 Then Exit Function
    dot = InStrRev(t, ".")
    ValidEmail = (dot > at + 1 And dot < Len(t))
End Function

Public Function InList(ByVal listName As String, ByVal value As String) As Boolean
    Dim c As Range
    For Each c In ThisWorkbook.Names(listName).RefersToRange.Cells
        If CStr(c.Value) = value Then InList = True: Exit Function
    Next c
End Function

' --- Edit log (sheet events) -------------------------------------------------------------------
Public Sub RememberOld(ByVal Target As Range)
    Dim c As Range
    Set gOld = CreateObject("Scripting.Dictionary")
    If Target.CountLarge > 200 Then Exit Sub
    For Each c In Target.Cells
        gOld(c.Worksheet.Name & "!" & c.Address) = c.Value
    Next c
End Sub

Public Sub LogEdit(ByVal ws As Worksheet, ByVal Target As Range)
    Dim c As Range, lo As ListObject, oldV As Variant, ref As String, col As String, n As Long
    If gInAction Or gTest Then Exit Sub
    If Target.CountLarge > 200 Then
        Application.EnableEvents = False
        Audit "Edited", "", ws.Name & "!" & Target.Address & ": " & Target.CountLarge & " cells changed"
        Application.EnableEvents = True
        Exit Sub
    End If
    Application.EnableEvents = False
    On Error Resume Next
    For Each c In Target.Cells
        oldV = Empty
        If Not gOld Is Nothing Then If gOld.Exists(ws.Name & "!" & c.Address) Then oldV = gOld(ws.Name & "!" & c.Address)
        If CStr(oldV) <> CStr(c.Value) Then
            ref = "": col = c.Address(False, False)
            Set lo = c.ListObject
            If Not lo Is Nothing Then
                col = lo.HeaderRowRange.Cells(1, c.Column - lo.Range.Column + 1).Value
                n = c.Row - lo.HeaderRowRange.Row
                ref = CStr(lo.DataBodyRange.Cells(n, 1).Value)
            End If
            If ws.Name = "Settings" Then
                Audit "Setting changed", "", c.Offset(0, -1).Value & ": " & CStr(oldV) & " " & ARROW() & " " & CStr(c.Value)
            Else
                Audit "Edited", ref, ws.Name & " " & col & ": " & IIf(CStr(oldV) = "", "(blank)", CStr(oldV)) & " " & ARROW() & " " & IIf(CStr(c.Value) = "", "(blank)", CStr(c.Value))
            End If
            n = n + 0
        End If
    Next c
    On Error GoTo 0
    RememberOld Target
    Application.EnableEvents = True
End Sub
