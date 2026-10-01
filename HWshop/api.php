<?php
// ===== Sklep HW – API: odczyt produktów i zakupy zapisywane bezpośrednio w excelu =====
//
// GET  api.php?action=products            -> lista produktów + nazwy drużyn (bez kodów)
// POST api.php?action=team  {team, code}  -> weryfikacja drużyny, jej żetony i dotychczasowe zakupy
// POST api.php?action=buy   {team, code, items:[{row, name, qty}]} -> zakup i zapis do excela
//
// Wymaga PHP 7.4+ z rozszerzeniami zip i dom (standard na home.pl).

declare(strict_types=1);

// Ścieżka do excela (względem tego pliku)
const XLSX_PATH = __DIR__ . '/productList/SklepHW_old_custom.xlsx';
// Plik blokady – żeby dwa zakupy naraz nie nadpisały sobie zmian
const LOCK_PATH = __DIR__ . '/productList/.sklep.lock';
// Dziennik zakupów (CSV) – na wypadek reklamacji / sprawdzania kto co kupił
const LOG_PATH = __DIR__ . '/productList/zakupy_log.csv';

// Układ arkusza
const FIRST_PRODUCT_ROW = 4;
const ROW_TEAM_NAME = 1;
const ROW_TEAM_CODE = 2;
const ROW_TEAM_TOKENS = 3;
const FIRST_TEAM_COL = 9;   // kolumna I
const COL_LP = 1, COL_NAME = 2, COL_BOUGHT = 3, COL_LEFT = 4, COL_START = 5, COL_LIMIT = 6, COL_PRICE = 7;

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

// ---------- Pomocnicze: adresy komórek ----------

function colToNum(string $col): int {
    $n = 0;
    for ($i = 0; $i < strlen($col); $i++) $n = $n * 26 + (ord($col[$i]) - 64);
    return $n;
}

function numToCol(int $n): string {
    $s = '';
    while ($n > 0) { $m = ($n - 1) % 26; $s = chr(65 + $m) . $s; $n = intdiv($n - 1, 26); }
    return $s;
}

function splitRef(string $ref): array {
    preg_match('/^([A-Z]+)(\d+)$/', $ref, $m);
    return [colToNum($m[1]), (int)$m[2]];
}

function fmtNum(float $v): string {
    return (floor($v) == $v) ? (string)(int)$v : rtrim(rtrim(sprintf('%.10F', $v), '0'), '.');
}

// ---------- Obsługa pliku xlsx (zip + XML) ----------

class Workbook {
    public ZipArchive $zip;
    public string $sheetPath;
    public DOMDocument $sheet;
    public DOMXPath $xp;
    public array $strings = [];
    /** @var array<int, array<int, DOMElement>> komórki [wiersz][kolumna] */
    public array $cells = [];
    /** @var array<int, DOMElement> */
    public array $rows = [];
    private string $file;

    public function __construct(string $file) {
        $this->file = $file;
        $this->zip = new ZipArchive();
        if ($this->zip->open($file) !== true) throw new RuntimeException('Nie można otworzyć pliku excela.');

        $this->sheetPath = $this->firstSheetPath();
        $this->loadStrings();

        $this->sheet = new DOMDocument();
        $this->sheet->preserveWhiteSpace = true;
        $this->sheet->loadXML($this->zip->getFromName($this->sheetPath));
        $this->xp = new DOMXPath($this->sheet);
        $this->xp->registerNamespace('m', NS_MAIN);

        foreach ($this->xp->query('//m:sheetData/m:row') as $row) {
            $r = (int)$row->getAttribute('r');
            $this->rows[$r] = $row;
            foreach ($this->xp->query('m:c', $row) as $c) {
                [$col, $rr] = splitRef($c->getAttribute('r'));
                $this->cells[$rr][$col] = $c;
            }
        }
    }

    // Ścieżka do pierwszego arkusza (na podstawie workbook.xml i jego relacji)
    private function firstSheetPath(): string {
        $wb = new DOMDocument();
        $wb->loadXML($this->zip->getFromName('xl/workbook.xml'));
        $sheet = $wb->getElementsByTagNameNS(NS_MAIN, 'sheet')->item(0);
        $rid = $sheet ? $sheet->getAttributeNS(NS_REL, 'id') : '';

        $rels = new DOMDocument();
        $rels->loadXML($this->zip->getFromName('xl/_rels/workbook.xml.rels'));
        foreach ($rels->getElementsByTagNameNS(NS_PKG_REL, 'Relationship') as $rel) {
            if ($rel->getAttribute('Id') === $rid) {
                $t = ltrim($rel->getAttribute('Target'), '/');
                return strpos($t, 'xl/') === 0 ? $t : 'xl/' . $t;
            }
        }
        return 'xl/worksheets/sheet1.xml';
    }

    private function loadStrings(): void {
        $xml = $this->zip->getFromName('xl/sharedStrings.xml');
        if ($xml === false) return;
        $d = new DOMDocument();
        $d->loadXML($xml);
        foreach ($d->getElementsByTagNameNS(NS_MAIN, 'si') as $si) {
            $txt = '';
            foreach ($si->getElementsByTagNameNS(NS_MAIN, 't') as $t) {
                // pomijamy teksty fonetyczne (rPh)
                if ($t->parentNode->localName === 'rPh') continue;
                $txt .= $t->textContent;
            }
            $this->strings[] = $txt;
        }
    }

    public function cell(int $row, int $col): ?DOMElement {
        return $this->cells[$row][$col] ?? null;
    }

    // Wartość komórki (dla formuł – ostatnio wyliczona wartość)
    public function value(int $row, int $col) {
        $c = $this->cell($row, $col);
        if (!$c) return null;
        $type = $c->getAttribute('t');
        if ($type === 'inlineStr') {
            $t = $this->xp->query('.//m:t', $c);
            $s = '';
            foreach ($t as $n) $s .= $n->textContent;
            return $s;
        }
        $v = $this->xp->query('m:v', $c)->item(0);
        if (!$v) return null;
        $raw = $v->textContent;
        if ($type === 's') return $this->strings[(int)$raw] ?? '';
        if ($type === 'str' || $type === 'e') return $raw;
        if ($type === 'b') return $raw === '1';
        return is_numeric($raw) ? $raw + 0 : $raw;
    }

    public function formula(int $row, int $col): ?string {
        $c = $this->cell($row, $col);
        if (!$c) return null;
        $f = $this->xp->query('m:f', $c)->item(0);
        return $f ? $f->textContent : null;
    }

    public function hasFormula(int $row, int $col): bool {
        $c = $this->cell($row, $col);
        return $c && $this->xp->query('m:f', $c)->length > 0;
    }

    // Zapis liczby do komórki; formuła (jeśli jest) zostaje, zmienia się tylko jej wyliczona wartość
    public function setNumber(int $row, int $col, float $num): void {
        $c = $this->cell($row, $col) ?? $this->createCell($row, $col);
        $c->removeAttribute('t');
        foreach (iterator_to_array($this->xp->query('m:is', $c)) as $is) $c->removeChild($is);
        $v = $this->xp->query('m:v', $c)->item(0);
        if (!$v) {
            $v = $this->sheet->createElementNS(NS_MAIN, 'v');
            $c->appendChild($v);
        }
        $v->textContent = fmtNum($num);
    }

    // Nowa komórka wstawiona we właściwym miejscu wiersza (kolejność kolumn ma znaczenie)
    private function createCell(int $row, int $col): DOMElement {
        if (!isset($this->rows[$row])) throw new RuntimeException("Brak wiersza $row w arkuszu.");
        $rowEl = $this->rows[$row];
        $c = $this->sheet->createElementNS(NS_MAIN, 'c');
        $c->setAttribute('r', numToCol($col) . $row);
        $next = null;
        foreach ($this->cells[$row] ?? [] as $cc => $el) {
            if ($cc > $col && ($next === null || $cc < $next[0])) $next = [$cc, $el];
        }
        $next ? $rowEl->insertBefore($c, $next[1]) : $rowEl->appendChild($c);
        $this->cells[$row][$col] = $c;
        return $c;
    }

    public function maxRow(): int {
        return $this->rows ? max(array_keys($this->rows)) : 0;
    }

    // Zapis: kopia tymczasowa -> podmiana pliku (atomowo)
    public function save(): void {
        $tmp = $this->file . '.tmp-' . bin2hex(random_bytes(4));
        $sheetXml = $this->sheet->saveXML();

        // Excel przeliczy wszystkie formuły przy otwarciu pliku
        $wb = new DOMDocument();
        $wb->loadXML($this->zip->getFromName('xl/workbook.xml'));
        $calc = $wb->getElementsByTagNameNS(NS_MAIN, 'calcPr')->item(0);
        if ($calc) $calc->setAttribute('fullCalcOnLoad', '1');
        $wbXml = $wb->saveXML();
        $this->zip->close();

        if (!copy($this->file, $tmp)) throw new RuntimeException('Nie można zapisać pliku excela (brak uprawnień?).');
        $z = new ZipArchive();
        if ($z->open($tmp) !== true) { @unlink($tmp); throw new RuntimeException('Nie można zapisać pliku excela.'); }
        $z->addFromString($this->sheetPath, $sheetXml);
        $z->addFromString('xl/workbook.xml', $wbXml);
        if (!$z->close()) { @unlink($tmp); throw new RuntimeException('Nie można zapisać pliku excela.'); }
        if (!rename($tmp, $this->file)) { @unlink($tmp); throw new RuntimeException('Nie można podmienić pliku excela.'); }
    }

    public function close(): void {
        @$this->zip->close();
    }
}

// ---------- Logika sklepu ----------

function isBlank($v): bool {
    return $v === null || (is_string($v) && trim($v) === '');
}

function readProducts(Workbook $wb): array {
    $products = [];
    $category = null;
    for ($r = FIRST_PRODUCT_ROW; $r <= $wb->maxRow(); $r++) {
        $lp = $wb->value($r, COL_LP);
        $name = $wb->value($r, COL_NAME);

        // Wiersz z samą nazwą w kolumnie A = nowa kategoria
        if (!isBlank($lp) && isBlank($name) && !is_numeric($lp)) {
            $category = trim((string)$lp);
            continue;
        }
        if (isBlank($name)) continue;

        $left = $wb->value($r, COL_LEFT);
        if (!is_numeric($left)) $left = is_numeric($wb->value($r, COL_START)) ? $wb->value($r, COL_START) : 0;
        $limit = $wb->value($r, COL_LIMIT);
        $price = $wb->value($r, COL_PRICE);

        $buyable = is_numeric($price) && is_numeric($limit) && $limit > 0;

        $products[] = [
            'row' => $r,
            'lp' => is_float($lp) ? fmtNum($lp) : trim((string)$lp),
            'name' => trim(preg_replace('/\s*\n\s*/', ' ', (string)$name)),
            'category' => $category,
            'left' => (int)$left,
            'limit' => isBlank($limit) ? null : (is_numeric($limit) ? (int)$limit : (string)$limit),
            'price' => is_numeric($price) ? (float)$price + 0 : null,
            'buyable' => $buyable,
        ];
    }
    return $products;
}

// Drużyny: nazwa w wierszu 1, kod w wierszu 2, żetony w wierszu 3 (kolumna kosztów), ilości w kolumnie obok
function readTeams(Workbook $wb): array {
    $teams = [];
    $maxCol = max(array_keys($wb->cells[ROW_TEAM_NAME] ?? [0 => null]));
    for ($c = FIRST_TEAM_COL; $c <= $maxCol; $c++) {
        $name = $wb->value(ROW_TEAM_NAME, $c);
        if (isBlank($name)) continue;
        $code = $wb->value(ROW_TEAM_CODE, $c);
        $teams[] = [
            'name' => trim((string)$name),
            'code' => isBlank($code) ? '' : trim(is_float($code) ? fmtNum($code) : (string)$code),
            'costCol' => $c,
            'qtyCol' => $c + 1,
        ];
    }
    return $teams;
}

function normalizeName(string $s): string {
    $s = preg_replace('/\s+/u', ' ', trim($s));
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

function findTeam(Workbook $wb, string $name, string $code): array {
    foreach (readTeams($wb) as $t) {
        if (normalizeName($t['name']) === normalizeName($name)) {
            if ($t['code'] === '' || !hash_equals($t['code'], trim($code))) fail('bad_code', 'Nieprawidłowy kod drużyny.');
            return $t;
        }
    }
    fail('bad_team', 'Nie ma drużyny o takiej nazwie.');
}

function teamState(Workbook $wb, array $team, array $products): array {
    $bought = [];
    foreach ($products as $p) {
        $q = $wb->value($p['row'], $team['qtyCol']);
        if (is_numeric($q) && $q > 0) $bought[$p['row']] = (int)$q;
    }
    $tokens = $wb->value(ROW_TEAM_TOKENS, $team['costCol']);
    return [
        'team' => $team['name'],
        'tokens' => is_numeric($tokens) ? $tokens + 0 : 0,
        'bought' => (object)$bought,
    ];
}

function fail(string $code, string $message, int $http = 400, array $extra = []): void {
    http_response_code($http);
    echo json_encode(['ok' => false, 'error' => $code, 'message' => $message] + $extra, JSON_UNESCAPED_UNICODE);
    exit;
}

function ok(array $data): void {
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE);
    exit;
}

function input(): array {
    $d = json_decode(file_get_contents('php://input') ?: '', true);
    return is_array($d) ? $d : [];
}

// ---------- Zakup ----------

function buy(Workbook $wb, array $req): array {
    $team = findTeam($wb, (string)($req['team'] ?? ''), (string)($req['code'] ?? ''));
    $products = readProducts($wb);
    $byRow = [];
    foreach ($products as $p) $byRow[$p['row']] = $p;

    // Zsumowanie pozycji (na wypadek powtórzeń) i walidacja
    $items = [];
    foreach ((array)($req['items'] ?? []) as $it) {
        $row = (int)($it['row'] ?? 0);
        $qty = $it['qty'] ?? 0;
        if (!is_numeric($qty) || (int)$qty != $qty || (int)$qty <= 0) fail('bad_qty', 'Nieprawidłowa ilość w koszyku.');
        if (!isset($byRow[$row])) fail('changed', 'Lista produktów się zmieniła – odśwież stronę.');
        if (isset($it['name']) && $it['name'] !== $byRow[$row]['name']) fail('changed', 'Lista produktów się zmieniła – odśwież stronę.');
        $items[$row] = ($items[$row] ?? 0) + (int)$qty;
    }
    if (!$items) fail('empty', 'Koszyk jest pusty.');

    $state = teamState($wb, $team, $products);
    $bought = (array)$state['bought'];
    $problems = [];
    $total = 0;
    foreach ($items as $row => $qty) {
        $p = $byRow[$row];
        $already = $bought[$row] ?? 0;
        if (!$p['buyable']) $problems[$row] = 'not_buyable';
        elseif ($qty > $p['left']) $problems[$row] = 'stock';
        elseif ($already + $qty > $p['limit']) $problems[$row] = 'limit';
        $total += $qty * ($p['price'] ?? 0);
    }
    if ($problems) fail('items', 'Nie można kupić niektórych produktów.', 409, ['problems' => (object)$problems]);
    if ($total > $state['tokens']) fail('tokens', 'Drużyna nie ma wystarczającej liczby żetonów.', 409);

    // --- Zapis do arkusza ---
    foreach ($items as $row => $qty) {
        $p = $byRow[$row];
        $newTeamQty = ($bought[$row] ?? 0) + $qty;

        // żółte pole: ilość kupiona przez drużynę
        $wb->setNumber($row, $team['qtyCol'], $newTeamQty);
        // łączny koszt tego produktu dla drużyny
        $wb->setNumber($row, $team['costCol'], $newTeamQty * ($p['price'] ?? 0));

        // "Kupiono w sumie"
        if ($wb->hasFormula($row, COL_BOUGHT)) {
            $sum = 0;
            foreach (readTeams($wb) as $t) {
                $v = $wb->value($row, $t['qtyCol']);
                if (is_numeric($v)) $sum += $v;
            }
            $newBought = $sum;
        } else {
            $old = $wb->value($row, COL_BOUGHT);
            $newBought = (is_numeric($old) ? $old : 0) + $qty;
        }
        $wb->setNumber($row, COL_BOUGHT, $newBought);

        // "Pozostało"
        if ($wb->hasFormula($row, COL_LEFT) && is_numeric($wb->value($row, COL_START))) {
            $newLeft = $wb->value($row, COL_START) - $newBought;
        } else {
            $newLeft = $p['left'] - $qty;
        }
        $wb->setNumber($row, COL_LEFT, $newLeft);
    }

    // Pozostałe żetony drużyny – wg formuły "=(3000 - SUM(I4:I103))"
    $f = $wb->formula(ROW_TEAM_TOKENS, $team['costCol']) ?? '';
    if (preg_match('/([\d.]+)\s*-\s*SUM\(\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*\)/i', $f, $m)) {
        $spent = 0;
        for ($r = (int)$m[3]; $r <= (int)$m[5]; $r++) {
            $v = $wb->value($r, $team['costCol']);
            if (is_numeric($v)) $spent += $v;
        }
        $newTokens = (float)$m[1] - $spent;
    } else {
        $newTokens = $state['tokens'] - $total;
    }
    $wb->setNumber(ROW_TEAM_TOKENS, $team['costCol'], $newTokens);

    $wb->save();
    logPurchase($team['name'], $items, $byRow, $total, $newTokens);

    return ['total' => $total];
}

function logPurchase(string $team, array $items, array $byRow, float $total, float $tokensLeft): void {
    $fh = @fopen(LOG_PATH, 'a');
    if (!$fh) return;
    if (filesize(LOG_PATH) === 0) fputcsv($fh, ['data', 'druzyna', 'produkt', 'ilosc', 'koszt', 'zetony_po_zakupie'], ';');
    $now = date('Y-m-d H:i:s');
    foreach ($items as $row => $qty) {
        fputcsv($fh, [$now, $team, $byRow[$row]['name'], $qty, $qty * ($byRow[$row]['price'] ?? 0), fmtNum($tokensLeft)], ';');
    }
    fclose($fh);
}

// ---------- Obsługa żądań ----------

date_default_timezone_set('Europe/Warsaw');
$action = $_GET['action'] ?? 'products';

if (!class_exists('ZipArchive')) fail('server', 'Brak rozszerzenia PHP zip na serwerze.', 500);
if (!is_file(XLSX_PATH)) fail('server', 'Nie znaleziono pliku excela.', 500);

$lock = fopen(LOCK_PATH, 'c');
if (!$lock) fail('server', 'Nie można utworzyć pliku blokady (brak uprawnień do zapisu?).', 500);

try {
    if ($action === 'products') {
        flock($lock, LOCK_SH);
        $wb = new Workbook(XLSX_PATH);
        $teams = array_map(fn($t) => $t['name'], readTeams($wb));
        ok(['products' => readProducts($wb), 'teams' => $teams]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('method', 'Wymagane żądanie POST.', 405);
    $req = input();

    if ($action === 'team') {
        flock($lock, LOCK_SH);
        $wb = new Workbook(XLSX_PATH);
        $team = findTeam($wb, (string)($req['team'] ?? ''), (string)($req['code'] ?? ''));
        ok(teamState($wb, $team, readProducts($wb)));
    }

    if ($action === 'buy') {
        flock($lock, LOCK_EX);
        $wb = new Workbook(XLSX_PATH);
        $res = buy($wb, $req);
        // Świeży odczyt po zapisie
        $wb2 = new Workbook(XLSX_PATH);
        $team = findTeam($wb2, (string)$req['team'], (string)$req['code']);
        $products = readProducts($wb2);
        ok($res + teamState($wb2, $team, $products) + ['products' => $products]);
    }

    fail('action', 'Nieznana akcja.', 404);
} catch (Throwable $e) {
    fail('server', 'Błąd serwera: ' . $e->getMessage(), 500);
} finally {
    flock($lock, LOCK_UN);
    fclose($lock);
}