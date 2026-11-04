<#
  Builds the OGSERC v2 workbook through Excel COM from the JSON spec written by spec.ts.

  build-workbook.ps1 -Spec spec.json -OutPath out.xlsm [-VbaDir vba] [-RulesVersion abc123] [-NoProtect]

  With -VbaDir the macros (*.bas, ThisWorkbook.cls.txt, Sheet.cls.txt) are imported and the file is
  saved as .xlsm. Importing needs Excel's "Trust access to the VBA project object model"
  (File > Options > Trust Center > Trust Center Settings > Macro Settings). This script never
  changes that setting: if it is off, the build stops and says so (exit code 3).
  Without -VbaDir the workbook is saved as .xlsx (formulas only).
#>
param(
  [Parameter(Mandatory = $true)][Alias("Spec")][string]$SpecPath,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [string]$VbaDir = '',
  [string]$RulesVersion = '',
  [switch]$NoProtect
)
$ErrorActionPreference = 'Stop'
$spec = Get-Content -Raw -Encoding UTF8 $SpecPath | ConvertFrom-Json

function Colour([string]$key) {
  $hex = $spec.colours.$key
  if (-not $hex) { $hex = $key }
  $hex = $hex.TrimStart('#')
  $r = [Convert]::ToInt32($hex.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($hex.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($hex.Substring(4, 2), 16)
  return $r + 256 * $g + 65536 * $b
}
function SetProp($obj, [string]$prop, $value) {
  if ($null -ne $value -and $value.PSObject) { $value = $value.PSObject.BaseObject }
  if ($prop -eq 'Value2' -and $value -is [double]) { $obj.Value2 = [double]$value; return }
  if ($prop -eq 'Value2' -and $value -is [int]) { $obj.Value2 = [double]$value; return }
  if ($prop -eq 'Value2' -and $value -is [string]) { $obj.Value2 = [string]$value; return }
  [void]$obj.GetType().InvokeMember($prop, [Reflection.BindingFlags]::SetProperty, $null, $obj, @(,$value))
}
function ColLetter([int]$n) {
  $s = ''
  while ($n -gt 0) { $m = ($n - 1) % 26; $s = [char](65 + $m) + $s; $n = [math]::Floor(($n - 1) / 26) }
  return $s
}
function IsoToOa($v) {
  if ($v -is [string] -and $v -match '^\d{4}-\d{2}-\d{2}$') {
    return [datetime]::ParseExact($v, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture).ToOADate()
  }
  return $v
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.ScreenUpdating = $false
$xl.EnableEvents = $false
try { $xl.AutoCorrect.AutoFillFormulasInLists = $true } catch {}
$wb = $xl.Workbooks.Add()
$xl.Calculation = -4135  # manual while building

$sheets = @{}
$tableInfo = @{}
$placeholders = @()
$script:formulaErrors = @()
$script:retry = @()
try {
  # ---------- Pass 1: sheets, static cells, tables (headers + data), cell names ----------
  $first = $true
  foreach ($s in $spec.sheets) {
    if ($first) { $ws = $wb.Worksheets.Item(1); $first = $false }
    else { $ws = $wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
    $ws.Name = $s.name
    $ws.Tab.Color = Colour $s.tab
    $ws.Cells.Font.Name = 'Calibri'
    $ws.Cells.Font.Size = 10
    $sheets[[string]$s.name] = $ws
    while ($wb.Worksheets.Count -gt 1 -and $false) {}

    foreach ($c in @($s.cells)) {
      if (-not $c) { continue }
      $r = $ws.Range($c.addr)
      if ($c.fmt) { $r.NumberFormat = $c.fmt }
      if ($null -ne $c.value -and -not $c.f) { SetProp $r 'Value2' (IsoToOa $c.value) }
      if ($c.merge) { $ws.Range($c.merge).Merge() }
      if ($c.bold) { $r.Font.Bold = $true }
      if ($c.italic) { $r.Font.Italic = $true }
      if ($c.size) { $r.Font.Size = $c.size }
      if ($c.color) { $r.Font.Color = Colour $c.color }
      if ($c.fill) { $r.Interior.Color = Colour $c.fill }
      if ($c.wrap) { $r.WrapText = $true; $r.VerticalAlignment = -4160 }
      if ($c.align -eq 'left') { $r.HorizontalAlignment = -4131 }
      if ($c.align -eq 'right') { $r.HorizontalAlignment = -4152 }
      if ($c.align -eq 'center') { $r.HorizontalAlignment = -4108 }
      if ($c.input) { $r.Interior.Color = Colour 'input'; $r.Font.Color = Colour 'inputFont'; $r.Locked = $false }
      if ($c.name) { [void]$wb.Names.Add($c.name, "='$($s.name)'!`$$(($c.addr -replace '\d',''))`$$(($c.addr -replace '[A-Z]',''))") }
    }
    if ($s.widths) {
      foreach ($p in $s.widths.PSObject.Properties) { $ws.Columns.Item($p.Name).ColumnWidth = $p.Value }
    }

    foreach ($t in @($s.tables)) {
      if (-not $t) { continue }
      $a = $ws.Range($t.anchor)
      $row0 = $a.Row; $col0 = $a.Column
      $n = @($t.columns).Count
      $hdr = $ws.Range($ws.Cells.Item($row0, $col0), $ws.Cells.Item($row0, $col0 + $n - 1))
      $hdr.NumberFormat = '@'
      $vals = New-Object 'object[,]' 1, $n
      for ($i = 0; $i -lt $n; $i++) { $vals[0, $i] = $t.columns[$i].name }
      SetProp $hdr 'Value2' $vals
      $rows = $(if ($null -eq $t.rows) { @() } else { @($t.rows) })
      $nr = $rows.Count
      if ($nr -gt 0) {
        $data = New-Object 'object[,]' $nr, $n
        for ($ri = 0; $ri -lt $nr; $ri++) {
          for ($ci = 0; $ci -lt $n; $ci++) {
            $v = $rows[$ri][$ci]
            $data[$ri, $ci] = $(if ($null -eq $v) { $null } elseif ($v.PSObject) { $v.PSObject.BaseObject } else { $v })
          }
        }
        SetProp ($ws.Range($ws.Cells.Item($row0 + 1, $col0), $ws.Cells.Item($row0 + $nr, $col0 + $n - 1))) 'Value2' $data
        $last = $row0 + $nr
      } else { $last = $row0 + 1 }
      $lo = $ws.ListObjects.Add(1, $ws.Range($ws.Cells.Item($row0, $col0), $ws.Cells.Item($last, $col0 + $n - 1)), $null, 1)
      try { $lo.Name = $t.name } catch { throw "Table name $($t.name) rejected: $($_.Exception.Message)" }
      $lo.TableStyle = $(if ($t.style) { $t.style } else { 'TableStyleLight1' })
      $tableInfo[[string]$t.name] = @{ sheet = $ws; spec = $t; lo = $lo; row0 = $row0; col0 = $col0; empty = ($nr -eq 0) }
      if ($nr -eq 0) { $placeholders += [string]$t.name }
    }
  }

  # ---------- Workbook names ----------
  foreach ($nm in $spec.names) { [void]$wb.Names.Add($nm.name, $nm.refersTo) }

  # ---------- Pass 2: formulas ----------
  foreach ($s in $spec.sheets) {
    $ws = $sheets[$s.name]
    foreach ($t in @($s.tables)) {
      if (-not $t) { continue }
      $lo = $tableInfo[$t.name].lo
      foreach ($c in $t.columns) {
        if ($c.kind -eq 'calc' -and $c.f) {
          try { $lo.ListColumns.Item($c.name).DataBodyRange.Formula2 = $c.f }
          catch { $script:retry += ,@($lo, [string]$c.name, [string]$c.f, "$($t.name)[$($c.name)]") }
        }
      }
    }
    foreach ($c in @($s.cells)) {
      if ($c -and $c.f) {
        try { $ws.Range($c.addr).Formula2 = $c.f }
        catch { $script:formulaErrors += "$($s.name)!$($c.addr)" }
      }
    }
  }

  foreach ($rt in $script:retry) {
    # A second try once every other formula is in place; a formula still refused is an error.
    try { $rt[0].ListColumns.Item($rt[1]).DataBodyRange.Formula2 = $rt[2] }
    catch { $script:formulaErrors += $rt[3] + ": " + $_.Exception.Message }
  }
  if ($script:formulaErrors.Count) { Write-Host ("FORMULAS REJECTED: " + ($script:formulaErrors -join " | ")) }
  # ---------- Pass 3: table formatting, validation, groups, CF ----------
  foreach ($name in $tableInfo.Keys) {
    $ti = $tableInfo[$name]; $t = $ti.spec; $ws = $ti.sheet
    $row0 = $ti.row0; $col0 = $ti.col0
    $cap = $(if ($t.capacity) { [int]$t.capacity } else { 0 })
    $lastRow = $row0 + [math]::Max($cap, [math]::Max(1, @($t.rows).Count))
    for ($i = 0; $i -lt @($t.columns).Count; $i++) {
      $c = $t.columns[$i]; $col = $col0 + $i
      $h = $ws.Cells.Item($row0, $col)
      $h.WrapText = $true; $h.Font.Bold = $true; $h.VerticalAlignment = -4108
      switch ($c.kind) {
        'input' { $h.Interior.Color = Colour 'input'; $h.Font.Color = Colour 'inputFont' }
        'macro' { $h.Interior.Color = Colour 'macro' }
        'calc'  { $h.Interior.Color = Colour 'calc' }
        default { $h.Interior.Color = Colour 'header' }
      }
      $colRange = $ws.Range($ws.Cells.Item($row0 + 1, $col), $ws.Cells.Item($lastRow, $col))
      if ($c.width) { $ws.Columns.Item($col).ColumnWidth = $c.width }
      if ($c.fmt) { $colRange.NumberFormat = $c.fmt }
      if ($c.wrap) { $colRange.WrapText = $true }
      if ($c.hidden) { $ws.Columns.Item($col).Hidden = $true }
      if ($c.kind -eq 'input' -and $cap -gt 0) {
        $colRange.Locked = $false
        if ($c.list -or $c.help) {
          $v = $colRange.Validation; $v.Delete()
          if ($c.list) { $v.Add(3, 1, 1, $c.list) } else { $v.Add(0, 1, 1) }
          if ($c.help) { $v.InputTitle = $c.name.Substring(0, [math]::Min(32, $c.name.Length)); $v.InputMessage = $c.help.Substring(0, [math]::Min(250, $c.help.Length)); $v.ShowInput = $true }
          $v.IgnoreBlank = $true
        }
      }
    }
    $ws.Rows.Item($row0).RowHeight = 42
    $nAbove = @($t.aboveHeader).Count
    foreach ($ab in @($t.aboveHeader)) {
      if (-not $ab) { continue }
      $r = $row0 - [int]$ab.offset
      foreach ($p in $ab.values.PSObject.Properties) {
        $idx = -1
        for ($i = 0; $i -lt @($t.columns).Count; $i++) { if ($t.columns[$i].name -eq $p.Name) { $idx = $i } }
        if ($idx -ge 0) {
          $cell = $ws.Cells.Item($r, $col0 + $idx)
          SetProp $cell 'Value2' ([string]$p.Value); $cell.WrapText = $true; $cell.Font.Size = 7; $cell.VerticalAlignment = -4107
          $cell.Orientation = 90
        }
      }
      if ($ab.height) { $ws.Rows.Item($r).RowHeight = $ab.height }
    }
    $gRow = $row0 - 1 - $nAbove
    foreach ($g in @($t.groups)) {
      if (-not $g) { continue }
      $fi = -1; $li = -1
      for ($i = 0; $i -lt @($t.columns).Count; $i++) {
        if ($t.columns[$i].name -eq $g.from) { $fi = $i }
        if ($t.columns[$i].name -eq $g.to) { $li = $i }
      }
      if ($fi -lt 0 -or $li -lt 0) { throw "Group $($g.title): columns not found in $name" }
      $gr = $ws.Range($ws.Cells.Item($gRow, $col0 + $fi), $ws.Cells.Item($gRow, $col0 + $li))
      $gr.Merge(); SetProp $gr 'Value2' ([string]$g.title); $gr.Font.Bold = $true; $gr.Font.Color = Colour 'white'
      $gr.Interior.Color = Colour 'brand'; $gr.HorizontalAlignment = -4131
    }
  }

  foreach ($s in $spec.sheets) {
    $ws = $sheets[$s.name]
    foreach ($cf in @($s.cf)) {
      if (-not $cf) { continue }
      if ($cf.range -match '^(\w+)\[(.+)\]$') {
        $ti = $tableInfo[$Matches[1]]; $cname = $Matches[2]
        $idx = -1
        for ($i = 0; $i -lt @($ti.spec.columns).Count; $i++) { if ($ti.spec.columns[$i].name -eq $cname) { $idx = $i } }
        $first = $ti.row0 + 1
        $last = $ti.row0 + [math]::Max(1, [int]$ti.spec.capacity)
        $rng = $ws.Range($ws.Cells.Item($first, $ti.col0 + $idx), $ws.Cells.Item($last, $ti.col0 + $idx))
        $formula = [regex]::Replace($cf.formula, '\{([^}]+)\}', {
            param($m)
            $j = -1
            for ($i = 0; $i -lt @($ti.spec.columns).Count; $i++) { if ($ti.spec.columns[$i].name -eq $m.Groups[1].Value) { $j = $i } }
            if ($j -lt 0) { throw "CF column not found: $($m.Groups[1].Value)" }
            '$' + (ColLetter ($ti.col0 + $j)) + $first
          })
      } else { $rng = $ws.Range($cf.range); $formula = $cf.formula }
      $fc = $rng.FormatConditions.Add(2, [Type]::Missing, $formula)
      if ($cf.fill) { $fc.Interior.Color = Colour $cf.fill }
      if ($cf.font) { $fc.Font.Color = Colour $cf.font }
      if ($cf.bold) { $fc.Font.Bold = $true }
    }
    foreach ($b in @($s.buttons)) {
      if (-not $b) { continue }
      $cell = $ws.Range($b.cell)
      $w = $(if ($b.width) { $b.width } else { 120 })
      $btn = $ws.Buttons().Add($cell.Left, $cell.Top + 1, $w, 22)
      $btn.OnAction = $b.macro
      $btn.Characters().Text = $b.caption
      $btn.Placement = 3
    }
  }

  # ---------- Version stamp ----------
  if ($RulesVersion) { $sheets['Settings'].Range('cfgRulesVersion').Value2 = [string]$RulesVersion }
  SetProp ($sheets['Settings'].Range('cfgBuiltOn')) 'Value2' ([double](Get-Date).ToOADate())

  # ---------- Windows: freeze panes, zoom, gridlines ----------
  $xl.ScreenUpdating = $true
  foreach ($s in $spec.sheets) {
    $ws = $sheets[$s.name]
    $ws.Activate()
    $win = $xl.ActiveWindow
    if ($s.freeze) { $win.FreezePanes = $false; $ws.Range($s.freeze).Select(); $win.FreezePanes = $true }
    if ($s.zoom) { $win.Zoom = $s.zoom }
    if ($s.gridlines -eq $false) { $win.DisplayGridlines = $false }
    $ws.Range('A1').Select()
  }
  $sheets['Guide'].Activate()

  # ---------- Macros ----------
  $format = 51
  if ($VbaDir) {
    # When access is blocked, Excel returns null for VBProject instead of throwing, so check both.
    $vbOk = $false
    try { $vbOk = ($null -ne $wb.VBProject) -and ($null -ne $wb.VBProject.VBComponents) -and ($wb.VBProject.VBComponents.Count -ge 0) } catch { $vbOk = $false }
    if (-not $vbOk) {
      Write-Host "BLOCKED: Excel does not allow access to the VBA project, so the macros cannot be imported."
      Write-Host "Turn on: Excel > File > Options > Trust Center > Trust Center Settings > Macro Settings >"
      Write-Host "  'Trust access to the VBA project object model', then run the build again."
      Write-Host "(You can turn it off again afterwards; the finished workbook does not need it.)"
      $wb.Close($false)
      exit 3
    }
    $tmpDir = Join-Path ([IO.Path]::GetTempPath()) ('ogserc-vba-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmpDir | Out-Null
    foreach ($f in Get-ChildItem -Path $VbaDir -Filter '*.bas' | Sort-Object Name) {
      # VBA imports Windows-1252 text with CRLF line endings.
      $text = (Get-Content -Raw -Encoding UTF8 $f.FullName) -replace "`r?`n", "`r`n"
      $dst = Join-Path $tmpDir $f.Name
      [IO.File]::WriteAllText($dst, $text, [Text.Encoding]::GetEncoding(1252))
      [void]$wb.VBProject.VBComponents.Import($dst)
    }
    Remove-Item -Recurse -Force $tmpDir
    $twb = Join-Path $VbaDir 'ThisWorkbook.cls.txt'
    if (Test-Path $twb) {
      $wb.VBProject.VBComponents.Item($wb.CodeName).CodeModule.AddFromString((Get-Content -Raw $twb))
    }
    $shc = Join-Path $VbaDir 'Sheet.cls.txt'
    if (Test-Path $shc) {
      $code = Get-Content -Raw $shc
      foreach ($nm in @('Register', 'Documents', 'Evaluation', 'Payments', 'Own-Use', 'Settings', 'Lists')) {
        $cn = $sheets[$nm].CodeName
        $wb.VBProject.VBComponents.Item($cn).CodeModule.AddFromString($code)
      }
    }
    $format = 52
  }

  $xl.Calculation = -4105
  $xl.CalculateFull()
  $outFull = [IO.Path]::GetFullPath($OutPath)
  if (Test-Path $outFull) { Remove-Item $outFull -Force }
  $wb.SaveAs($outFull, $format)
  $los = @{}
  foreach ($w in $wb.Worksheets) { foreach ($l in $w.ListObjects) { $los[[string]$l.Name] = $l } }
  # ---------- Empty the tables (no example rows in a live workbook, SPEC 8.8) ----------
  foreach ($name in $placeholders) {
    $lo = $los[$name]
    if ($lo.ListRows.Count -gt 0) { $lo.ListRows.Item(1).Delete() }
  }
  # ---------- Protection ----------
  if (-not $NoProtect -and $VbaDir) {
    foreach ($s in $spec.sheets) {
      if ($s.protect) {
        $wb.Worksheets.Item([string]$s.name).Protect($spec.password, $true, $true, $true, $false, $true, $true, $true, $false, $false, $false, $false, $false, $false, $true, $false)
      }
    }
  }
  $wb.Worksheets.Item('Guide').Activate()
  $wb.Save()
  $wb.Close($false)
  if ($script:formulaErrors.Count) { Write-Host ("Saved with rejected formulas: $outFull`n  " + ($script:formulaErrors -join "`n  ")); exit 2 }
  Write-Host "Built $outFull"
} catch {
  Write-Host "BUILD FAILED: $($_.Exception.Message)"
  Write-Host $_.ScriptStackTrace
  try { $wb.Close($false) } catch {}
  exit 1
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
