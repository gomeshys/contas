import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ✅ SUA CONFIG (já aplicada)
const firebaseConfig = {
  apiKey: "AIzaSyAOx0-27hNlKBdMFQsBCc4nYaiIAFOkJL0",
  authDomain: "contas-d6d14.firebaseapp.com",
  projectId: "contas-d6d14",
  storageBucket: "contas-d6d14.firebasestorage.app",
  messagingSenderId: "794100309410",
  appId: "1:794100309410:web:3374f239698fe4a1fe26fb",
  measurementId: "G-P2YCPWLL9J"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// ===== Utils =====
function formatBRL(n) {
  return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function monthNowYYYYMM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function cryptoId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function dateBR(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function clampInt(n, min, max) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function monthFromISO(iso) {
  if (!iso || iso.length < 7) return monthNowYYYYMM();
  return iso.slice(0, 7);
}
function monthsDiff(startYYYYMM, currentYYYYMM) {
  const [y1, m1] = startYYYYMM.split("-").map(Number);
  const [y2, m2] = currentYYYYMM.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
function ymdWithDay(yyyyMM, day) {
  const dd = String(clampInt(day, 1, 31)).padStart(2, "0");
  return `${yyyyMM}-${dd}`;
}
function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function parseBRMoney(input) {
  if (input === null || input === undefined) return NaN;
  let s = String(input).trim();
  if (!s) return NaN;
  s = s.replace(/\s/g, "").replace(/^R\$/i, "");
  s = s.replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// ===== State =====
function defaultState() {
  return {
    version: 3,
    selectedMonth: monthNowYYYYMM(),
    months: {},
    installmentsTemplates: []
  };
}

let state = defaultState();
let userDocRef = null;
let unsub = null;
let isApplyingRemote = false;
let saveTimer = null;

function ensureMonth(monthYYYYMM) {
  if (!state.months[monthYYYYMM]) {
    state.months[monthYYYYMM] = { salario: 0, lancamentos: [] };
  }
  return state.months[monthYYYYMM];
}
function getMonthData() {
  return ensureMonth(state.selectedMonth);
}

function scheduleSave() {
  if (!userDocRef) return;
  if (isApplyingRemote) return;

  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await setDoc(userDocRef, state, { merge: true });
    } catch (e) {
      console.error(e);
      alert("Falha ao salvar no Firebase. Verifique internet/regras.");
    }
  }, 250);
}

// ===== Calculations =====
function calcResumoMes() {
  const md = getMonthData();
  const totalAPagar = md.lancamentos
    .filter(x => x.status === "nao_pago")
    .reduce((acc, x) => acc + Number(x.valor || 0), 0);

  const totalPagos = md.lancamentos
    .filter(x => x.status === "pago")
    .reduce((acc, x) => acc + Number(x.valor || 0), 0);

  const saldoAtual = Number(md.salario || 0) - totalAPagar;
  return { totalAPagar, totalPagos, saldoAtual };
}

function calcDividasPorCartaoMes() {
  const md = getMonthData();
  const map = {};
  for (const x of md.lancamentos) {
    if (x.tipo !== "divida") continue;
    const cartao = x.cartao || "—";
    if (!map[cartao]) map[cartao] = { aPagar: 0, pagos: 0, total: 0 };
    const v = Number(x.valor || 0);
    if (x.status === "nao_pago") map[cartao].aPagar += v;
    if (x.status === "pago") map[cartao].pagos += v;
    map[cartao].total += v;
  }
  return map;
}

function getLancamentosFiltered() {
  const md = getMonthData();
  const filtroTipo = elFiltroTipo.value;
  const filtroStatus = elFiltroStatus.value;

  return md.lancamentos
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .filter(x => (filtroTipo === "todos" ? true : x.tipo === filtroTipo))
    .filter(x => (filtroStatus === "todos" ? true : x.status === filtroStatus));
}

// ===== DOM =====
const elUserInfo = document.getElementById("userInfo");
const elMobileList = document.getElementById("mobileList");
const elMes = document.getElementById("mes");
const elSalario = document.getElementById("salario");
const elBtnSalvarSalario = document.getElementById("btnSalvarSalario");
const elSaldoAtual = document.getElementById("saldoAtual");
const elTotalAPagar = document.getElementById("totalAPagar");
const elTotalPagos = document.getElementById("totalPagos");

const elFormLancamento = document.getElementById("formLancamento");
const elTipo = document.getElementById("tipo");
const elStatus = document.getElementById("status");
const elCategoria = document.getElementById("categoria");
const elCartaoWrap = document.getElementById("cartaoWrap");
const elCartao = document.getElementById("cartao");
const elDescricao = document.getElementById("descricao");
const elValor = document.getElementById("valor");
const elData = document.getElementById("data");

const elFiltroTipo = document.getElementById("filtroTipo");
const elFiltroStatus = document.getElementById("filtroStatus");

const elCardsDividas = document.getElementById("cardsDividas");
const elTbody = document.getElementById("tbodyLancamentos");
const elVazio = document.getElementById("vazio");

const elBtnReset = document.getElementById("btnReset");
const elBtnExportBackup = document.getElementById("btnExportBackup");
const elFileImportBackup = document.getElementById("fileImportBackup");
const elBtnExportMonthCSV = document.getElementById("btnExportMonthCSV");

// Parcelados
const elFormParcelado = document.getElementById("formParcelado");
const elParTipo = document.getElementById("parTipo");
const elParCartaoWrap = document.getElementById("parCartaoWrap");
const elParCartao = document.getElementById("parCartao");
const elParCategoria = document.getElementById("parCategoria");
const elParDescricao = document.getElementById("parDescricao");
const elParValorParcela = document.getElementById("parValorParcela");
const elParTotal = document.getElementById("parTotal");
const elParPrimeiraData = document.getElementById("parPrimeiraData");
const elParPagasAte = document.getElementById("parPagasAte");
const elBtnGerarParcelasMes = document.getElementById("btnGerarParcelasMes");
const elListaParcelados = document.getElementById("listaParcelados");

// Modal edit
const elModalEdit = document.getElementById("modalEdit");
const elFormEdit = document.getElementById("formEdit");
const elEditId = document.getElementById("editId");
const elEditTipo = document.getElementById("editTipo");
const elEditStatus = document.getElementById("editStatus");
const elEditCategoria = document.getElementById("editCategoria");
const elEditCartaoWrap = document.getElementById("editCartaoWrap");
const elEditCartao = document.getElementById("editCartao");
const elEditDescricao = document.getElementById("editDescricao");
const elEditValor = document.getElementById("editValor");
const elEditData = document.getElementById("editData");

// ===== UI helpers =====
function syncCartaoVisibility() {
  elCartaoWrap.style.display = elTipo.value === "divida" ? "block" : "none";
}
function syncParCartaoVisibility() {
  elParCartaoWrap.style.display = elParTipo.value === "divida" ? "block" : "none";
}
function syncEditCartaoVisibility() {
  elEditCartaoWrap.style.display = elEditTipo.value === "divida" ? "block" : "none";
}

// ===== Lancamentos =====
function addLancamento(data) {
  const md = getMonthData();
  md.lancamentos.push({
    id: cryptoId(),
    tipo: data.tipo,
    status: data.status,
    categoria: data.categoria,
    descricao: data.descricao || "",
    valor: Number(data.valor || 0),
    dataISO: data.dataISO,
    cartao: data.tipo === "divida" ? (data.cartao || "—") : null,
    createdAt: Date.now(),
    origin: data.origin || "manual",
    installmentId: data.installmentId || null,
    installmentNumber: data.installmentNumber || null,
    installmentTotal: data.installmentTotal || null
  });
}

function findLancamentoById(id) {
  const md = getMonthData();
  return md.lancamentos.find(x => x.id === id);
}

function excluirLancamento(id) {
  if (!confirm("Excluir esse lançamento?")) return;
  const md = getMonthData();
  md.lancamentos = md.lancamentos.filter(x => x.id !== id);
  scheduleSave();
  renderAll();
}

function togglePago(id) {
  const item = findLancamentoById(id);
  if (!item) return;
  item.status = item.status === "pago" ? "nao_pago" : "pago";
  scheduleSave();
  renderAll();
}

// ===== Parcelados =====
function renderParcelados() {
  elListaParcelados.innerHTML = "";

  if (!state.installmentsTemplates.length) {
    elListaParcelados.innerHTML =
      `<div class="mini-item"><div class="left"><strong>Nenhum parcelado</strong><small>Crie um parcelado acima (ex: 12x)</small></div></div>`;
    return;
  }

  const items = state.installmentsTemplates
    .slice()
    .sort((a, b) => (a.firstDateISO || "").localeCompare(b.firstDateISO || ""));

  for (const it of items) {
    const row = document.createElement("div");
    row.className = "mini-item";

    const left = document.createElement("div");
    left.className = "left";
    const cartaoTxt = it.tipo === "divida" ? ` • ${escapeHtml(it.cartao || "")}` : "";
    left.innerHTML = `
      <strong>${escapeHtml(it.descricao)}</strong>
      <small>
        ${escapeHtml(it.categoria)}${cartaoTxt}
        • ${it.total}x de ${formatBRL(it.valorParcela)}
        • 1ª: ${dateBR(it.firstDateISO)}
        • já pagas: ${it.paidUpTo || 0}/${it.total}
      </small>
    `;

    const right = document.createElement("div");
    right.className = "right";

    const btnAtualizarPagas = document.createElement("button");
    btnAtualizarPagas.className = "iconbtn";
    btnAtualizarPagas.textContent = "Atualizar pagas";
    btnAtualizarPagas.onclick = () => {
      const novo = prompt(`Quantas parcelas já pagou? (0..${it.total})`, String(it.paidUpTo || 0));
      if (novo === null) return;
      it.paidUpTo = clampInt(novo, 0, it.total);
      scheduleSave();
      renderAll();
    };

    const btnDel = document.createElement("button");
    btnDel.className = "iconbtn";
    btnDel.textContent = "Remover";
    btnDel.onclick = () => {
      if (!confirm("Remover esse parcelado? (não apaga lançamentos já gerados)")) return;
      state.installmentsTemplates = state.installmentsTemplates.filter(x => x.id !== it.id);
      scheduleSave();
      renderAll();
    };

    right.appendChild(btnAtualizarPagas);
    right.appendChild(btnDel);

    row.appendChild(left);
    row.appendChild(right);
    elListaParcelados.appendChild(row);
  }
}

function gerarParcelasNoMes() {
  const month = state.selectedMonth;
  const md = getMonthData();
  let added = 0;

  for (const it of state.installmentsTemplates) {
    const startMonth = it.firstMonth || monthFromISO(it.firstDateISO);
    const diff = monthsDiff(startMonth, month);

    if (diff < 0) continue;
    if (diff >= it.total) continue;

    const parcelaNum = diff + 1;

    const exists = md.lancamentos.some(l =>
      l.origin === "installment" &&
      l.installmentId === it.id &&
      l.installmentNumber === parcelaNum
    );
    if (exists) continue;

    const paidUpTo = clampInt(it.paidUpTo || 0, 0, it.total);
    const status = parcelaNum <= paidUpTo ? "pago" : "nao_pago";

    const dia = clampInt(it.dayOfMonth || 5, 1, 31);
    const dataISO = ymdWithDay(month, dia);

    addLancamento({
      tipo: it.tipo,
      status,
      categoria: it.categoria,
      descricao: `${it.descricao} (${parcelaNum}/${it.total})`,
      valor: Number(it.valorParcela),
      dataISO,
      cartao: it.tipo === "divida" ? it.cartao : null,
      origin: "installment",
      installmentId: it.id,
      installmentNumber: parcelaNum,
      installmentTotal: it.total
    });

    added++;
  }

  scheduleSave();
  renderAll();
  alert(added ? `Parcelas geradas no mês: ${added}` : "Nenhuma parcela nova para gerar neste mês.");
}

// ===== Render =====
function renderResumo() {
  const md = getMonthData();
  elSalario.value = md.salario ? md.salario.toFixed(2).replace(".", ",") : "";

  const { totalAPagar, totalPagos, saldoAtual } = calcResumoMes();
  elSaldoAtual.textContent = formatBRL(saldoAtual);
  elTotalAPagar.textContent = formatBRL(totalAPagar);
  elTotalPagos.textContent = formatBRL(totalPagos);
  elSaldoAtual.style.color = saldoAtual < 0 ? "#991b1b" : "#166534";
}

function renderCardsDividas() {
  elCardsDividas.innerHTML = "";
  const md = getMonthData();
  const temDividas = md.lancamentos.some(x => x.tipo === "divida");
  if (!temDividas) return;

  const map = calcDividasPorCartaoMes();
  const entries = Object.entries(map).sort((a, b) => b[1].aPagar - a[1].aPagar);

  for (const [cartao, v] of entries) {
    const card = document.createElement("div");
    card.className = "mini-card";

    const title = document.createElement("div");
    title.className = "mini-title";
    title.innerHTML = `<span>${escapeHtml(cartao)}</span>`;

    const tag = document.createElement("div");
    tag.className = "tag " + (v.aPagar > 0 ? "warn" : "ok");
    tag.textContent = v.aPagar > 0 ? "Em aberto" : "Ok";
    title.appendChild(tag);

    const k1 = document.createElement("div");
    k1.className = "kpi";
    k1.innerHTML = `<span>A pagar</span><strong>${formatBRL(v.aPagar)}</strong>`;

    const k2 = document.createElement("div");
    k2.className = "kpi";
    k2.innerHTML = `<span>Pagos</span><strong>${formatBRL(v.pagos)}</strong>`;

    const k3 = document.createElement("div");
    k3.className = "kpi";
    k3.innerHTML = `<span>Total</span><strong>${formatBRL(v.total)}</strong>`;

    card.appendChild(title);
    card.appendChild(k1);
    card.appendChild(k2);
    card.appendChild(k3);
    elCardsDividas.appendChild(card);
  }
}
function renderMobileList() {
  if (!elMobileList) return;
  const itens = getLancamentosFiltered();
  elMobileList.innerHTML = "";

  // Se não tem itens, não mostra nada (o "vazio" já aparece)
  if (!itens.length) return;

  for (const item of itens) {
    const wrap = document.createElement("div");
    wrap.className = "m-item " + (item.status === "pago" ? "paid" : "unpaid");

    const tipoTxt = item.tipo === "divida" ? "Dívida" : "Despesa";
    const statusTxt = item.status === "pago" ? "Pago" : "Não pago";
    const cartaoTxt = item.tipo === "divida" ? (item.cartao || "—") : "—";

    wrap.innerHTML = `
      <div class="m-head">
        <div class="m-title">
          <strong>${escapeHtml(item.descricao || "(Sem descrição)")}</strong>
          <small>${dateBR(item.dataISO)} • ${tipoTxt} • ${escapeHtml(item.categoria || "Outros")}</small>
        </div>
        <div class="m-value ${item.status === "pago" ? "pos" : "neg"}">${formatBRL(item.valor)}</div>
      </div>

      <div class="m-meta">
        <div><b>Status:</b> ${statusTxt}</div>
        <div><b>Cartão:</b> ${escapeHtml(cartaoTxt)}</div>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "m-actions";

    const btnToggle = document.createElement("button");
    btnToggle.className = "iconbtn";
    btnToggle.textContent = item.status === "pago" ? "Marcar não pago" : "Marcar pago";
    btnToggle.onclick = () => togglePago(item.id);

    const btnEdit = document.createElement("button");
    btnEdit.className = "iconbtn";
    btnEdit.textContent = "Editar";
    btnEdit.onclick = () => openEditModal(item.id);

    const btnDel = document.createElement("button");
    btnDel.className = "iconbtn";
    btnDel.textContent = "Excluir";
    btnDel.onclick = () => excluirLancamento(item.id);

    actions.appendChild(btnToggle);
    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);

    wrap.appendChild(actions);
    elMobileList.appendChild(wrap);
  }
}

function renderTable() {
  const itens = getLancamentosFiltered();
  elTbody.innerHTML = "";

  if (itens.length === 0) {
    elVazio.style.display = "block";
    return;
  }
  elVazio.style.display = "none";

  for (const item of itens) {
    const tr = document.createElement("tr");
    tr.className = item.status === "pago" ? "paid" : "unpaid";

    const tdData = document.createElement("td");
    tdData.textContent = dateBR(item.dataISO);

    const tdTipo = document.createElement("td");
    tdTipo.textContent = item.tipo === "divida" ? "Dívida" : "Despesa";

    const tdCartao = document.createElement("td");
    tdCartao.textContent = item.tipo === "divida" ? (item.cartao || "—") : "—";

    const tdCat = document.createElement("td");
    tdCat.textContent = item.categoria || "Outros";

    const tdDesc = document.createElement("td");
    tdDesc.textContent = item.descricao || "";

    const tdStatus = document.createElement("td");
    const span = document.createElement("span");
    span.className = "status-pill " + (item.status === "pago" ? "paid" : "unpaid");
    span.textContent = item.status === "pago" ? "Pago" : "Não pago";
    tdStatus.appendChild(span);

    const tdValor = document.createElement("td");
    tdValor.className = "value " + (item.status === "pago" ? "pos" : "neg");
    tdValor.textContent = formatBRL(item.valor);

    const tdAcoes = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "actions";

    const btnToggle = document.createElement("button");
    btnToggle.className = "iconbtn";
    btnToggle.textContent = item.status === "pago" ? "Marcar não pago" : "Marcar pago";
    btnToggle.onclick = () => togglePago(item.id);

    const btnEdit = document.createElement("button");
    btnEdit.className = "iconbtn";
    btnEdit.textContent = "Editar";
    btnEdit.onclick = () => openEditModal(item.id);

    const btnDel = document.createElement("button");
    btnDel.className = "iconbtn";
    btnDel.textContent = "Excluir";
    btnDel.onclick = () => excluirLancamento(item.id);

    actions.appendChild(btnToggle);
    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);
    tdAcoes.appendChild(actions);

    tr.appendChild(tdData);
    tr.appendChild(tdTipo);
    tr.appendChild(tdCartao);
    tr.appendChild(tdCat);
    tr.appendChild(tdDesc);
    tr.appendChild(tdStatus);
    tr.appendChild(tdValor);
    tr.appendChild(tdAcoes);

    elTbody.appendChild(tr);
  }
}

function renderAll() {
  syncCartaoVisibility();
  syncParCartaoVisibility();
  renderResumo();
  renderCardsDividas();
  renderTable();
  renderParcelados();
  renderMobileList();
}

// ===== Modal edit =====
function openEditModal(id) {
  const item = findLancamentoById(id);
  if (!item) return;

  elEditId.value = item.id;
  elEditTipo.value = item.tipo;
  elEditStatus.value = item.status;
  elEditCategoria.value = item.categoria || "Outros";
  elEditDescricao.value = item.descricao || "";
  elEditValor.value = String(item.valor ?? "").replace(".", ",");
  elEditData.value = item.dataISO || todayISO();

  if (item.tipo === "divida") {
    elEditCartao.value = item.cartao || "Nubank";
    elEditCartaoWrap.style.display = "block";
  } else {
    elEditCartaoWrap.style.display = "none";
  }

  elModalEdit.showModal();
}

elEditTipo.addEventListener("change", syncEditCartaoVisibility);

elFormEdit.addEventListener("submit", (e) => {
  e.preventDefault();

  const id = elEditId.value;
  const item = findLancamentoById(id);
  if (!item) { elModalEdit.close(); return; }

  const tipo = elEditTipo.value;
  const status = elEditStatus.value;
  const categoria = elEditCategoria.value;
  const descricao = (elEditDescricao.value || "").trim();
  const valor = parseBRMoney(elEditValor.value);
  const dataISO = elEditData.value || todayISO();

  if (!Number.isFinite(valor) || valor <= 0) return alert("Valor inválido. Ex: 120,82");

  item.tipo = tipo;
  item.status = status;
  item.categoria = categoria;
  item.descricao = descricao;
  item.valor = valor;
  item.dataISO = dataISO;
  item.cartao = tipo === "divida" ? (elEditCartao.value || "—") : null;

  scheduleSave();
  elModalEdit.close();
  renderAll();
});

// ===== Eventos =====
function bootUI() {
  ensureMonth(state.selectedMonth);
  elMes.value = state.selectedMonth;
  elData.value = todayISO();
  elParPrimeiraData.value = todayISO();
  syncCartaoVisibility();
  syncParCartaoVisibility();
}

elMes.addEventListener("change", () => {
  const v = elMes.value;
  if (!v) return;
  state.selectedMonth = v;
  ensureMonth(v);
  scheduleSave();
  renderAll();
});

elTipo.addEventListener("change", syncCartaoVisibility);
elParTipo.addEventListener("change", syncParCartaoVisibility);

elBtnSalvarSalario.addEventListener("click", () => {
  const md = getMonthData();
  const v = parseBRMoney(elSalario.value);
  if (!Number.isFinite(v) || v < 0) return alert("Digite um salário válido.");
  md.salario = v;
  scheduleSave();
  renderAll();
});

elFormLancamento.addEventListener("submit", (e) => {
  e.preventDefault();

  const tipo = elTipo.value;
  const status = elStatus.value;
  const categoria = elCategoria.value;
  const descricao = (elDescricao.value || "").trim();
  const valor = parseBRMoney(elValor.value);
  const dataISO = elData.value || todayISO();
  const cartao = tipo === "divida" ? elCartao.value : null;

  if (!Number.isFinite(valor) || valor <= 0) return alert("Valor inválido. Ex: 120,82");

  addLancamento({ tipo, status, categoria, descricao, valor, dataISO, cartao, origin: "manual" });

  elDescricao.value = "";
  elValor.value = "";
  elData.value = todayISO();

  scheduleSave();
  renderAll();
});

elFiltroTipo.addEventListener("change", renderAll);
elFiltroStatus.addEventListener("change", renderAll);

elFormParcelado.addEventListener("submit", (e) => {
  e.preventDefault();

  const tipo = elParTipo.value;
  const cartao = tipo === "divida" ? elParCartao.value : null;
  const categoria = elParCategoria.value;
  const descricao = (elParDescricao.value || "").trim();
  const valorParcela = parseBRMoney(elParValorParcela.value);
  const total = clampInt(elParTotal.value, 2, 60);
  const firstDateISO = elParPrimeiraData.value || todayISO();
  const paidUpTo = clampInt(elParPagasAte.value || 0, 0, total);

  if (!descricao) return alert("Digite a descrição do parcelado.");
  if (!Number.isFinite(valorParcela) || valorParcela <= 0) return alert("Valor inválido. Ex: 199,90");

  const firstMonth = monthFromISO(firstDateISO);
  const dayOfMonth = clampInt(firstDateISO.slice(8, 10), 1, 31);

  state.installmentsTemplates.push({
    id: cryptoId(),
    tipo,
    cartao,
    categoria,
    descricao,
    valorParcela,
    total,
    firstDateISO,
    firstMonth,
    dayOfMonth,
    paidUpTo
  });

  elParDescricao.value = "";
  elParValorParcela.value = "";
  elParTotal.value = "";
  elParPagasAte.value = "";
  elParPrimeiraData.value = todayISO();

  scheduleSave();
  renderAll();
});

elBtnGerarParcelasMes.addEventListener("click", () => {
  if (!state.installmentsTemplates.length) return alert("Você não tem parcelados cadastrados.");
  gerarParcelasNoMes();
});

// Backup / import / reset
elBtnExportBackup.addEventListener("click", () => {
  downloadText(`backup_financas_v3_${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
});

elFileImportBackup.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      state = {
        version: 3,
        selectedMonth: typeof parsed.selectedMonth === "string" ? parsed.selectedMonth : monthNowYYYYMM(),
        months: parsed.months && typeof parsed.months === "object" ? parsed.months : {},
        installmentsTemplates: Array.isArray(parsed.installmentsTemplates) ? parsed.installmentsTemplates : []
      };
      bootUI();
      scheduleSave();
      renderAll();
      alert("Backup importado!");
    } catch {
      alert("Falha ao importar. Envie um JSON do backup do app.");
    }
  };
  reader.readAsText(f);
  elFileImportBackup.value = "";
});

elBtnExportMonthCSV.addEventListener("click", () => {
  const md = getMonthData();
  const rows = [];
  rows.push(["Data","Tipo","Cartão","Categoria","Descrição","Status","Valor"].join(";"));

  for (const l of md.lancamentos.slice().sort((a,b)=> (a.dataISO||"").localeCompare(b.dataISO||""))) {
    const tipo = l.tipo === "divida" ? "Dívida" : "Despesa";
    const cartao = l.tipo === "divida" ? (l.cartao || "") : "";
    const status = l.status === "pago" ? "Pago" : "Não pago";
    const valor = String(Number(l.valor || 0)).toFixed(2).replace(".", ",");
    rows.push([l.dataISO || "", tipo, cartao, (l.categoria||""), (l.descricao||"").replaceAll(";", ","), status, valor].join(";"));
  }

  downloadText(`lancamentos_${state.selectedMonth}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
});

elBtnReset.addEventListener("click", () => {
  const ok = confirm("Isso vai resetar SOMENTE o mês selecionado (salário + lançamentos). Continuar?");
  if (!ok) return;
  state.months[state.selectedMonth] = { salario: 0, lancamentos: [] };
  scheduleSave();
  renderAll();
});

// ===== Firebase init =====
async function startFirebase() {
  try {
    await signInAnonymously(auth);
  } catch (e) {
    console.error("Erro no signInAnonymously:", e);
    alert("Erro ao autenticar (Anonymous). Vá em Authentication > Sign-in method e habilite Anonymous.");
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    elUserInfo.textContent = `Conectado • UID: ${user.uid.slice(0, 8)}…`;
    userDocRef = doc(db, "users", user.uid);

    // ✅ cria/garante o doc do usuário imediatamente
    try {
      await setDoc(userDocRef, defaultState(), { merge: true });
    } catch (e) {
      console.error("Erro ao criar doc inicial:", e);
      alert("Não consegui escrever no Firestore. Provável: Rules/Permissão.");
      return;
    }

    if (unsub) unsub();
    unsub = onSnapshot(userDocRef, (snap) => {
      const remote = snap.data();
      if (!remote || typeof remote !== "object") return;

      isApplyingRemote = true;
      state = {
        version: 3,
        selectedMonth: typeof remote.selectedMonth === "string" ? remote.selectedMonth : monthNowYYYYMM(),
        months: remote.months && typeof remote.months === "object" ? remote.months : {},
        installmentsTemplates: Array.isArray(remote.installmentsTemplates) ? remote.installmentsTemplates : []
      };
      isApplyingRemote = false;

      bootUI();
      renderAll();
    });
  });
}

bootUI();
renderAll();
startFirebase();
