/* My Money Tracker — application logic (vanilla JS + Supabase) */
/* global supabase */
(function () {
  'use strict';

  // ───────────────────────── Config & client ─────────────────────────
  const cfg = window.APP_CONFIG || {};
  const placeholder = /YOUR_PROJECT|YOUR_ANON/i;
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || placeholder.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) {
    document.getElementById('config-error').classList.remove('hidden');
    return;
  }
  const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // ───────────────────────── Constants & state ─────────────────────────
  const DEFAULT_CATEGORIES = {
    income: ['Salary', 'Other Income'],
    expense: ['Loan/EMI', 'Rent', 'Food', 'Electricity', 'Travel', 'Shopping', 'Other'],
  };
  const EMI_CATEGORY = 'Loan/EMI';
  const PAGE = 1000; // Supabase default max rows per request

  const state = {
    user: null,
    month: thisMonth(),      // "YYYY-MM"
    view: 'dashboard',
    categories: [],
    txns: [],                // all transactions of the user
    loans: [],
    settings: null,
  };

  // ───────────────────────── Helpers ─────────────────────────
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const fmt = (n) => inr.format(Math.round(Number(n) || 0));
  function pad(n) { return String(n).padStart(2, '0'); }
  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function thisMonth() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function shiftMonth(m, delta) {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function monthLabel(m, short) {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 1, 1);
    return short
      ? d.toLocaleString('en-IN', { month: 'short' }) + ' ' + String(y).slice(2)
      : d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  }
  function dateLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const monthOf = (iso) => iso.slice(0, 7);
  function defaultDateForMonth() { return state.month === thisMonth() ? todayISO() : state.month + '-01'; }

  let toastTimer;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), isError ? 4500 : 2200);
  }

  // ───────────────────────── Auth ─────────────────────────
  let signupMode = false;
  function authMessage(text, kind) {
    const el = $('#auth-message');
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.className = 'msg ' + (kind || 'error');
  }
  $('#auth-toggle').addEventListener('click', () => {
    signupMode = !signupMode;
    $('#auth-submit').textContent = signupMode ? 'Create account' : 'Sign in';
    $('#auth-toggle').textContent = signupMode ? 'Already have an account? Sign in' : 'New here? Create an account';
    $('#auth-password').autocomplete = signupMode ? 'new-password' : 'current-password';
    authMessage('');
  });
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const btn = $('#auth-submit');
    btn.disabled = true;
    authMessage('');
    try {
      const { data, error } = signupMode
        ? await sb.auth.signUp({ email, password })
        : await sb.auth.signInWithPassword({ email, password });
      if (error) authMessage(error.message);
      else if (signupMode && !data.session) authMessage('Account created. Check your email to confirm it, then sign in.', 'info');
    } finally {
      btn.disabled = false;
    }
  });
  $('#logout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
  });

  sb.auth.onAuthStateChange((_event, session) => {
    // Defer: Supabase docs advise not to await other client calls inside this callback.
    setTimeout(() => {
      if (session && session.user) {
        if (!state.user || state.user.id !== session.user.id) {
          state.user = session.user;
          enterApp();
        }
      } else {
        state.user = null;
        showAuth();
      }
    }, 0);
  });

  function showAuth() {
    $('#app-view').classList.add('hidden');
    $('#auth-view').classList.remove('hidden');
    $('#auth-password').value = '';
  }

  async function enterApp() {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#loading').classList.remove('hidden');
    try {
      await Promise.all([loadCategories(), loadSettings(), loadLoans(), loadTransactions()]);
      $('#loading').classList.add('hidden');
      renderAll();
    } catch (err) {
      $('#loading').textContent = 'Could not load data: ' + (err.message || err);
      toast(err.message || String(err), true);
    }
  }

  // ───────────────────────── Data access ─────────────────────────
  async function loadCategories() {
    let { data, error } = await sb.from('categories').select('*').order('name');
    if (error) throw error;
    if (!data.length) {
      const rows = [];
      for (const type of Object.keys(DEFAULT_CATEGORIES)) {
        DEFAULT_CATEGORIES[type].forEach((name) => rows.push({ name, type }));
      }
      const res = await sb.from('categories').insert(rows).select();
      if (res.error) throw res.error;
      data = res.data;
    }
    state.categories = data;
  }

  async function loadSettings() {
    const { data, error } = await sb.from('settings').select('*').maybeSingle();
    if (error) throw error;
    if (data) { state.settings = data; return; }
    const res = await sb.from('settings').insert({ savings_target_pct: 20 }).select().single();
    if (res.error) throw res.error;
    state.settings = res.data;
  }

  async function loadLoans() {
    const { data, error } = await sb.from('loans').select('*').order('created_at');
    if (error) throw error;
    state.loans = data;
  }

  async function loadTransactions() {
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('transactions').select('*')
        .order('txn_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    state.txns = all;
  }

  async function ensureEmiCategory() {
    let cat = state.categories.find((c) => c.type === 'expense' && c.name === EMI_CATEGORY);
    if (cat) return cat;
    const { data, error } = await sb.from('categories').insert({ name: EMI_CATEGORY, type: 'expense' }).select().single();
    if (error) throw error;
    state.categories.push(data);
    return data;
  }

  // ───────────────────────── Calculations ─────────────────────────
  function catName(id) {
    const c = state.categories.find((x) => x.id === id);
    return c ? c.name : 'Uncategorised';
  }
  const isEmi = (t) => t.type === 'expense' && (!!t.loan_id || catName(t.category_id) === EMI_CATEGORY);
  const monthTxns = (m) => state.txns.filter((t) => monthOf(t.txn_date) === m);

  function monthSummary(m) {
    const tx = monthTxns(m);
    const income = sum(tx.filter((t) => t.type === 'income'), (t) => +t.amount);
    const expenses = sum(tx.filter((t) => t.type === 'expense'), (t) => +t.amount);
    const emi = sum(tx.filter(isEmi), (t) => +t.amount);
    const savings = income - expenses;
    return { month: m, income, expenses, emi, other: expenses - emi, savings, pct: income > 0 ? (savings / income) * 100 : 0 };
  }

  function savingsTarget(income) {
    const s = state.settings || {};
    if (s.savings_target_amount && +s.savings_target_amount > 0) return +s.savings_target_amount;
    return (income * (+s.savings_target_pct || 0)) / 100;
  }

  function byCategory(tx) {
    const map = new Map();
    tx.forEach((t) => {
      const name = catName(t.category_id);
      map.set(name, (map.get(name) || 0) + +t.amount);
    });
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }

  // ───────────────────────── Rendering ─────────────────────────
  function renderAll() {
    $('#month-label').textContent = monthLabel(state.month);
    $$('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + state.view));
    const renderers = {
      dashboard: renderDashboard,
      income: () => renderList('income'),
      expenses: () => renderList('expense'),
      loans: renderLoans,
      reports: renderReports,
    };
    renderers[state.view]();
  }

  function deltaHtml(cur, prev, goodWhenUp) {
    if (!cur && !prev) return '';
    const d = cur - prev;
    if (d === 0) return '<span class="delta">Same as last month</span>';
    const up = d > 0;
    const cls = up === goodWhenUp ? 'good' : 'bad';
    return `<span class="delta ${cls}">${up ? '▲' : '▼'} ${fmt(Math.abs(d))} vs last month</span>`;
  }

  function renderDashboard() {
    const m = state.month;
    const cur = monthSummary(m);
    const prev = monthSummary(shiftMonth(m, -1));
    const target = savingsTarget(cur.income);
    const progress = target > 0 ? Math.max(0, Math.min(100, (cur.savings / target) * 100)) : 0;
    const s = state.settings;
    const targetLabel = s.savings_target_amount && +s.savings_target_amount > 0
      ? `${fmt(s.savings_target_amount)} per month`
      : `${(+s.savings_target_pct || 0)}% of income`;

    const history = [];
    for (let i = 5; i >= 0; i--) history.push(monthSummary(shiftMonth(m, -i)));

    $('#view-dashboard').innerHTML = `
      <div class="card hero">
        <div class="hero-label">Monthly Income · ${esc(monthLabel(m))}</div>
        <div class="hero-value">${fmt(cur.income)}</div>
        ${deltaHtml(cur.income, prev.income, true)}
      </div>

      <div class="card">
        <div class="row"><span>Expenses</span><strong>${fmt(cur.expenses)}</strong></div>
        <div class="row sub"><span>EMI</span><span>${fmt(cur.emi)}</span></div>
        <div class="row sub"><span>Other Expenses</span><span>${fmt(cur.other)}</span></div>
        ${deltaHtml(cur.expenses, prev.expenses, false)}
        <hr>
        <div class="row big"><span>Available Balance</span><strong class="${cur.savings < 0 ? 'neg' : 'pos'}">${fmt(cur.savings)}</strong></div>
        <div class="row"><span>Savings</span><span>${fmt(cur.savings)} <span class="muted">(${cur.pct.toFixed(0)}% of income)</span></span></div>
        ${deltaHtml(cur.savings, prev.savings, true)}
      </div>

      <div class="card">
        <div class="row"><span>🎯 Savings Goal <span class="muted">· ${esc(targetLabel)}</span></span><button class="link" data-action="edit-target">Edit</button></div>
        <div class="progress"><div style="width:${progress}%"></div></div>
        <div class="row sub"><span>${fmt(Math.max(cur.savings, 0))} of ${fmt(target)}</span><span>${progress.toFixed(0)}%</span></div>
      </div>

      <div class="actions">
        <button class="btn primary" data-action="add-txn" data-type="income">+ Add Income</button>
        <button class="btn secondary" data-action="add-txn" data-type="expense">+ Add Expense</button>
      </div>

      <div class="menu">
        <button data-action="nav" data-view="expenses">🧾 Monthly Expenses</button>
        <button data-action="nav" data-view="loans">💳 Loans</button>
        <button data-action="edit-target">🎯 Savings Goal</button>
        <button data-action="nav" data-view="reports">📈 Reports</button>
      </div>

      <div class="card">
        <h3>Last 6 months</h3>
        <table>
          <thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>Savings</th></tr></thead>
          <tbody>
            ${history.map((h) => `<tr class="${h.month === m ? 'current' : ''}">
              <td>${esc(monthLabel(h.month, true))}</td><td>${fmt(h.income)}</td><td>${fmt(h.expenses)}</td>
              <td class="${h.savings < 0 ? 'neg' : ''}">${fmt(h.savings)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderList(type) {
    const el = $(type === 'income' ? '#view-income' : '#view-expenses');
    const tx = monthTxns(state.month).filter((t) => t.type === type);
    const total = sum(tx, (t) => +t.amount);
    const cats = byCategory(tx);
    const groups = new Map();
    tx.forEach((t) => { if (!groups.has(t.txn_date)) groups.set(t.txn_date, []); groups.get(t.txn_date).push(t); });

    el.innerHTML = `
      <div class="card">
        <div class="list-head">
          <div>
            <h3>${type === 'income' ? 'Income' : 'Expenses'} · ${esc(monthLabel(state.month))}</h3>
            <div class="total">${fmt(total)}</div>
          </div>
          <button class="btn small" data-action="categories" data-type="${type}">Categories</button>
        </div>
        ${cats.length ? `<div class="chips">${cats.map((c) => `<span class="chip">${esc(c.label)} · ${fmt(c.value)}</span>`).join('')}</div>` : ''}
      </div>
      ${tx.length ? [...groups.entries()].map(([date, items]) => `
        <div class="date-head">${esc(dateLabel(date))}</div>
        ${items.map((t) => `
          <div class="txn">
            <div class="txn-main">
              <div class="txn-cat">${esc(catName(t.category_id))}</div>
              ${t.note ? `<div class="txn-note">${esc(t.note)}</div>` : ''}
            </div>
            <div class="txn-amt">${fmt(t.amount)}</div>
            <div class="txn-actions">
              <button class="icon-btn" data-action="edit-txn" data-id="${t.id}" aria-label="Edit">✎</button>
              <button class="icon-btn" data-action="del-txn" data-id="${t.id}" aria-label="Delete">🗑</button>
            </div>
          </div>`).join('')}`).join('')
        : `<div class="empty">No ${type === 'income' ? 'income' : 'expenses'} recorded for ${esc(monthLabel(state.month))}.<br>Tap + to add one.</div>`}
      <button class="fab ${type}" data-action="add-txn" data-type="${type}" aria-label="Add ${type}">+</button>`;
  }

  function renderLoans() {
    const el = $('#view-loans');
    const active = state.loans.filter((l) => l.emis_paid < l.total_emis);
    const totalEmi = sum(active, (l) => +l.emi_amount);
    const outstanding = sum(active, (l) => (l.total_emis - l.emis_paid) * +l.emi_amount);
    const paidThisMonth = (loan) => monthTxns(state.month).some((t) => t.loan_id === loan.id);

    el.innerHTML = `
      <div class="card">
        <div class="row"><span>Total EMI per month</span><strong>${fmt(totalEmi)}</strong></div>
        <div class="row"><span>Total outstanding</span><strong>${fmt(outstanding)}</strong></div>
        <div class="row sub"><span>Active loans</span><span>${active.length}</span></div>
      </div>
      ${state.loans.length ? state.loans.map((l) => {
        const remainingEmis = Math.max(0, l.total_emis - l.emis_paid);
        const remainingAmt = remainingEmis * +l.emi_amount;
        const pct = l.total_emis ? Math.min(100, (l.emis_paid / l.total_emis) * 100) : 0;
        const closed = remainingEmis === 0;
        const paid = paidThisMonth(l);
        return `
        <div class="card">
          <div class="loan-head">
            <div>
              <div class="loan-name">${esc(l.name)}</div>
              <div class="muted" style="font-size:13px">EMI ${fmt(l.emi_amount)} / month${l.start_date ? ' · since ' + esc(monthLabel(monthOf(l.start_date), true)) : ''}</div>
            </div>
            ${closed ? '<span class="badge good">Closed ✓</span>' : paid ? `<span class="badge good">Paid · ${esc(monthLabel(state.month, true))}</span>` : `<span class="badge">Due · ${esc(monthLabel(state.month, true))}</span>`}
          </div>
          <div class="progress loan"><div style="width:${pct}%"></div></div>
          <div class="loan-grid">
            <div><div class="k">Original amount</div><div class="v">${fmt(l.principal)}</div></div>
            <div><div class="k">Remaining amount</div><div class="v">${fmt(remainingAmt)}</div></div>
            <div><div class="k">EMIs paid</div><div class="v">${l.emis_paid} of ${l.total_emis}</div></div>
            <div><div class="k">EMIs remaining</div><div class="v">${remainingEmis}</div></div>
          </div>
          <div class="loan-actions">
            ${closed ? '' : `<button class="btn small primary" data-action="pay-emi" data-id="${l.id}">Record EMI</button>`}
            <button class="btn small" data-action="edit-loan" data-id="${l.id}">Edit</button>
            <button class="btn small danger" data-action="del-loan" data-id="${l.id}">Delete</button>
          </div>
        </div>`;
      }).join('') : '<div class="empty">No loans yet. Add a loan to track its EMIs automatically.</div>'}
      <button class="fab" data-action="add-loan" aria-label="Add loan">+</button>`;
  }

  function renderReports() {
    const el = $('#view-reports');
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(shiftMonth(state.month, -i));
    const rows = months.map(monthSummary);
    const labels = months.map((m) => monthLabel(m, true));
    const cats = byCategory(monthTxns(state.month).filter((t) => t.type === 'expense'));
    const catTotal = sum(cats, (c) => c.value);
    const legend = (items) => `<div class="legend">${items.map((i) => `<span><i class="dot" style="background:${i.color}"></i>${i.name}</span>`).join('')}</div>`;

    el.innerHTML = `
      <div class="card">
        <h3>Income vs Expenses · last 12 months</h3>
        ${legend([{ name: 'Income', color: 'var(--series-1)' }, { name: 'Expenses', color: 'var(--series-2)' }])}
        <div id="chart-ie"></div>
        <details><summary>Table view</summary>
          <table><thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>EMI</th><th>Savings</th></tr></thead>
          <tbody>${rows.map((r) => `<tr class="${r.month === state.month ? 'current' : ''}"><td>${esc(monthLabel(r.month, true))}</td><td>${fmt(r.income)}</td><td>${fmt(r.expenses)}</td><td>${fmt(r.emi)}</td><td class="${r.savings < 0 ? 'neg' : ''}">${fmt(r.savings)}</td></tr>`).join('')}</tbody></table>
        </details>
      </div>

      <div class="card">
        <h3>Savings trend</h3>
        <div id="chart-sav"></div>
        <details><summary>Table view</summary>
          <table><thead><tr><th>Month</th><th>Savings</th><th>% of income</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(monthLabel(r.month, true))}</td><td class="${r.savings < 0 ? 'neg' : ''}">${fmt(r.savings)}</td><td>${r.pct.toFixed(0)}%</td></tr>`).join('')}</tbody></table>
        </details>
      </div>

      <div class="card">
        <h3>Expenses by category · ${esc(monthLabel(state.month))}</h3>
        <div id="chart-cat"></div>
        ${cats.length ? `<div class="row sub" style="padding-left:0;margin-top:8px"><span>Total</span><strong>${fmt(catTotal)}</strong></div>` : ''}
      </div>`;

    barChart($('#chart-ie'), labels, [
      { name: 'Income', color: 'var(--series-1)', values: rows.map((r) => r.income) },
      { name: 'Expenses', color: 'var(--series-2)', values: rows.map((r) => r.expenses) },
    ]);
    lineChart($('#chart-sav'), labels, rows.map((r) => r.savings), 'var(--series-3)', 'Savings');
    hBars($('#chart-cat'), cats, 'var(--series-2)');
  }

  // ───────────────────────── Charts (inline SVG) ─────────────────────────
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }
  function shortNum(n) {
    const a = Math.abs(n), sign = n < 0 ? '-' : '';
    const trim = (x) => x.toFixed(1).replace(/\.0$/, '');
    if (a >= 1e7) return sign + trim(a / 1e7) + 'Cr';
    if (a >= 1e5) return sign + trim(a / 1e5) + 'L';
    if (a >= 1e3) return sign + trim(a / 1e3) + 'k';
    return sign + Math.round(a);
  }
  function roundTop(x, y, w, h, r) {
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  }
  const tip = $('#tip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (left < 8) left = 8;
    if (top < 8) top = y + 18;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  const hideTip = () => tip.classList.add('hidden');
  function bindHits(el, html) {
    const on = (e) => {
      const t = e.target.closest('.hit');
      if (!t) { hideTip(); return; }
      const p = e.touches ? e.touches[0] : e;
      showTip(html(+t.dataset.i), p.clientX, p.clientY);
    };
    el.addEventListener('mousemove', on);
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('touchstart', on, { passive: true });
    el.addEventListener('touchend', hideTip);
  }

  function barChart(el, labels, series) {
    const W = Math.max(280, el.clientWidth || 340), H = 220, L = 44, R = 8, T = 10, B = 26;
    const maxV = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
    const iw = W - L - R, ih = H - T - B;
    const y = (v) => T + ih - (v / maxV) * ih;
    const n = labels.length, gw = iw / n, gap = 2, inner = Math.min(gw * 0.72, 44);
    const bw = (inner - gap * (series.length - 1)) / series.length;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="chart" role="img" aria-label="Bar chart">`;
    for (let i = 0; i <= 4; i++) {
      const yy = y((maxV * i) / 4);
      s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="${i === 0 ? 'zero' : 'grid'}"/>`;
      s += `<text x="${L - 6}" y="${yy + 4}" text-anchor="end" class="tick">${shortNum((maxV * i) / 4)}</text>`;
    }
    labels.forEach((lab, i) => {
      const gx = L + i * gw + (gw - inner) / 2;
      series.forEach((sr, j) => {
        const v = sr.values[i];
        if (!(v > 0)) return;
        const x = gx + j * (bw + gap), top = y(v), h = T + ih - top, r = Math.min(4, bw / 2, h);
        s += `<path d="${roundTop(x, top, bw, h, r)}" fill="${sr.color}"/>`;
      });
      if (n <= 6 || i % 2 === (n - 1) % 2) s += `<text x="${gx + inner / 2}" y="${H - 8}" text-anchor="middle" class="tick">${esc(lab)}</text>`;
      s += `<rect x="${L + i * gw}" y="${T}" width="${gw}" height="${ih}" class="hit" data-i="${i}"/>`;
    });
    s += '</svg>';
    el.innerHTML = s;
    bindHits(el, (i) => `<strong>${esc(labels[i])}</strong>` + series.map((sr) => `<div class="dot-row"><span class="dot" style="background:${sr.color}"></span> ${sr.name}: ${fmt(sr.values[i])}</div>`).join(''));
  }

  function lineChart(el, labels, values, color, name) {
    const W = Math.max(280, el.clientWidth || 340), H = 200, L = 44, R = 12, T = 12, B = 26;
    const maxV = niceMax(Math.max(0, ...values));
    const minRaw = Math.min(0, ...values);
    const minV = minRaw < 0 ? -niceMax(-minRaw) : 0;
    const iw = W - L - R, ih = H - T - B, n = labels.length;
    const y = (v) => T + ih - ((v - minV) / (maxV - minV)) * ih;
    const x = (i) => L + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="chart" role="img" aria-label="${esc(name)} trend">`;
    for (let i = 0; i <= 4; i++) {
      const v = minV + ((maxV - minV) * i) / 4, yy = y(v);
      s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/>`;
      s += `<text x="${L - 6}" y="${yy + 4}" text-anchor="end" class="tick">${shortNum(v)}</text>`;
    }
    if (minV < 0) s += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
    s += `<path class="line" stroke="${color}" d="${values.map((v, i) => (i ? 'L' : 'M') + x(i) + ',' + y(v)).join(' ')}"/>`;
    values.forEach((v, i) => {
      s += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${color}" class="marker"/>`;
      if (n <= 6 || i % 2 === (n - 1) % 2) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="tick">${esc(labels[i])}</text>`;
    });
    const cw = n > 1 ? iw / (n - 1) : iw;
    values.forEach((_, i) => {
      s += `<rect x="${x(i) - cw / 2}" y="${T}" width="${cw}" height="${ih}" class="hit" data-i="${i}"/>`;
    });
    s += '</svg>';
    el.innerHTML = s;
    bindHits(el, (i) => `<strong>${esc(labels[i])}</strong><div><span class="dot" style="background:${color}"></span> ${name}: ${fmt(values[i])}</div>`);
  }

  function hBars(el, items, color) {
    if (!items.length) { el.innerHTML = '<p class="muted">No expenses recorded this month.</p>'; return; }
    const max = Math.max(1, ...items.map((i) => i.value));
    el.innerHTML = items.map((i) => `
      <div class="hbar">
        <div class="hbar-label" title="${esc(i.label)}">${esc(i.label)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(i.value / max) * 100}%;background:${color}"></div></div>
        <div class="hbar-val">${fmt(i.value)}</div>
      </div>`).join('');
  }

  // ───────────────────────── Modal ─────────────────────────
  let modalSubmit = null;
  function openModal(title, bodyHtml, onSubmit, submitLabel) {
    $('#modal-title').textContent = title;
    $('#modal-form').innerHTML = bodyHtml + (onSubmit ? `
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${submitLabel || 'Save'}</button>
      </div>` : '');
    modalSubmit = onSubmit;
    $('#modal').classList.remove('hidden');
    const first = $('#modal-form input:not([type=hidden]):not([type=radio]), #modal-form select');
    if (first) setTimeout(() => first.focus(), 50);
  }
  function closeModal() {
    $('#modal').classList.add('hidden');
    modalSubmit = null;
  }
  $('#modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!modalSubmit) return;
    const btn = e.target.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      const keepOpen = await modalSubmit(new FormData(e.target));
      if (keepOpen !== false) closeModal();
    } catch (err) {
      toast(friendlyError(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(); });

  function friendlyError(err) {
    const msg = (err && err.message) || String(err);
    if (/foreign key|violates/.test(msg) && /transactions/.test(msg)) return 'This category is used by existing transactions. Move or delete them first.';
    if (/duplicate key/.test(msg)) return 'That name already exists.';
    return msg;
  }

  // ───────────────────────── Forms ─────────────────────────
  function txnForm(type, txn) {
    type = txn ? txn.type : type;
    const cats = state.categories.filter((c) => c.type === type);
    const isIncome = type === 'income';
    const options = cats.map((c) => `<option value="${c.id}" ${txn && txn.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    openModal(`${txn ? 'Edit' : 'Add'} ${isIncome ? 'income' : 'expense'}`, `
      <label>Amount (₹)<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${txn ? +txn.amount : ''}" placeholder="0"></label>
      <label>Category<select name="category_id" required>${options}</select></label>
      <label>Date<input name="txn_date" type="date" required value="${txn ? txn.txn_date : defaultDateForMonth()}"></label>
      <label>Note <span class="muted">(optional)</span><input name="note" maxlength="120" value="${esc(txn ? txn.note || '' : '')}" placeholder="${isIncome ? 'e.g. September salary' : 'e.g. Groceries'}"></label>
      ${txn && txn.loan_id ? '<p class="muted" style="font-size:13px">This is an EMI payment linked to a loan.</p>' : ''}
    `, async (fd) => {
      const row = {
        type,
        amount: +fd.get('amount'),
        category_id: fd.get('category_id'),
        txn_date: fd.get('txn_date'),
        note: (fd.get('note') || '').trim() || null,
      };
      if (!(row.amount > 0)) throw new Error('Enter an amount greater than zero.');
      const q = txn ? sb.from('transactions').update(row).eq('id', txn.id) : sb.from('transactions').insert(row);
      const { error } = await q;
      if (error) throw error;
      await loadTransactions();
      state.month = monthOf(row.txn_date);
      renderAll();
      toast(txn ? 'Updated' : `${isIncome ? 'Income' : 'Expense'} added`);
    });
  }

  async function deleteTxn(id) {
    const t = state.txns.find((x) => x.id === id);
    if (!t) return;
    if (!confirm(`Delete this ${t.type} of ${fmt(t.amount)} (${catName(t.category_id)})?`)) return;
    const { error } = await sb.from('transactions').delete().eq('id', id);
    if (error) throw error;
    if (t.loan_id) {
      const loan = state.loans.find((l) => l.id === t.loan_id);
      if (loan && loan.emis_paid > 0) {
        const r = await sb.from('loans').update({ emis_paid: loan.emis_paid - 1 }).eq('id', loan.id);
        if (r.error) throw r.error;
      }
    }
    await Promise.all([loadTransactions(), loadLoans()]);
    renderAll();
    toast('Deleted');
  }

  function categoriesModal(type) {
    const list = state.categories.filter((c) => c.type === type);
    openModal(`${type === 'income' ? 'Income' : 'Expense'} categories`, `
      <ul class="cat-list">
        ${list.map((c) => `<li><span>${esc(c.name)}</span><button type="button" class="icon-btn" data-action="del-cat" data-id="${c.id}" aria-label="Delete ${esc(c.name)}">🗑</button></li>`).join('')}
      </ul>
      <label>New category<input name="name" required maxlength="40" placeholder="e.g. Insurance"></label>
    `, async (fd) => {
      const name = (fd.get('name') || '').trim();
      if (!name) return false;
      const { error } = await sb.from('categories').insert({ name, type });
      if (error) throw error;
      await loadCategories();
      categoriesModal(type);
      toast('Category added');
      return false;
    }, 'Add');
  }

  async function deleteCategory(id) {
    const c = state.categories.find((x) => x.id === id);
    if (!c) return;
    if (state.txns.some((t) => t.category_id === id)) {
      toast(`"${c.name}" is used by existing transactions and cannot be deleted.`, true);
      return;
    }
    if (!confirm(`Delete category "${c.name}"?`)) return;
    const { error } = await sb.from('categories').delete().eq('id', id);
    if (error) throw error;
    await loadCategories();
    categoriesModal(c.type);
    renderAll();
  }

  function loanForm(loan) {
    openModal(loan ? 'Edit loan' : 'Add loan', `
      <label>Loan name<input name="name" required maxlength="60" value="${esc(loan ? loan.name : '')}" placeholder="e.g. Bike loan"></label>
      <div class="form-grid">
        <label>Original amount (₹)<input name="principal" type="number" min="0" step="0.01" inputmode="decimal" required value="${loan ? +loan.principal : ''}"></label>
        <label>Monthly EMI (₹)<input name="emi_amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${loan ? +loan.emi_amount : ''}"></label>
        <label>Total EMIs<input name="total_emis" type="number" min="1" step="1" inputmode="numeric" required value="${loan ? loan.total_emis : ''}"></label>
        <label>EMIs already paid<input name="emis_paid" type="number" min="0" step="1" inputmode="numeric" required value="${loan ? loan.emis_paid : 0}"></label>
      </div>
      <label>Start date <span class="muted">(optional)</span><input name="start_date" type="date" value="${loan && loan.start_date ? loan.start_date : ''}"></label>
    `, async (fd) => {
      const row = {
        name: (fd.get('name') || '').trim(),
        principal: +fd.get('principal') || 0,
        emi_amount: +fd.get('emi_amount'),
        total_emis: parseInt(fd.get('total_emis'), 10),
        emis_paid: parseInt(fd.get('emis_paid'), 10) || 0,
        start_date: fd.get('start_date') || null,
      };
      if (!row.name) throw new Error('Enter a loan name.');
      if (row.emis_paid > row.total_emis) throw new Error('EMIs paid cannot exceed total EMIs.');
      const q = loan ? sb.from('loans').update(row).eq('id', loan.id) : sb.from('loans').insert(row);
      const { error } = await q;
      if (error) throw error;
      await loadLoans();
      renderAll();
      toast(loan ? 'Loan updated' : 'Loan added');
    });
  }

  async function deleteLoan(id) {
    const l = state.loans.find((x) => x.id === id);
    if (!l) return;
    if (!confirm(`Delete loan "${l.name}"? Recorded EMI expenses will be kept.`)) return;
    const { error } = await sb.from('loans').delete().eq('id', id);
    if (error) throw error;
    await Promise.all([loadLoans(), loadTransactions()]);
    renderAll();
    toast('Loan deleted');
  }

  async function payEmi(loan) {
    if (!loan) return;
    const already = monthTxns(state.month).some((t) => t.loan_id === loan.id);
    if (already && !confirm(`An EMI for "${loan.name}" is already recorded in ${monthLabel(state.month)}. Record another one?`)) return;
    const cat = await ensureEmiCategory();
    const { error } = await sb.from('transactions').insert({
      type: 'expense', category_id: cat.id, loan_id: loan.id,
      amount: +loan.emi_amount, txn_date: defaultDateForMonth(), note: `${loan.name} EMI`,
    });
    if (error) throw error;
    const r = await sb.from('loans').update({ emis_paid: Math.min(loan.total_emis, loan.emis_paid + 1) }).eq('id', loan.id);
    if (r.error) throw r.error;
    await Promise.all([loadTransactions(), loadLoans()]);
    renderAll();
    toast(`EMI of ${fmt(loan.emi_amount)} recorded as an expense`);
  }

  function targetForm() {
    const s = state.settings;
    const useAmount = s.savings_target_amount && +s.savings_target_amount > 0;
    openModal('Savings goal', `
      <div class="radio-row">
        <label><input type="radio" name="mode" value="pct" ${useAmount ? '' : 'checked'}> % of income</label>
        <label><input type="radio" name="mode" value="amount" ${useAmount ? 'checked' : ''}> Fixed amount</label>
      </div>
      <label>Target percentage of income<input name="pct" type="number" min="0" max="100" step="1" inputmode="numeric" value="${+s.savings_target_pct || 20}"></label>
      <label>Target amount per month (₹)<input name="amount" type="number" min="0" step="1" inputmode="decimal" value="${useAmount ? +s.savings_target_amount : ''}" placeholder="e.g. 5000"></label>
    `, async (fd) => {
      const mode = fd.get('mode');
      const row = {
        savings_target_pct: Math.max(0, Math.min(100, +fd.get('pct') || 0)),
        savings_target_amount: mode === 'amount' ? (+fd.get('amount') || null) : null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from('settings').update(row).eq('user_id', state.user.id);
      if (error) throw error;
      await loadSettings();
      renderAll();
      toast('Savings goal saved');
    });
  }

  // ───────────────────────── Events ─────────────────────────
  $('#month-prev').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); renderAll(); });
  $('#month-next').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); renderAll(); });
  $('#month-label').addEventListener('click', () => { state.month = thisMonth(); renderAll(); });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, type, view } = btn.dataset;
    try {
      switch (action) {
        case 'nav': state.view = view; renderAll(); window.scrollTo(0, 0); break;
        case 'add-txn': txnForm(type); break;
        case 'edit-txn': txnForm(null, state.txns.find((t) => t.id === id)); break;
        case 'del-txn': await deleteTxn(id); break;
        case 'categories': categoriesModal(type); break;
        case 'del-cat': await deleteCategory(id); break;
        case 'edit-target': targetForm(); break;
        case 'add-loan': loanForm(); break;
        case 'edit-loan': loanForm(state.loans.find((l) => l.id === id)); break;
        case 'del-loan': await deleteLoan(id); break;
        case 'pay-emi': await payEmi(state.loans.find((l) => l.id === id)); break;
        case 'close-modal': closeModal(); break;
        default: break;
      }
    } catch (err) {
      toast(friendlyError(err), true);
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    if (state.view !== 'reports' || !state.user) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderReports, 150);
  });
})();
