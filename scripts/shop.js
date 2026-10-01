// ===== Sklep HW – kafelki produktów, koszyk i zakupy =====
// Dane pochodzą z excela przez HWshop/api.php (sam plik excela jest zablokowany,
// bo zawiera kody drużyn).

// Adres API (względem <base href="/">)
const SHOP_API = 'HWshop/api.php';

// Folder ze zdjęciami – plik nazywamy numerem Lp., np. 5.jpg, 43.1.png
const SHOP_PHOTO_DIR = 'HWshop/productPhotos/';
const SHOP_PHOTO_EXT = ['jpg', 'png', 'webp'];
const SHOP_PHOTO_FALLBACK = SHOP_PHOTO_DIR + 'cegla-removebg-preview.png';

// Co ile ms odświeżać dane (0 = bez odświeżania)
const SHOP_REFRESH_MS = 30000;

// Klucze w pamięci przeglądarki
const CART_KEY = 'bhlShopCart';
const TEAM_KEY = 'bhlShopTeam';

const T = {
  pl: {
    general: 'Ogólne', available: 'Dostępne', limit: 'Limit / drużyna', price: 'Cena',
    addToCart: 'Dodaj do koszyka', added: 'Dodano ✓',
    none: 'Brak produktów do wyświetlenia.', loadError: 'Nie udało się wczytać listy produktów.',
    cart: 'Koszyk', teamName: 'Nazwa drużyny', teamCode: 'Kod drużyny',
    teamOk: 'Drużyna zweryfikowana', teamChecking: 'Sprawdzanie drużyny…',
    teamNeeded: 'Wpisz nazwę i kod drużyny, aby dokonać zakupu.',
    empty: 'Koszyk jest pusty.', total: 'Razem', tokensLeft: 'Żetony drużyny',
    buy: 'Kup', buying: 'Kupowanie…', remove: 'Usuń',
    success: 'Zakup zrealizowany! Wydano: ', bought: 'kupiono już',
    gone: 'Produkt niedostępny', notBuyable: 'Produktu nie można kupić',
    stock: 'Dostępnych sztuk: ', limitTxt: 'Limit: ',
    tooExpensive: 'Za mało żetonów',
    err: {
      bad_team: 'Nie ma drużyny o takiej nazwie.', bad_code: 'Nieprawidłowy kod drużyny.',
      items: 'Nie można kupić niektórych produktów – sprawdź pozycje na czerwono.',
      tokens: 'Drużyna nie ma wystarczającej liczby żetonów.', empty: 'Koszyk jest pusty.',
      changed: 'Lista produktów się zmieniła – odśwież stronę.', network: 'Błąd połączenia z serwerem.'
    }
  },
  en: {
    general: 'General', available: 'Available', limit: 'Limit / team', price: 'Price',
    addToCart: 'Add to cart', added: 'Added ✓',
    none: 'No products to display.', loadError: 'Could not load the product list.',
    cart: 'Cart', teamName: 'Team name', teamCode: 'Team code',
    teamOk: 'Team verified', teamChecking: 'Checking team…',
    teamNeeded: 'Enter your team name and code to make a purchase.',
    empty: 'Your cart is empty.', total: 'Total', tokensLeft: 'Team tokens',
    buy: 'Buy', buying: 'Buying…', remove: 'Remove',
    success: 'Purchase complete! Spent: ', bought: 'already bought',
    gone: 'Product unavailable', notBuyable: 'This product cannot be bought',
    stock: 'In stock: ', limitTxt: 'Limit: ',
    tooExpensive: 'Not enough tokens',
    err: {
      bad_team: 'No team with this name.', bad_code: 'Wrong team code.',
      items: 'Some products cannot be bought – check the items in red.',
      tokens: 'Your team does not have enough tokens.', empty: 'Your cart is empty.',
      changed: 'The product list has changed – refresh the page.', network: 'Server connection error.'
    }
  }
};

// ---------- Stan ----------

let products = [];          // lista z API
let byRow = {};             // wiersz excela -> produkt
let teamNames = [];
let cart = loadJson(CART_KEY, {});   // wiersz -> ilość
let team = { verified: false, name: '', tokens: 0, bought: {} };
let serverProblems = {};    // błędy pozycji zwrócone przez serwer przy zakupie
let lastShopState = '';
const photoCache = {};

// currentLang pochodzi z translator.js
function shopLang() {
  return (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'en' : 'pl';
}
function t(key) { return T[shopLang()][key]; }

function loadJson(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; }
}
function saveJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* brak pamięci – trudno */ }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Odmiana słowa „żeton” (1 żeton, 2 żetony, 5 żetonów)
function tokenWord(n, lang) {
  if (lang === 'en') return n === 1 ? 'token' : 'tokens';
  if (n === 1) return 'żeton';
  const d = n % 10, dd = n % 100;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'żetony';
  return 'żetonów';
}
function tokens(n, lang = shopLang()) {
  return `${n} ${tokenWord(n, lang)}`;
}

async function api(action, body) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }
    : { cache: 'no-store' };
  const res = await fetch(`${SHOP_API}?action=${action}&t=${Date.now()}`, opts);
  let data;
  try { data = await res.json(); } catch (e) { throw { error: 'network', message: 'HTTP ' + res.status }; }
  if (!data.ok) throw data;
  return data;
}

function errText(e) {
  return T[shopLang()].err[e && e.error] || (e && e.message) || T[shopLang()].err.network;
}

// ---------- Zdjęcia ----------

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

// ---------- Kafelki ----------

function isActive(p) {
  return p.buyable && p.left > 0;
}

function productCard(p, lang) {
  const L = T[lang];
  const price = p.price === null ? '—' : tokens(p.price, lang);
  const priceAttr = p.price === null ? 'data-pl="—" data-en="—"' : `data-pl="${tokens(p.price, 'pl')}" data-en="${tokens(p.price, 'en')}"`;
  const soldOut = p.left <= 0 ? ' sold-out' : '';

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
          <span class="stat-label" data-pl="${T.pl.available}" data-en="${T.en.available}">${L.available}</span>
          <span class="stat-value">${p.left}</span>
        </div>
        <div class="stat stat-limit">
          <span class="stat-label" data-pl="${T.pl.limit}" data-en="${T.en.limit}">${L.limit}</span>
          <span class="stat-value">${escapeHtml(p.limit === null ? '—' : p.limit)}</span>
        </div>
      </div>
      <div class="product-price">
        <span data-pl="${T.pl.price}" data-en="${T.en.price}">${L.price}</span>:
        <strong ${priceAttr}>${price}</strong>
      </div>
      ${isActive(p) ? `<button type="button" class="add-to-cart" data-row="${p.row}"
          data-pl="${T.pl.addToCart}" data-en="${T.en.addToCart}">${L.addToCart}</button>` : ''}
    </div>`;
}

function renderShop(force) {
  const lang = shopLang();
  const box = document.getElementById('shop-products');

  const state = lang + JSON.stringify(products);
  if (!force && state === lastShopState) return;
  lastShopState = state;

  if (!products.length) {
    box.innerHTML = `<p class="shop-status">${t('none')}</p>`;
    return;
  }

  // Grupowanie wg kategorii; produkty bez kategorii (na początku arkusza) trafiają do „Ogólne”
  const groups = [];
  products.forEach(p => {
    const last = groups[groups.length - 1];
    if (!last || last.name !== p.category) groups.push({ name: p.category, items: [p] });
    else last.items.push(p);
  });

  box.innerHTML = groups.map(g => `
    <h3 class="shop-category" ${g.name === null ? `data-pl="${T.pl.general}" data-en="${T.en.general}"` : ''}>
      ${escapeHtml(g.name === null ? t('general') : g.name)}</h3>
    <div class="category-cards product-cards">
      ${g.items.map(p => productCard(p, lang)).join('')}
    </div>`).join('');
}

async function loadProducts() {
  const box = document.getElementById('shop-products');
  try {
    const data = await api('products');
    applyProducts(data.products);
    teamNames = data.teams || [];
    fillTeamList();
  } catch (err) {
    console.error('Sklep HW:', err);
    if (!box.querySelector('.product-card')) {
      box.innerHTML = `<p class="shop-status">${t('loadError')}</p>
        <p class="shop-status">(${escapeHtml(err.message || err)})</p>`;
    }
  }
}

function applyProducts(list) {
  products = list || [];
  byRow = {};
  products.forEach(p => { byRow[p.row] = p; });
  renderShop();
  if (cartIsOpen()) renderCart();
}

// ---------- Koszyk: dane ----------

function cartCount() {
  return Object.values(cart).reduce((a, b) => a + b, 0);
}

function setQty(row, qty) {
  qty = Math.max(0, Math.floor(Number(qty) || 0));
  if (qty === 0) delete cart[row];
  else cart[row] = qty;
  delete serverProblems[row];
  saveJson(CART_KEY, cart);
  updateBadge();
  if (cartIsOpen()) renderCart();
}

function addToCart(row) {
  setQty(row, (cart[row] || 0) + 1);
}

function updateBadge() {
  const badge = document.getElementById('cart-count');
  if (!badge) return;
  const n = cartCount();
  badge.textContent = n;
  badge.hidden = n === 0;
}

// Czy drużyna może kupić daną ilość? Zwraca { ok, reason }
function lineStatus(row, qty) {
  const p = byRow[row];
  const L = T[shopLang()];
  if (!p) return { ok: false, reason: L.gone };
  if (!p.buyable) return { ok: false, reason: L.notBuyable };
  if (qty > p.left) return { ok: false, reason: L.stock + p.left };
  const already = team.verified ? (team.bought[row] || 0) : 0;
  if (already + qty > p.limit) {
    return { ok: false, reason: L.limitTxt + p.limit + (already ? `, ${L.bought}: ${already}` : '') };
  }
  if (serverProblems[row]) return { ok: false, reason: L.err.items };
  return { ok: true, reason: '' };
}

function cartTotal() {
  return Object.entries(cart).reduce((sum, [row, qty]) => {
    const p = byRow[row];
    return sum + (p && p.price ? p.price * qty : 0);
  }, 0);
}

// ---------- Koszyk: okno ----------

function buildCartModal() {
  const L = T[shopLang()];
  const el = document.createElement('div');
  el.id = 'cart-overlay';
  el.className = 'cart-overlay';
  el.hidden = true;
  el.innerHTML = `
    <div class="cart-modal" role="dialog" aria-modal="true" aria-labelledby="cart-title">
      <div class="cart-head">
        <h3 id="cart-title" data-pl="${T.pl.cart}" data-en="${T.en.cart}">${L.cart}</h3>
        <button type="button" class="cart-close" aria-label="Zamknij">&times;</button>
      </div>

      <div class="cart-team">
        <label>
          <span data-pl="${T.pl.teamName}" data-en="${T.en.teamName}">${L.teamName}</span>
          <input type="text" id="cart-team-name" list="cart-team-list" autocomplete="off">
        </label>
        <datalist id="cart-team-list"></datalist>
        <label>
          <span data-pl="${T.pl.teamCode}" data-en="${T.en.teamCode}">${L.teamCode}</span>
          <input type="password" id="cart-team-code" autocomplete="off">
        </label>
      </div>
      <p id="cart-team-status" class="cart-team-status"></p>

      <div id="cart-items" class="cart-items"></div>

      <div class="cart-summary">
        <div><span data-pl="${T.pl.total}" data-en="${T.en.total}">${L.total}</span>: <strong id="cart-total"></strong></div>
        <div id="cart-tokens-row" hidden><span data-pl="${T.pl.tokensLeft}" data-en="${T.en.tokensLeft}">${L.tokensLeft}</span>: <strong id="cart-tokens"></strong></div>
      </div>

      <p id="cart-message" class="cart-message"></p>
      <button type="button" id="cart-buy" class="cart-buy" data-pl="${T.pl.buy}" data-en="${T.en.buy}">${L.buy}</button>
    </div>`;
  document.body.appendChild(el);

  // Zamykanie: krzyżyk, kliknięcie w tło, Esc
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('.cart-close')) closeCart();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && cartIsOpen()) closeCart();
  });

  // Zmiany ilości w koszyku
  el.querySelector('#cart-items').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.dataset.row;
    const q = cart[row] || 0;
    if (btn.dataset.act === 'inc') setQty(row, q + 1);
    if (btn.dataset.act === 'dec') setQty(row, q - 1);
    if (btn.dataset.act === 'del') setQty(row, 0);
  });
  el.querySelector('#cart-items').addEventListener('change', e => {
    if (e.target.matches('input[data-row]')) setQty(e.target.dataset.row, e.target.value);
  });

  // Dane drużyny – weryfikacja chwilę po wpisaniu
  const nameIn = el.querySelector('#cart-team-name');
  const codeIn = el.querySelector('#cart-team-code');
  nameIn.value = loadJson(TEAM_KEY, '');
  let timer;
  const onTeamInput = () => {
    team = { verified: false, name: '', tokens: 0, bought: {} };
    serverProblems = {};
    setMessage('');
    saveJson(TEAM_KEY, nameIn.value.trim());
    clearTimeout(timer);
    timer = setTimeout(verifyTeam, 600);
    renderCart();
  };
  nameIn.addEventListener('input', onTeamInput);
  codeIn.addEventListener('input', onTeamInput);

  el.querySelector('#cart-buy').addEventListener('click', buyCart);
}

function fillTeamList() {
  const list = document.getElementById('cart-team-list');
  if (list) list.innerHTML = teamNames.map(n => `<option value="${escapeHtml(n)}">`).join('');
}

function cartIsOpen() {
  const el = document.getElementById('cart-overlay');
  return el && !el.hidden;
}

function openCart() {
  document.getElementById('cart-overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  setMessage('');
  renderCart();
  verifyTeam();
}

function closeCart() {
  document.getElementById('cart-overlay').hidden = true;
  document.body.style.overflow = '';
}

function setMessage(text, kind) {
  const m = document.getElementById('cart-message');
  if (!m) return;
  m.textContent = text;
  m.className = 'cart-message' + (kind ? ' ' + kind : '');
}

function setTeamStatus(text, kind) {
  const s = document.getElementById('cart-team-status');
  s.textContent = text;
  s.className = 'cart-team-status' + (kind ? ' ' + kind : '');
}

async function verifyTeam(silent) {
  const name = document.getElementById('cart-team-name').value.trim();
  const code = document.getElementById('cart-team-code').value.trim();
  if (!name || !code) {
    setTeamStatus(t('teamNeeded'), '');
    return;
  }
  if (!silent) setTeamStatus(t('teamChecking'), '');
  try {
    const data = await api('team', { team: name, code: code });
    // Ktoś zdążył zmienić pola w trakcie sprawdzania
    if (name !== document.getElementById('cart-team-name').value.trim()
        || code !== document.getElementById('cart-team-code').value.trim()) return;
    team = { verified: true, name: data.team, tokens: data.tokens, bought: data.bought || {} };
    setTeamStatus(`${t('teamOk')}: ${data.team}`, 'ok');
  } catch (e) {
    team = { verified: false, name: '', tokens: 0, bought: {} };
    setTeamStatus(errText(e), 'bad');
  }
  renderCart();
}

function renderCart() {
  const L = T[shopLang()];
  const box = document.getElementById('cart-items');
  const rows = Object.keys(cart);

  if (!rows.length) {
    box.innerHTML = `<p class="cart-empty">${L.empty}</p>`;
  } else {
    box.innerHTML = rows.map(row => {
      const qty = cart[row];
      const p = byRow[row];
      const st = lineStatus(row, qty);
      const lineTotal = p && p.price !== null ? tokens(p.price * qty) : '—';
      return `
        <div class="cart-line ${st.ok ? 'ok' : 'bad'}">
          <div class="cart-line-name">
            ${escapeHtml(p ? p.name : L.gone)}
            ${st.reason ? `<small>${escapeHtml(st.reason)}</small>` : ''}
          </div>
          <div class="cart-qty">
            <button type="button" data-act="dec" data-row="${row}" aria-label="−">−</button>
            <input type="number" min="0" step="1" value="${qty}" data-row="${row}">
            <button type="button" data-act="inc" data-row="${row}" aria-label="+">+</button>
          </div>
          <div class="cart-line-total">${lineTotal}</div>
          <button type="button" class="cart-del" data-act="del" data-row="${row}" title="${L.remove}" aria-label="${L.remove}">&times;</button>
        </div>`;
    }).join('');
  }

  // Podsumowanie
  const total = cartTotal();
  const totalEl = document.getElementById('cart-total');
  totalEl.textContent = tokens(total);
  const tooExpensive = team.verified && total > team.tokens;
  totalEl.className = team.verified ? (tooExpensive ? 'bad' : 'ok') : '';

  document.getElementById('cart-tokens-row').hidden = !team.verified;
  document.getElementById('cart-tokens').textContent = team.verified ? tokens(team.tokens) : '';

  const allOk = rows.length > 0 && rows.every(r => lineStatus(r, cart[r]).ok);
  const buyBtn = document.getElementById('cart-buy');
  buyBtn.disabled = !(team.verified && allOk && !tooExpensive);
  if (tooExpensive && !document.getElementById('cart-message').textContent) {
    setMessage(L.tooExpensive, 'bad');
  } else if (!tooExpensive && document.getElementById('cart-message').textContent === L.tooExpensive) {
    setMessage('');
  }
}

async function buyCart() {
  const buyBtn = document.getElementById('cart-buy');
  const name = document.getElementById('cart-team-name').value.trim();
  const code = document.getElementById('cart-team-code').value.trim();
  const items = Object.entries(cart).map(([row, qty]) => ({
    row: Number(row), name: byRow[row] ? byRow[row].name : '', qty: qty
  }));

  buyBtn.disabled = true;
  buyBtn.textContent = t('buying');
  setMessage('');
  try {
    const data = await api('buy', { team: name, code: code, items: items });
    team = { verified: true, name: data.team, tokens: data.tokens, bought: data.bought || {} };
    cart = {};
    serverProblems = {};
    saveJson(CART_KEY, cart);
    updateBadge();
    applyProducts(data.products);
    setMessage(t('success') + tokens(data.total), 'ok');
  } catch (e) {
    serverProblems = (e && e.problems) || {};
    setMessage(errText(e), 'bad');
    // Odświeżenie danych – mogły się zmienić w międzyczasie
    await loadProducts();
    await verifyTeam();
  } finally {
    buyBtn.textContent = t('buy');
    renderCart();
  }
}

// ---------- Start ----------

// Zapasowa ikona koszyka (biały wózek w SVG), gdy brak pliku icons/cart_icon.png
const CART_ICON_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>' +
  '<path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>');

function initCartIcon() {
  const icon = document.getElementById('cart-icon');
  if (!icon) return;
  const useFallback = () => { icon.onerror = null; icon.src = CART_ICON_FALLBACK; };
  // Obrazek mógł się nie wczytać jeszcze przed uruchomieniem skryptu
  if (icon.complete && icon.naturalWidth === 0) useFallback();
  else icon.onerror = useFallback;
}

function initShop() {
  initCartIcon();
  buildCartModal();
  updateBadge();

  const cartBtn = document.getElementById('cart-button');
  if (cartBtn) cartBtn.addEventListener('click', e => { e.preventDefault(); openCart(); });

  // Przyciski „Dodaj do koszyka” na kafelkach
  document.getElementById('shop-products').addEventListener('click', e => {
    const btn = e.target.closest('.add-to-cart');
    if (!btn) return;
    addToCart(btn.dataset.row);
    btn.textContent = t('added');
    btn.classList.add('added');
    setTimeout(() => {
      btn.textContent = t('addToCart');
      btn.classList.remove('added');
    }, 1000);
  });

  // Po zmianie języka (translator.js) przerysowujemy elementy generowane dynamicznie
  const flag = document.getElementById('language-flag');
  if (flag) flag.addEventListener('click', () => {
    renderShop(true);
    if (cartIsOpen()) {
      renderCart();
      verifyTeam();
    }
  });

  loadProducts();
  if (SHOP_REFRESH_MS > 0) {
    setInterval(() => {
      loadProducts();
      if (cartIsOpen() && team.verified) verifyTeam(true);
    }, SHOP_REFRESH_MS);
  }
}

initShop();