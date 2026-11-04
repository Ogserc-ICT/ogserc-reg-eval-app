<#
  Enters every fixture (fixtures.ts) into a copy of the built workbook through Excel COM, runs the
  macros where a fixture needs them, recalculates, and writes what the workbook shows to a results
  file. compare.ts compares the results with the domain functions' expected values.

  verify-workbook.ps1 -Workbook built.xlsm -Fixtures fixtures.json -OutPath results.json
#>
param(
  [Parameter(Mandatory = $true)][string]$Workbook,
  [Parameter(Mandatory = $true)][string]$Fixtures,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [string]$Password = 'ogserc-v2',
  [string]$Only = ''
)
$ErrorActionPreference = 'Stop'
$fx = Get-Content -Raw -Encoding UTF8 $Fixtures | ConvertFrom-Json

function SetProp($obj, [string]$prop, $value) {
  if ($null -ne $value -and $value.PSObject) { $value = $value.PSObject.BaseObject }
  if ($prop -eq 'Value2' -and $value -is [double]) { $obj.Value2 = [double]$value; return }
  if ($prop -eq 'Value2' -and $value -is [int]) { $obj.Value2 = [double]$value; return }
  if ($prop -eq 'Value2' -and $value -is [string]) { $obj.Value2 = [string]$value; return }
  [void]$obj.GetType().InvokeMember($prop, [Reflection.BindingFlags]::SetProperty, $null, $obj, @(,$value))
}
function ToCell($v) {
  if ($null -eq $v) { return $null }
  if ($v.PSObject) { $v = $v.PSObject.BaseObject }
  if ($v -is [string] -and $v -match '^\d{4}-\d{2}-\d{2}$') {
    return [datetime]::ParseExact($v, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture).ToOADate()
  }
  if ($v -is [int] -or $v -is [long] -or $v -is [decimal]) { return [double]$v }
  return $v
}

# Work on a copy so the built file stays clean.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("ogserc-verify-" + [guid]::NewGuid().ToString('N') + [IO.Path]::GetExtension($Workbook))
Copy-Item $Workbook $tmp

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.EnableEvents = $false
$xl.ScreenUpdating = $false
$results = New-Object System.Collections.ArrayList
$macros = $false
try {
  $wb = $xl.Workbooks.Open($tmp)
  $xl.Calculation = -4135
  foreach ($ws in $wb.Worksheets) { if ($ws.ProtectContents) { $ws.Unprotect($Password) } }
  try { [void]$xl.Run('TestBegin', 'probe'); $macros = $true } catch { $macros = $false }

  $tables = @{}
  foreach ($ws in $wb.Worksheets) { foreach ($lo in $ws.ListObjects) { $tables[[string]$lo.Name] = $lo } }
  $keyCol = @{ tblRegister = 'Ack No.'; tblEvaluation = 'Ack No.'; tblOwnUse = 'OUN No.'; tblPayments = 'Payment No.'; tblDocuments = 'Lookup Key' }

  function CellOf($lo, [int]$row, [string]$col) {
    $c = $lo.ListColumns.Item($col)
    return $lo.DataBodyRange.Cells.Item($row, $c.Index)
  }
  function FindRow($lo, [string]$col, $value) {
    if ($lo.ListRows.Count -eq 0) { return 0 }
    $vals = $lo.ListColumns.Item($col).DataBodyRange.Value2
    if ($lo.ListRows.Count -eq 1) { if ([string]$vals -eq [string]$value) { return 1 } else { return 0 } }
    for ($i = 1; $i -le $lo.ListRows.Count; $i++) { if ([string]$vals[$i, 1] -eq [string]$value) { return $i } }
    return 0
  }
  function ReadVal($cell) {
    $v = $cell.Value2
    if ($v -is [int]) { return "#ERROR " + $cell.Text }
    return $v
  }

  foreach ($f in $fx.fixtures) {
    if ($Only -and $f.id -notmatch $Only) { continue }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    if ($f.macros -and -not $macros) {
      [void]$results.Add(@{ fixture = $f.id; spec = $f.spec; title = $f.title; kind = 'skipped'; reason = 'macros not imported' })
      continue
    }
    try {
      $swr = [Diagnostics.Stopwatch]::StartNew()
      foreach ($t in @('tblRegister', 'tblEvaluation', 'tblDocuments', 'tblPayments', 'tblOwnUse', 'tblAudit')) {
        $lo = $tables[$t]
        if ($lo.ListRows.Count -gt 0) { [void]$lo.DataBodyRange.Delete() }
      }
      foreach ($p in $f.settings.PSObject.Properties) {
        $r = $wb.Names.Item($p.Name).RefersToRange
        if ($null -eq $p.Value -or $p.Value -eq '') { [void]$r.ClearContents() } else { SetProp $r 'Value2' (ToCell $p.Value) }
      }
      if ($env:VERIFY_TIMING) { Write-Host "  reset $($swr.Elapsed.TotalSeconds)" }
      $alias = @{}
      $messages = ''
      $opT = @{}
      foreach ($s in $f.steps) {
        $sw2 = [Diagnostics.Stopwatch]::StartNew()
        switch ($s.op) {
          'add' {
            $lo = $tables[[string]$s.table]
            [void]$lo.ListRows.Add()
            $row = $lo.ListRows.Count
            foreach ($p in $s.values.PSObject.Properties) {
              if ($null -eq $p.Value) { continue }
              SetProp (CellOf $lo $row $p.Name) 'Value2' (ToCell $p.Value)
            }
            $alias["$($s.table)|$($s.alias)"] = $row
          }
          'set' {
            $lo = $tables[[string]$s.table]
            $row = $alias["$($s.table)|$($s.alias)"]
            if (-not $row) {
              $ack = (CellOf $tables['tblRegister'] $alias["tblRegister|$($s.alias)"] 'Ack No.').Value2
              $row = FindRow $lo 'Ack No.' $ack
            }
            foreach ($p in $s.values.PSObject.Properties) {
              $cell = CellOf $lo $row $p.Name
              if ($null -eq $p.Value) { [void]$cell.ClearContents() } else { SetProp $cell 'Value2' (ToCell $p.Value) }
            }
          }
          'today' { SetProp ($wb.Names.Item('cfgTodayOverride').RefersToRange) 'Value2' (ToCell $s.date) }
          'setting' { SetProp ($wb.Names.Item($s.name).RefersToRange) 'Value2' (ToCell $s.value) }
          'addDocsAllY' {
            $ref = $null
            if ($alias.ContainsKey("tblRegister|$($s.alias)")) { $ref = (CellOf $tables['tblRegister'] $alias["tblRegister|$($s.alias)"] 'Ack No.').Value2 }
            else { $ref = (CellOf $tables['tblOwnUse'] $alias["tblOwnUse|$($s.alias)"] 'OUN No.').Value2 }
            $xl.Calculate()
            $lo = $tables['tblDocuments']
            for ($i = 1; $i -le $lo.ListRows.Count; $i++) {
              if ([string](CellOf $lo $i 'Reference').Value2 -eq [string]$ref -and -not ([string](CellOf $lo $i 'Requirement').Value2).StartsWith('Automatic')) {
                SetProp (CellOf $lo $i 'Received (Y/N/N/A)') 'Value2' 'Y'
              }
            }
          }
          'run' {
            $xl.Calculate()
            [void]$xl.Run('TestBegin', [string]$s.user)
            foreach ($a in @($s.answers)) { if ($null -ne $a) { [void]$xl.Run('TestQueue', $(if ($a -is [bool]) { $(if ($a) { 'Y' } else { 'N' }) } else { [string]$a })) } }
            $args2 = @()
            foreach ($a in @($s.args)) {
              if ($s.macro -like '*At') {
                $tbl = @{ SaveSubmissionAt = 'tblRegister'; RecordPaymentAt = 'tblPayments'; ConfirmPaymentAt = 'tblPayments'; RejectPaymentAt = 'tblPayments'; SaveOwnUseAt = 'tblOwnUse' }[[string]$s.macro]
                $args2 += [int]$alias["$tbl|$a"]
              } else { $args2 += [string]$a }
            }
            $runErr = ''
            try {
              if ($args2.Count -eq 0) { [void]$xl.Run([string]$s.macro) }
              elseif ($args2.Count -eq 1) { [void]$xl.Run([string]$s.macro, $args2[0]) }
              else { [void]$xl.Run([string]$s.macro, $args2[0], $args2[1]) }
            } catch { $runErr = "`n[macro error in $($s.macro): $($_.Exception.Message)]" }
            $messages = [string]$xl.Run('TestEnd') + $runErr
          }
          'expect' {
            $xl.CalculateFull()
            $lo = $tables[[string]$s.table]
            $row = $alias["$($s.table)|$($s.alias)"]
            if (-not $row) {
              $ack = (CellOf $tables['tblRegister'] $alias["tblRegister|$($s.alias)"] 'Ack No.').Value2
              $row = FindRow $lo 'Ack No.' $ack
            }
            foreach ($p in $s.values.PSObject.Properties) {
              $actual = $(if ($row) { ReadVal (CellOf $lo $row $p.Name) } else { '(row not found)' })
              [void]$results.Add(@{ fixture = $f.id; spec = $f.spec; title = $f.title; kind = 'value'; label = $s.label; column = $p.Name; expected = $p.Value; actual = $actual })
            }
          }
          'expectAudit' {
            $lo = $tables['tblAudit']
            $acts = @()
            for ($i = 1; $i -le $lo.ListRows.Count; $i++) {
              if ([string](CellOf $lo $i 'Reference').Value2 -eq [string]$s.reference) { $acts += [string](CellOf $lo $i 'Action').Value2 }
            }
            [void]$results.Add(@{ fixture = $f.id; spec = $f.spec; title = $f.title; kind = 'audit'; label = $s.label; expected = @($s.actions); actual = $acts })
          }
          'expectMessage' {
            [void]$results.Add(@{ fixture = $f.id; spec = $f.spec; title = $f.title; kind = 'message'; label = $s.label; expected = @($s.contains); actual = $messages })
          }
        }
        if ($env:VERIFY_TIMING) { Write-Host ("  {0} {1} {2:N2}" -f $s.op, $s.table, $sw2.Elapsed.TotalSeconds) }
      }
    } catch {
      [void]$results.Add(@{ fixture = $f.id; spec = $f.spec; title = $f.title; kind = 'error'; reason = "$($_.Exception.Message) at $($_.InvocationInfo.ScriptLineNumber)" })
    }
    Write-Host ("{0,-36} {1,6:N1} s" -f $f.id, $sw.Elapsed.TotalSeconds)
  }
  $wb.Close($false)
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  Remove-Item $tmp -ErrorAction SilentlyContinue
}
@{ macrosAvailable = $macros; results = $results } | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $OutPath
Write-Host "Verification results: $OutPath ($($results.Count) checks; macros $(if ($macros) { 'available' } else { 'not available' }))"
