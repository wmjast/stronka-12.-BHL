// ===== Sklep HW – odczyt produktów bezpośrednio z pliku Excel =====
// Wymaga biblioteki SheetJS (xlsx.full.min.js) załadowanej przed tym skryptem.

// Ścieżka do excela (względem <base href="/">)
const SHOP_XLSX_PATH = 'HWshop/productList/SklepHW_old_custom.xlsx';

// Folder ze zdjęciami – plik nazywamy numerem Lp., np. 5.jpg, 43.1.png
const SHOP_PHOTO_DIR = 'HWshop/productPhotos/';
const SHOP_PHOTO_EXT = ['jpg', 'png', 'webp'];
const SHOP_PHOTO_FALLBACK = SHOP_PHOTO_DIR + 'cegla-removebg-preview.png';

// Co ile ms odświeżać dane z excela (0 = bez odświeżania)
const SHOP_REFRESH_MS = 30000;

// Układ arkusza: wiersz 3 to nagłówki, produkty od wiersza 4 (indeksy od 0)
const SHOP_FIRST_ROW = 3;
const COL = { lp: 0, name: 1, left: 3, start: 4, limit: 5, price: 6 };

const shopLabels = {
  pl: { available: 'Dostępne', limit: 'Limit / drużyna', price: 'Cena', none: 'Brak produktów do wyświetlenia.', error: 'Nie udało się wczytać listy produktów.' },
  en: { available: 'Available', limit: 'Limit / team', price: 'Price', none: 'No products to display.', error: 'Could not load the product list.' }
};

// currentLang pochodzi z translator.js
function shopLang() {
  return (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'en' : 'pl';
}

function isEmpty(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

// Odmiana słowa „żeton” (1 żeton, 2 żetony, 5 żetonów)
function tokenWord(n, lang) {
  if (lang === 'en') return n === 1 ? 'token' : 'tokens';
  if (n === 1) return 'żeton';
  const d = n % 10, dd = n % 100;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'żetony';
  return 'żetonów';
}

// Zamiana wierszy arkusza na listę produktów pogrupowanych w kategorie
function parseProducts(rows) {
  const groups = [];
  let current = { name: null, items: [] };
  groups.push(current);

  for (let r = SHOP_FIRST_ROW; r < rows.length; r++) {
    const row = rows[r] || [];
    const lp = row[COL.lp];
    const name = row[COL.name];

    // Wiersz z samą nazwą w kolumnie A (np. "PŁYTKI") = nowa kategoria
    if (!isEmpty(lp) && isEmpty(name) && isNaN(Number(lp))) {
      current = { name: String(lp).trim(), items: [] };
      groups.push(current);
      continue;
    }
    if (isEmpty(name)) continue;

    // "Pozostało" bierzemy z wyliczonej formuły; awaryjnie = "Było na początku"
    let left = Number(row[COL.left]);
    if (isEmpty(row[COL.left]) || isNaN(left)) left = Number(row[COL.start]) || 0;

    current.items.push({
      lp: String(lp).trim(),
      name: String(name).replace(/\s*\n\s*/g, ' ').trim(),
      left: left,
      limit: isEmpty(row[COL.limit]) ? '—' : row[COL.limit],
      price: isEmpty(row[COL.price]) ? null : Number(row[COL.price])
    });
  }
  return groups.filter(g => g.items.length > 0);
}

// Zapamiętane adresy zdjęć (Lp. -> url), żeby przy odświeżaniu nie szukać ich od nowa
const photoCache = {};

function photoUrl(lp, extIdx) {
  return SHOP_PHOTO_DIR + encodeURIComponent(lp) + '.' + SHOP_PHOTO_EXT[extIdx];
}

// Podmiana zdjęcia na kolejne rozszerzenie, a na końcu na zaślepkę
function photoFallback(img) {
  const i = Number(img.dataset.extIdx) + 1;
  if (i < SHOP_PHOTO_EXT.length) {
    img.dataset.extIdx = i;
    img.src = photoUrl(img.dataset.lp, i);
  } else {
    img.onerror = null;
    img.src = SHOP_PHOTO_FALLBACK;
    photoCache[img.dataset.lp] = SHOP_PHOTO_FALLBACK;
  }
}

function photoLoaded(img) {
  if (!img.src.endsWith(SHOP_PHOTO_FALLBACK)) photoCache[img.dataset.lp] = img.getAttribute('src');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function productCard(p, lang) {
  const L = shopLabels[lang];
  const priceEn = p.price === null || isNaN(p.price) ? '—' : `${p.price} ${tokenWord(p.price, 'en')}`;
  const pricePl = p.price === null || isNaN(p.price) ? '—' : `${p.price} ${tokenWord(p.price, 'pl')}`;
  const priceTxt = lang === 'en' ? priceEn : pricePl;
  const soldOut =p.left <= 0 ? ' sold-out' : '';

  return `
    <div class="card product-card${soldOut}">
      <img class="main-image product-image" loading="lazy"
           src="${escapeHtml(photoCache[p.lp] || photoUrl(p.lp, 0))}"
           data-lp="${escapeHtml(p.lp)}" data-ext-idx="0"
           ${photoCache[p.lp] ? '' : 'onerror="photoFallback(this)" onload="photoLoaded(this)"'}
           alt="${escapeHtml(p.name)}">
      <h3 class="product-name">${escapeHtml(p.name)}</h3>
      <div class="product-stats">
        <div class="stat stat-available">
          <span class="stat-label" data-pl="${shopLabels.pl.available}" data-en="${shopLabels.en.available}">${L.available}</span>
          <span class="stat-value">${p.left}</span>
        </div>
        <div class="stat stat-limit">
          <span class="stat-label" data-pl="${shopLabels.pl.limit}" data-en="${shopLabels.en.limit}">${L.limit}</span>
          <span class="stat-value">${escapeHtml(p.limit)}</span>
        </div>
      </div>
      <div class="product-price">
        <span data-pl="${shopLabels.pl.price}" data-en="${shopLabels.en.price}">${L.price}</span>:
        <strong data-pl="${pricePl}" data-en="${priceEn}">${priceTxt}</strong>
      </div>
    </div>`;
}

// Ostatnio wyrenderowany stan – przerysowujemy tylko, gdy dane się zmieniły
let lastShopState = '';

function renderShop(groups) {
  const lang = shopLang();
  const box = document.getElementById('shop-products');

  const state = lang + JSON.stringify(groups);
  if (state === lastShopState) return;
  lastShopState = state;

  if (!groups.length) {
    box.innerHTML = `<p class="shop-status" data-pl="${shopLabels.pl.none}" data-en="${shopLabels.en.none}">${shopLabels[lang].none}</p>`;
    return;
  }

  box.innerHTML = groups.map(g => `
    ${g.name ? `<h3 class="shop-category">${escapeHtml(g.name)}</h3>` : ''}
    <div class="category-cards product-cards">
      ${g.items.map(p => productCard(p, lang)).join('')}
    </div>`).join('');
}

async function loadShop() {
  const box = document.getElementById('shop-products');
  try {
    // no-store + znacznik czasu, żeby zawsze brać najnowszą wersję pliku
    const res = await fetch(`${SHOP_XLSX_PATH}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const wb = XLSX.read(await res.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    renderShop(parseProducts(rows));
  } catch (err) {
    console.error('Sklep HW:', err);
    // Przy błędzie odświeżenia zostawiamy stare kafelki, jeśli już są
    if (!box.querySelector('.product-card')) {
      const lang = shopLang();
      box.innerHTML = `<p class="shop-status" data-pl="${shopLabels.pl.error}" data-en="${shopLabels.en.error}">${shopLabels[lang].error}</p>`;
    }
  }
}

loadShop();
if (SHOP_REFRESH_MS > 0) setInterval(loadShop, SHOP_REFRESH_MS);