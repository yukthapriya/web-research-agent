/* Lantern — research agent (frontend)
   Talks to the Worker over plain HTTP and polls for progress, so there are
   no build steps or framework dependencies. */

const $ = (id) => document.getElementById(id);

const EXAMPLES = [
  "How do CRISPR base editors differ from prime editors?",
  "What caused the 2023 Silicon Valley Bank collapse, in plain terms?",
  "RAG vs fine-tuning for enterprise LLM apps — when to use which?",
  "What's the current scientific view on microplastics and human health?",
];

const state = { currentId: null, pollTimer: null };

/* ---------- session id (persisted, with a safe fallback) ---------- */
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function loadSession() {
  try {
    let s = localStorage.getItem("lantern_session");
    if (!s) {
      s = uuid();
      localStorage.setItem("lantern_session", s);
    }
    return s;
  } catch {
    window.__lanternSession = window.__lanternSession || uuid();
    return window.__lanternSession;
  }
}
const sessionId = loadSession();

/* ---------- tiny API helper ---------- */
async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const q = (s) => encodeURIComponent(s);

/* ---------- markdown + citations ---------- */
function linkCitations(md) {
  return md.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_m, grp) =>
    grp
      .split(",")
      .map((n) => `[[${n.trim()}]](#src-${n.trim()})`)
      .join(""),
  );
}
function renderMarkdown(md) {
  const linked = linkCitations(md);
  if (window.marked && window.DOMPurify) {
    const html = window.marked.parse(linked);
    return window.DOMPurify.sanitize(html);
  }
  const esc = linked.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:14px">${esc}</pre>`;
}

/* ---------- rendering ---------- */
function showRun() {
  $("run").hidden = false;
}
function phaseText(rec) {
  if (rec.status === "complete") {
    const n = rec.sources ? rec.sources.length : 0;
    return `Done · ${n} source${n === 1 ? "" : "s"}`;
  }
  if (rec.status === "error") return "Stopped before finishing";
  return rec.phase || "Working…";
}
function stepEl(s) {
  const li = document.createElement("li");
  li.className = "trail-step is-" + (s.status || "done");
  const dot = document.createElement("span");
  dot.className = "trail-dot";
  li.appendChild(dot);
  const body = document.createElement("div");
  body.className = "trail-body";
  const label = document.createElement("span");
  label.className = "trail-label";
  label.textContent = s.label;
  body.appendChild(label);
  if (s.detail) {
    const d = document.createElement("span");
    d.className = "trail-detail";
    d.textContent = s.detail;
    body.appendChild(d);
  }
  li.appendChild(body);
  return li;
}
function renderTrail(rec) {
  const trail = $("trail");
  trail.innerHTML = "";
  (rec.steps || []).forEach((s) => trail.appendChild(stepEl(s)));
  if (rec.status === "running" || rec.status === "queued") {
    trail.appendChild(stepEl({ label: rec.phase || "Working…", status: "active" }));
  }
}
function renderReport(rec) {
  const report = $("report");
  if (rec.status === "error" && !rec.report) {
    report.hidden = false;
    report.innerHTML = "";
    const box = document.createElement("div");
    box.style.cssText =
      "font-family:var(--font-ui);font-size:15px;color:var(--danger);" +
      "background:rgba(178,59,46,.08);border:1px solid rgba(178,59,46,.25);" +
      "padding:14px 16px;border-radius:10px";
    box.textContent = rec.error
      ? `This run stopped: ${rec.error}`
      : "This run stopped before finishing. Try again.";
    report.appendChild(box);
    return;
  }
  if (!rec.report) {
    report.hidden = true;
    report.innerHTML = "";
    return;
  }
  report.hidden = false;
  report.innerHTML = renderMarkdown(rec.report);
  report.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
}
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function renderSources(rec) {
  const wrap = $("sources");
  const list = $("sources-list");
  if (!rec.sources || !rec.sources.length) {
    wrap.hidden = true;
    list.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  list.innerHTML = "";
  rec.sources.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "source";
    li.id = "src-" + (i + 1);
    const a = document.createElement("a");
    a.className = "source-link";
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = s.title || s.url;
    li.appendChild(a);
    const host = document.createElement("span");
    host.className = "source-host";
    host.textContent = hostOf(s.url);
    li.appendChild(host);
    list.appendChild(li);
  });
}
function setActiveHistory(id) {
  document
    .querySelectorAll(".history-item")
    .forEach((b) => b.classList.toggle("is-current", b.dataset.id === id));
}
function renderRecord(rec) {
  showRun();
  $("run-q").textContent = rec.query;
  $("run-phase").textContent = phaseText(rec);
  renderTrail(rec);
  renderReport(rec);
  renderSources(rec);
  setActiveHistory(rec.id);
}

/* ---------- polling ---------- */
function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}
async function pollOnce(id) {
  const rec = await api(`/api/research?sessionId=${q(sessionId)}&id=${q(id)}`);
  if (state.currentId === id) renderRecord(rec);
  return rec;
}
function startPolling(id) {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (state.currentId !== id) return stopPolling();
    try {
      const rec = await pollOnce(id);
      if (rec.status === "complete" || rec.status === "error") {
        stopPolling();
        loadHistory();
      }
    } catch {
      stopPolling();
    }
  }, 1200);
}

/* ---------- actions ---------- */
async function startResearch(query) {
  hideError();
  const { id } = await api("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, query }),
  });
  state.currentId = id;
  showRun();
  $("run").scrollIntoView({ behavior: "smooth", block: "start" });
  await pollOnce(id);
  startPolling(id);
  loadHistory();
}
async function loadResearch(id) {
  stopPolling();
  state.currentId = id;
  setActiveHistory(id);
  showRun();
  try {
    const rec = await pollOnce(id);
    $("run").scrollIntoView({ behavior: "smooth", block: "start" });
    if (rec.status === "running" || rec.status === "queued") startPolling(id);
  } catch (e) {
    showError(e.message || "Could not load that research.");
  }
}
async function loadHistory() {
  try {
    const { items } = await api(`/api/history?sessionId=${q(sessionId)}`);
    renderHistory(items || []);
  } catch {
    /* ignore history errors */
  }
}
function renderHistory(items) {
  const h = $("history");
  h.innerHTML = "";
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "history-empty";
    p.textContent = "Your past research shows up here.";
    h.appendChild(p);
    return;
  }
  items.forEach((it) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "history-item" + (it.id === state.currentId ? " is-current" : "");
    b.dataset.id = it.id;
    const dot = document.createElement("span");
    dot.className = "hi-dot s-" + it.status;
    b.appendChild(dot);
    const t = document.createElement("span");
    t.className = "hi-text";
    t.textContent = it.query;
    b.appendChild(t);
    b.addEventListener("click", () => {
      closeSidebar();
      loadResearch(it.id);
    });
    h.appendChild(b);
  });
}

/* ---------- error + busy helpers ---------- */
function showError(msg) {
  const e = $("form-error");
  e.textContent = msg;
  e.hidden = false;
}
function hideError() {
  const e = $("form-error");
  e.hidden = true;
  e.textContent = "";
}
function setBusy(b) {
  const btn = $("ask-btn");
  btn.disabled = b;
  btn.textContent = b ? "Working…" : "Research";
}

/* ---------- sidebar (mobile) ---------- */
const scrim = document.createElement("div");
scrim.className = "scrim";
document.body.appendChild(scrim);
function openSidebar() {
  $("sidebar").classList.add("open");
  scrim.classList.add("show");
}
function closeSidebar() {
  $("sidebar").classList.remove("open");
  scrim.classList.remove("show");
}

/* ---------- examples ---------- */
function renderExamples() {
  const box = $("examples");
  EXAMPLES.forEach((text) => {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "example-chip";
    c.textContent = text;
    c.addEventListener("click", () => {
      $("q").value = text;
      $("ask-form").requestSubmit();
    });
    box.appendChild(c);
  });
}

/* ---------- wiring ---------- */
$("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("q").value.trim();
  if (query.length < 4) {
    showError("Enter a question — a few words at least.");
    return;
  }
  setBusy(true);
  try {
    await startResearch(query);
  } catch (err) {
    showError(err.message || "Something went wrong.");
  } finally {
    setBusy(false);
  }
});
$("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    $("ask-form").requestSubmit();
  }
});
$("new-btn").addEventListener("click", () => {
  stopPolling();
  state.currentId = null;
  $("run").hidden = true;
  $("q").value = "";
  hideError();
  setActiveHistory(null);
  closeSidebar();
  $("q").focus();
});
$("menu-btn").addEventListener("click", () => {
  $("sidebar").classList.contains("open") ? closeSidebar() : openSidebar();
});
scrim.addEventListener("click", closeSidebar);

/* ---------- init ---------- */
$("session-label").textContent = "session " + sessionId.slice(0, 8);
renderExamples();
loadHistory();
$("q").focus();
