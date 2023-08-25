╔═name ═╗ error: Expected '╔═ '
╔═ name═╗ error: Expected ' ═╗'
╔═  name ═╗ error: Leading spaces are disallowed: ' name'
╔═ name  ═╗ error: Trailing spaces are disallowed: 'name '

╔═ test ═╗
╔═ test/scenario ═╗
╔═ test/scenario/subscenario ═╗
No limit to how deep scenario nesting can go.

╔═ test[lens pretty-print] ═╗
╔═ test[lens only plaintext] ═╗
Tests, scenarios, and lenses have no length or character restrictions.
We escape the following:
 - \ -> \\
 - [ -> \(
 - ] -> \)
 - newline -> \n
 - tab -> \t
 - ╔ -> \┌
 - ╗ -> \┐
 - ═ -> \─
╔═ test with \∕slash\∕ in name ═╗
╔═ test with \(square brackets\) in name ═╗
╔═ test with \\backslash\\ in name ═╗
╔═ test with \nnewline\n in name ═╗
╔═ test with \ttab\t in name ═╗
╔═ test with \┌\─ ascii art \┐\─ in name ═╗

