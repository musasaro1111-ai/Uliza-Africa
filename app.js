/* Uliza Africa frontend. Configure Supabase in the dashboard before deploying. */
(() => {
  const CONFIG = window.ULIZA_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const hasConfig = Boolean(CONFIG.url && CONFIG.anonKey && window.supabase);
  const db = hasConfig ? window.supabase.createClient(CONFIG.url, CONFIG.anonKey) : null;
  let currentUser = null;
  let authMode = "login";
  let searchTerm = "";
  let page = 0;
  const PAGE_SIZE = 10;
  const openAnswers = new Set();
  const answerCache = new Map();

  $("year").textContent = new Date().getFullYear();

  function setMessage(id, text, kind = "") {
    const el = $(id); el.textContent = text; el.className = "message" + (kind ? " " + kind : "");
  }
  function toast(text) {
    const el = $("toast"); el.textContent = text; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2800);
  }
  function safeDate(value) {
    try { return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch (_) { return ""; }
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  }
  function renderSetupMessage() {
    setMessage("feed-message", "The website files are ready. Connect your Supabase project to load community questions.", "error");
    $("question-count").textContent = "Setup needed";
    $("question-list").innerHTML = '<div class="empty-state"><strong>Welcome to Uliza Africa</strong>Finish the setup steps in README.md to connect accounts and community questions.</div>';
  }
  function showAuth() { $("auth-modal").hidden = false; $("auth-email").focus(); }
  function hideAuth() { $("auth-modal").hidden = true; }
  function setAuthMode(mode) {
    authMode = mode;
    $("tab-login").classList.toggle("active", mode === "login");
    $("tab-signup").classList.toggle("active", mode === "signup");
    $("auth-title").textContent = mode === "login" ? "Welcome back" : "Create your account";
    $("auth-submit").textContent = mode === "login" ? "Log in" : "Create account";
    $("auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
    setMessage("auth-message", "");
  }
  function updateAuthUi() {
    const button = $("auth-open");
    button.textContent = currentUser ? "Log out" : "Log in / Sign up";
    $("ask-panel").classList.toggle("signed-in", Boolean(currentUser));
    if (currentUser && currentUser.app_metadata && currentUser.app_metadata.role === "admin") {
      $("admin-panel").hidden = false;
      loadAdminQueue();
    } else {
      $("admin-panel").hidden = true;
    }
  }
  async function refreshUser() {
    if (!db) return;
    const { data } = await db.auth.getUser();
    currentUser = data?.user || null;
    updateAuthUi();
  }
  async function loadQuestions(reset = true) {
    if (!db) return renderSetupMessage();
    if (reset) { page = 0; $("question-list").innerHTML = ""; }
    setMessage("feed-message", "");
    const start = page * PAGE_SIZE;
    let query = db.from("questions")
      .select("id,title,body,created_at,answer_count")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);
    if (searchTerm.trim()) {
      const term = searchTerm.trim().replace(/[,%()]/g, " ");
      query = query.or(`title.ilike.%${term}%,body.ilike.%${term}%`);
    }
    const { data, error } = await query;
    if (error) {
      setMessage("feed-message", "Could not load questions. Check your database setup and internet connection.", "error");
      $("question-count").textContent = "Unavailable";
      return;
    }
    if (reset && (!data || data.length === 0)) {
      $("question-list").innerHTML = `<div class="empty-state"><strong>${searchTerm ? "No matching questions yet" : "Be the first to ask"}</strong>${searchTerm ? "Try another search term." : "Your question could start a useful conversation."}</div>`;
    } else if (data?.length) {
      $("question-list").insertAdjacentHTML("beforeend", data.map(questionCard).join(""));
    }
    $("question-count").textContent = searchTerm ? `${data?.length || 0} results` : "Community Q&A";
    $("load-more").hidden = !data || data.length < PAGE_SIZE;
    if (!reset && data?.length) $("load-more").hidden = data.length < PAGE_SIZE;
  }
  function questionCard(q) {
    const expanded = openAnswers.has(q.id);
    return `<article class="question-card" data-question="${escapeHtml(q.id)}">
      <div class="question-meta"><span class="anonymous-badge">◉ Anonymous</span><span>${safeDate(q.created_at)}</span></div>
      <h3>${escapeHtml(q.title)}</h3>
      ${q.body ? `<p>${escapeHtml(q.body)}</p>` : ""}
      <div class="card-actions">
        <button class="text-button" data-action="answers" data-id="${escapeHtml(q.id)}">↳ ${Number(q.answer_count || 0)} answers</button>
        <button class="text-button" data-action="share" data-id="${escapeHtml(q.id)}" data-title="${escapeHtml(q.title)}">↗ Share</button>
        <button class="text-button" data-action="report" data-id="${escapeHtml(q.id)}">⚑ Report</button>
      </div>
      <div class="answers" id="answers-${escapeHtml(q.id)}" ${expanded ? "" : "hidden"}>${expanded ? '<div class="muted">Loading answers…</div>' : ""}</div>
    </article>`;
  }
  async function loadAnswers(questionId) {
    const box = $("answers-" + questionId);
    if (!box) return;
    box.hidden = false;
    openAnswers.add(questionId);
    if (answerCache.has(questionId)) {
      renderAnswers(questionId, answerCache.get(questionId)); return;
    }
    box.innerHTML = '<div class="muted">Loading answers…</div>';
    const { data, error } = await db.from("answers")
      .select("id,body,created_at")
      .eq("question_id", questionId).eq("status", "approved")
      .order("created_at", { ascending: true });
    if (error) { box.innerHTML = '<div class="muted">Could not load answers.</div>'; return; }
    answerCache.set(questionId, data || []);
    renderAnswers(questionId, data || []);
  }
  function renderAnswers(questionId, answers) {
    const box = $("answers-" + questionId);
    if (!box) return;
    const answerMarkup = answers.length ? answers.map(a => `<div class="answer"><div class="answer-meta">Anonymous answer · ${safeDate(a.created_at)}</div><p>${escapeHtml(a.body)}</p></div>`).join("") : '<div class="muted">No answers yet. You can start the conversation.</div>';
    const formMarkup = currentUser ? `<form class="answer-form" data-answer-form="${escapeHtml(questionId)}"><label for="answer-${escapeHtml(questionId)}">Your answer</label><textarea id="answer-${escapeHtml(questionId)}" name="body" maxlength="2000" required placeholder="Share a helpful, respectful answer…"></textarea><button class="button button-primary button-small" type="submit">Submit answer</button></form>` : '<p class="muted">Log in to submit an answer. Your answer will be posted anonymously.</p>';
    box.innerHTML = answerMarkup + formMarkup;
  }
  async function submitQuestion(event) {
    event.preventDefault();
    if (!db) return toast("Please finish the website setup first.");
    if (!currentUser) { showAuth(); setMessage("auth-message", "Log in or create an account to ask a question."); return; }
    const title = $("question-title").value.trim();
    const body = $("question-body").value.trim();
    if (!title) return;
    const submit = event.submitter;
    if (submit) { submit.disabled = true; submit.textContent = "Submitting…"; }
    const { error } = await db.from("questions").insert({ title, body: body || null, user_id: currentUser.id, status: "pending" });
    if (submit) { submit.disabled = false; submit.textContent = "Submit question"; }
    if (error) { setMessage("question-message", "Could not submit. Please try again after signing in.", "error"); return; }
    $("question-form").reset();
    setMessage("question-message", "Submitted for moderator review. It will appear publicly after approval.", "success");
    toast("Question sent for review.");
  }
  async function submitAnswer(event) {
    event.preventDefault();
    if (!db || !currentUser) { showAuth(); return; }
    const form = event.target;
    const questionId = form.dataset.answerForm;
    const body = new FormData(form).get("body")?.toString().trim();
    if (!body) return;
    const button = form.querySelector("button");
    button.disabled = true; button.textContent = "Submitting…";
    const { error } = await db.from("answers").insert({ question_id: questionId, body, user_id: currentUser.id, status: "pending" });
    button.disabled = false; button.textContent = "Submit answer";
    if (error) { toast("Could not submit answer. Please try again."); return; }
    answerCache.delete(questionId);
    toast("Answer sent for moderator review.");
    await loadAnswers(questionId);
    const box = $("answers-" + questionId);
    if (box) box.insertAdjacentHTML("afterbegin", '<p class="muted">Your answer is awaiting moderator approval.</p>');
  }
  async function reportQuestion(questionId) {
    if (!db) return;
    if (!currentUser) { showAuth(); toast("Log in to report content."); return; }
    const reason = window.prompt("Why are you reporting this question? (e.g. harassment, spam, private information)");
    if (!reason || !reason.trim()) return;
    const { error } = await db.from("reports").insert({ question_id: questionId, reporter_id: currentUser.id, reason: reason.trim().slice(0, 500) });
    if (error) toast("Report could not be sent. You may have already reported this item.");
    else toast("Report sent to moderators. Thank you.");
  }
  async function shareQuestion(questionId, title) {
    const url = new URL(location.href); url.hash = "questions";
    const shareData = { title: "Uliza Africa", text: title, url: url.toString() };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard) { await navigator.clipboard.writeText(`${title}\n${url}`); toast("Share link copied."); }
      else window.prompt("Copy this link", url.toString());
    } catch (e) { if (e?.name !== "AbortError") toast("Unable to share on this device."); }
  }
  async function loadAdminQueue() {
    if (!db || !currentUser) return;
    const box = $("admin-queue");
    box.innerHTML = '<p class="muted">Loading moderation queue…</p>';
    const [questions, answers, reports] = await Promise.all([
      db.from("questions").select("id,title,body,created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(30),
      db.from("answers").select("id,body,question_id,created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(30),
      db.from("reports").select("id,question_id,reason,created_at").eq("status", "open").order("created_at", { ascending: true }).limit(30)
    ]);
    if (questions.error || answers.error || reports.error) { box.innerHTML = '<p class="message error">Could not load queue. Check admin permissions in the setup guide.</p>'; return; }
    const qMarkup = (questions.data || []).map(q => `<div class="admin-item"><div class="question-meta">PENDING QUESTION · ${safeDate(q.created_at)}</div><h3>${escapeHtml(q.title)}</h3><p class="muted">${escapeHtml(q.body || "")}</p><div class="admin-actions"><button class="button button-primary button-small" data-admin="approve-question" data-id="${q.id}">Approve</button><button class="button button-danger button-small" data-admin="reject-question" data-id="${q.id}">Reject</button></div></div>`).join("");
    const aMarkup = (answers.data || []).map(a => `<div class="admin-item"><div class="question-meta">PENDING ANSWER · ${safeDate(a.created_at)}</div><p>${escapeHtml(a.body)}</p><div class="admin-actions"><button class="button button-primary button-small" data-admin="approve-answer" data-id="${a.id}">Approve</button><button class="button button-danger button-small" data-admin="reject-answer" data-id="${a.id}">Reject</button></div></div>`).join("");
    const rMarkup = (reports.data || []).map(r => `<div class="admin-item"><div class="question-meta">OPEN REPORT · ${safeDate(r.created_at)}</div><p>${escapeHtml(r.reason)}</p><div class="admin-actions"><button class="button button-outline button-small" data-admin="resolve-report" data-id="${r.id}">Resolve report</button><button class="button button-danger button-small" data-admin="remove-question" data-id="${r.question_id}">Remove question</button></div></div>`).join("");
    box.innerHTML = `<h3>Questions awaiting review</h3>${qMarkup || '<p class="muted">No pending questions.</p>'}<h3>Answers awaiting review</h3>${aMarkup || '<p class="muted">No pending answers.</p>'}<h3>Reports</h3>${rMarkup || '<p class="muted">No open reports.</p>'}`;
  }
  async function adminAction(action, id) {
    const map = {
      "approve-question": ["questions", "approved"],
      "reject-question": ["questions", "rejected"],
      "approve-answer": ["answers", "approved"],
      "reject-answer": ["answers", "rejected"],
      "remove-question": ["questions", "rejected"],
      "resolve-report": ["reports", "resolved"]
    };
    const item = map[action]; if (!item) return;
    const { error } = await db.from(item[0]).update({ status: item[1] }).eq("id", id);
    if (error) { toast("Action failed. Check admin permissions."); return; }
    if (action.includes("answer")) answerCache.clear();
    toast("Moderation action saved.");
    await loadAdminQueue(); await loadQuestions(true);
  }

  $("auth-open").addEventListener("click", async () => {
    if (!db) { toast("Connect Supabase first using README.md."); return; }
    if (currentUser) {
      const { error } = await db.auth.signOut();
      if (error) toast("Could not log out.");
      currentUser = null; updateAuthUi(); toast("You are logged out.");
    } else showAuth();
  });
  $("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!db) return;
    const email = $("auth-email").value.trim(), password = $("auth-password").value;
    $("auth-submit").disabled = true;
    const result = authMode === "login"
      ? await db.auth.signInWithPassword({ email, password })
      : await db.auth.signUp({ email, password });
    $("auth-submit").disabled = false;
    if (result.error) { setMessage("auth-message", result.error.message, "error"); return; }
    if (authMode === "signup" && !result.data.session) {
      setMessage("auth-message", "Account created. Check your email for a verification link, then log in.", "success"); return;
    }
    currentUser = result.data.user || null;
    hideAuth(); updateAuthUi(); toast(authMode === "login" ? "Logged in." : "Account created.");
    setMessage("question-message", "You are signed in. Questions and answers are still posted anonymously.", "success");
  });
  document.querySelectorAll("[data-close-auth]").forEach(el => el.addEventListener("click", hideAuth));
  $("tab-login").addEventListener("click", () => setAuthMode("login"));
  $("tab-signup").addEventListener("click", () => setAuthMode("signup"));
  $("ask-hero").addEventListener("click", () => {
    $("ask-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    if (!currentUser) setTimeout(showAuth, 350);
    else $("question-title").focus({ preventScroll: true });
  });
  $("question-form").addEventListener("submit", submitQuestion);
  $("question-list").addEventListener("submit", (e) => {
    const form = e.target.closest("[data-answer-form]"); if (form) submitAnswer(e);
  });
  $("question-list").addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-action]"); if (!button) return;
    const { action, id, title } = button.dataset;
    if (action === "answers") {
      if (openAnswers.has(id)) { openAnswers.delete(id); $("answers-" + id).hidden = true; }
      else await loadAnswers(id);
    }
    if (action === "share") await shareQuestion(id, title);
    if (action === "report") await reportQuestion(id);
  });
  $("admin-queue").addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-admin]"); if (button) await adminAction(button.dataset.admin, button.dataset.id);
  });
  let searchTimer;
  $("search-input").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchTerm = $("search-input").value; loadQuestions(true); }, 300);
  });
  $("search-clear").addEventListener("click", () => { $("search-input").value = ""; searchTerm = ""; loadQuestions(true); });
  $("load-more").addEventListener("click", () => { page += 1; loadQuestions(false); });

  if (db) {
    db.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      updateAuthUi();
    });
    refreshUser().then(() => loadQuestions(true));
  } else renderSetupMessage();
})();
