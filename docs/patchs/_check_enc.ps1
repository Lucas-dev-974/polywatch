$p = 'c:\Users\lcsystem\Desktop\TradeInterface\Polytwatch versioning\Polywatch-v1.1\docs\patchs\2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md'
$b = [IO.File]::ReadAllBytes($p)
$s = [Text.Encoding]::GetEncoding('Windows-1252').GetString($b)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($p, $s, $utf8)
# Verify bytes
$b2 = [IO.File]::ReadAllBytes($p)
$ascii = [Text.Encoding]::ASCII.GetString($b2)
$idx = $ascii.IndexOf('Impl')
$hex = ($b2[$idx..($idx+11)] | ForEach-Object { $_.ToString('X2') }) -join ' '
Write-Host ("after convert bytes: " + $hex)
Write-Host ("utf8 decode: " + [Text.Encoding]::UTF8.GetString($b2[$idx..($idx+11)]))