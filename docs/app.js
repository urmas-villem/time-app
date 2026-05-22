const SUPABASE_URL = "https://apxplnunivpegqwegtvm.supabase.co";
const SUPABASE_KEY = "sb_publishable_CaLa5ZIsn8L8UUhC4bbVMQ_KnzfaXH1";
const CACHE_KEY = "time-app-cache-v1";
const OWNER_KEY = "time-app-owner-v1";
const TALLINN_TIME_ZONE = "Europe/Tallinn";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const dbWarningStart = document.querySelector("#db-warning-start");
const dbWarningDay = document.querySelector("#db-warning-day");
const statusMessageStart = document.querySelector("#status-message-start");
const statusMessageDay = document.querySelector("#status-message-day");
const retrySyncStart = document.querySelector("#retry-sync-start");
const retrySyncDay = document.querySelector("#retry-sync-day");
const syncForm = document.querySelector("#sync-form");
const syncName = document.querySelector("#sync-name");
const syncLabel = document.querySelector("#sync-label");
const startView = document.querySelector("#start-view");
const dayView = document.querySelector("#day-view");
const todayLabel = document.querySelector("#today-label");
const currentCard = document.querySelector("#current-card");
const summary = document.querySelector("#summary");
const summaryStats = document.querySelector("#summary-stats");
const summaryDone = document.querySelector("#summary-done");
const summaryIncomplete = document.querySelector("#summary-incomplete");
const startDay = document.querySelector("#start-day");
const endDay = document.querySelector("#end-day");
const progressLabel = document.querySelector("#progress-label");
const currentActivity = document.querySelector("#current-activity");
const done = document.querySelector("#done");
const activityForm = document.querySelector("#activity-form");
const activityInput = document.querySelector("#activity-input");
const activityWheel = document.querySelector("#activity-wheel");

let session = null;
let state = {
  activities: [],
  currentIndex: 0,
  day: null,
  dayStarted: false,
  dayTasks: [],
  summary: null
};
let dbReady = false;
let dbError = "";
let dbBusy = false;
let owner = loadOwner();

function getTallinnDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TALLINN_TIME_ZONE,
    year: "numeric"
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getReadableTallinnDate() {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: TALLINN_TIME_ZONE,
    weekday: "short"
  }).format(new Date());
}

function getTallinnTime(isoTime) {
  if (!isoTime) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TALLINN_TIME_ZONE
  }).format(new Date(isoTime));
}

function saveCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    date: getTallinnDate(),
    state
  }));
}

function loadOwner() {
  const saved = localStorage.getItem(OWNER_KEY);

  if (!saved) {
    return { hash: "", name: "" };
  }

  try {
    return JSON.parse(saved);
  } catch {
    return { hash: "", name: "" };
  }
}

function saveOwner(nextOwner) {
  owner = nextOwner;
  localStorage.setItem(OWNER_KEY, JSON.stringify(nextOwner));
}

async function hashOwnerName(name) {
  const normalized = name.trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function requireOwnerHash() {
  if (!owner.hash) {
    throw new Error("Set a sync name before using the database.");
  }

  return owner.hash;
}

async function ensureOwnerLink() {
  const userId = requireUserId();
  const ownerHash = requireOwnerHash();

  const { error } = await withTimeout(supabaseClient.from("device_owners")
    .upsert({
      owner_key_hash: ownerHash,
      user_id: userId
    }, { onConflict: "user_id,owner_key_hash" }), "Linking sync name");

  if (error) {
    throw error;
  }

  const ownerUpdates = await withTimeout(Promise.all([
    supabaseClient.from("activities")
      .update({ owner_key_hash: ownerHash })
      .eq("user_id", userId)
      .is("owner_key_hash", null),
    supabaseClient.from("days")
      .update({ owner_key_hash: ownerHash })
      .eq("user_id", userId)
      .is("owner_key_hash", null),
    supabaseClient.from("day_tasks")
      .update({ owner_key_hash: ownerHash })
      .eq("user_id", userId)
      .is("owner_key_hash", null)
  ]), "Claiming existing device data");

  const ownerError = ownerUpdates.find((result) => result.error)?.error;

  if (ownerError) {
    throw ownerError;
  }
}

function setMessage(message) {
  dbError = message;
  statusMessageStart.textContent = message;
  statusMessageDay.textContent = message;
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), 10000);
    })
  ]);
}

function requireUserId() {
  if (!session?.user?.id) {
    throw new Error("Supabase session is still loading.");
  }

  return session.user.id;
}

function sortByOrder(items) {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}

function getCurrentTask() {
  return state.dayTasks[state.currentIndex] || null;
}

function findNextOpenTaskIndex(fromIndex) {
  return state.dayTasks.findIndex((task, index) => index > fromIndex && !task.completed_at);
}

function normalizeCurrentIndex() {
  if (state.dayTasks.length === 0) {
    state.currentIndex = 0;
    return;
  }

  const firstOpen = state.dayTasks.findIndex((task) => !task.completed_at);
  state.currentIndex = firstOpen === -1 ? state.dayTasks.length - 1 : firstOpen;
}

async function loadApp() {
  setMessage("");

  const { data: sessionData, error: sessionError } = await withTimeout(
    supabaseClient.auth.getSession(),
    "Database session"
  );

  if (sessionError) {
    dbReady = false;
    setMessage(`Database sync problem: ${sessionError.message}`);
    render();
    return;
  }

  session = sessionData.session;

  if (!session) {
    const { data, error } = await withTimeout(
      supabaseClient.auth.signInAnonymously(),
      "Anonymous database session"
    );

    if (error) {
      dbReady = false;
      setMessage(`Database sync problem: ${error.message}`);
      render();
      return;
    }

    session = data.session;
  }

  if (!owner.hash) {
    dbReady = true;
    render();
    setMessage("");
    return;
  }

  await ensureOwnerLink();
  await loadData();
  dbReady = true;
  render();
  setMessage("");
}

async function loadData() {
  const ownerHash = requireOwnerHash();
  const today = getTallinnDate();

  const [{ data: activities, error: activitiesError }, { data: day, error: dayError }] = await withTimeout(Promise.all([
    supabaseClient.from("activities")
      .select("*")
      .eq("owner_key_hash", ownerHash)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabaseClient.from("days")
      .select("*")
      .eq("owner_key_hash", ownerHash)
      .eq("day_date", today)
      .maybeSingle()
  ]), "Loading database data");

  if (activitiesError) {
    throw activitiesError;
  }

  if (dayError) {
    throw dayError;
  }

  state.activities = activities || [];
  state.day = day || null;
  state.dayStarted = Boolean(day && !day.ended_at);
  state.summary = day && day.ended_at ? { day, tasks: [] } : null;
  state.dayTasks = [];

  if (day) {
    const { data: tasks, error: tasksError } = await withTimeout(supabaseClient.from("day_tasks")
      .select("*")
      .eq("day_id", day.id)
      .eq("owner_key_hash", ownerHash)
      .order("sort_order", { ascending: true }), "Loading today's tasks");

    if (tasksError) {
      throw tasksError;
    }

    state.dayTasks = tasks || [];

    if (day.ended_at) {
      state.summary = { day, tasks: state.dayTasks };
    }
  }

  normalizeCurrentIndex();
  saveCache();
}

async function createActivity(title) {
  const userId = requireUserId();
  const ownerHash = requireOwnerHash();
  const nextOrder = state.activities.length;

  const { data: activity, error } = await withTimeout(supabaseClient.from("activities")
    .insert({
      active: true,
      owner_key_hash: ownerHash,
      sort_order: nextOrder,
      title,
      user_id: userId
    })
    .select()
    .single(), "Saving activity");

  if (error) {
    throw error;
  }

  state.activities.push(activity);

  if (state.dayStarted && state.day) {
    const { data: task, error: taskError } = await withTimeout(supabaseClient.from("day_tasks")
      .insert({
        activity_id: activity.id,
        day_id: state.day.id,
        owner_key_hash: ownerHash,
        sort_order: state.dayTasks.length,
        title_snapshot: activity.title,
        user_id: userId
      })
      .select()
      .single(), "Adding activity to today");

    if (taskError) {
      throw taskError;
    }

    state.dayTasks.push(task);
  }

  normalizeCurrentIndex();
  saveCache();
}

async function startToday() {
  const userId = requireUserId();
  const ownerHash = requireOwnerHash();
  const today = getTallinnDate();
  const now = new Date().toISOString();

  const { data: existingDay, error: existingError } = await withTimeout(supabaseClient.from("days")
    .select("*")
    .eq("owner_key_hash", ownerHash)
    .eq("day_date", today)
    .maybeSingle(), "Checking today's day");

  if (existingError) {
    throw existingError;
  }

  const dayRequest = existingDay
    ? supabaseClient.from("days")
      .update({
        ended_at: null,
        started_at: now,
        user_id: userId
      })
      .eq("id", existingDay.id)
      .eq("owner_key_hash", ownerHash)
    : supabaseClient.from("days")
      .insert({
        day_date: today,
        ended_at: null,
        owner_key_hash: ownerHash,
        started_at: now,
        user_id: userId
      });

  const { data: day, error } = await withTimeout(dayRequest
    .select()
    .single(), "Starting day");

  if (error) {
    throw error;
  }

  const { error: deleteError } = await withTimeout(
    supabaseClient.from("day_tasks").delete().eq("day_id", day.id).eq("owner_key_hash", ownerHash),
    "Resetting today's tasks"
  );

  if (deleteError) {
    throw deleteError;
  }

  const taskRows = sortByOrder(state.activities).map((activity, index) => ({
    activity_id: activity.id,
    day_id: day.id,
    owner_key_hash: ownerHash,
    sort_order: index,
    title_snapshot: activity.title,
    user_id: userId
  }));

  let tasks = [];

  if (taskRows.length > 0) {
    const { data, error: tasksError } = await withTimeout(supabaseClient.from("day_tasks")
      .insert(taskRows)
      .select(), "Creating today's tasks");

    if (tasksError) {
      throw tasksError;
    }

    tasks = data || [];
  }

  state.day = day;
  state.dayStarted = true;
  state.summary = null;
  state.dayTasks = sortByOrder(tasks);
  normalizeCurrentIndex();
  saveCache();
}

async function endToday() {
  const ownerHash = requireOwnerHash();

  if (!state.day) {
    return;
  }

  const endedAt = new Date().toISOString();
  const { data: day, error } = await withTimeout(supabaseClient.from("days")
    .update({ ended_at: endedAt })
    .eq("id", state.day.id)
    .eq("owner_key_hash", ownerHash)
    .select()
    .single(), "Ending day");

  if (error) {
    throw error;
  }

  state.day = day;
  state.dayStarted = false;
  state.summary = { day, tasks: state.dayTasks };
  normalizeCurrentIndex();
  saveCache();
}

async function completeCurrentTask() {
  const ownerHash = requireOwnerHash();
  const task = getCurrentTask();

  if (!task || task.completed_at) {
    return;
  }

  const completedAt = new Date().toISOString();
  const { data, error } = await withTimeout(supabaseClient.from("day_tasks")
    .update({ completed_at: completedAt })
    .eq("id", task.id)
    .eq("owner_key_hash", ownerHash)
    .select()
    .single(), "Completing task");

  if (error) {
    throw error;
  }

  state.dayTasks[state.currentIndex] = data;
  const nextIndex = findNextOpenTaskIndex(state.currentIndex);
  state.currentIndex = nextIndex === -1 ? state.dayTasks.length - 1 : nextIndex;
  saveCache();
}

async function moveTask(id, direction) {
  const ownerHash = requireOwnerHash();
  const taskIndex = state.dayTasks.findIndex((task) => task.id === id);
  const targetIndex = taskIndex + direction;

  if (taskIndex < 0 || targetIndex < 0 || targetIndex >= state.dayTasks.length) {
    return;
  }

  const nextTasks = [...state.dayTasks];
  const [task] = nextTasks.splice(taskIndex, 1);
  nextTasks.splice(targetIndex, 0, task);
  state.dayTasks = nextTasks.map((item, index) => ({ ...item, sort_order: index }));
  state.currentIndex = targetIndex;

  const taskUpdates = state.dayTasks.map((item) => (
    supabaseClient.from("day_tasks").update({ sort_order: item.sort_order })
      .eq("id", item.id)
      .eq("owner_key_hash", ownerHash)
  ));

  const activityUpdates = state.dayTasks
    .filter((item) => item.activity_id)
    .map((item, index) => (
      supabaseClient.from("activities")
        .update({ sort_order: index })
        .eq("id", item.activity_id)
        .eq("owner_key_hash", ownerHash)
    ));

  await withTimeout(Promise.all([...taskUpdates, ...activityUpdates]), "Reordering tasks");
  state.activities = sortByOrder(state.dayTasks)
    .filter((item) => item.activity_id)
    .map((item) => ({
      id: item.activity_id,
      sort_order: item.sort_order,
      title: item.title_snapshot
    }));
  saveCache();
}

async function removeTask(id) {
  const ownerHash = requireOwnerHash();
  const task = state.dayTasks.find((candidate) => candidate.id === id);

  if (!task) {
    return;
  }

  const { error: deleteTaskError } = await withTimeout(
    supabaseClient.from("day_tasks").delete().eq("id", id).eq("owner_key_hash", ownerHash),
    "Deleting task"
  );

  if (deleteTaskError) {
    throw deleteTaskError;
  }

  if (task.activity_id) {
    const { error: activityError } = await withTimeout(supabaseClient.from("activities")
      .update({ active: false })
      .eq("id", task.activity_id)
      .eq("owner_key_hash", ownerHash), "Deleting activity");

    if (activityError) {
      throw activityError;
    }

    state.activities = state.activities.filter((activity) => activity.id !== task.activity_id);
  }

  state.dayTasks = state.dayTasks.filter((candidate) => candidate.id !== id);
  normalizeCurrentIndex();
  saveCache();
}

function render() {
  const hasOwner = Boolean(owner.hash);
  const hasDatabase = Boolean(session) && dbReady && hasOwner && !dbBusy;
  const readableDate = getReadableTallinnDate();
  startView.hidden = state.dayStarted;
  dayView.hidden = !state.dayStarted;
  syncForm.hidden = !session || hasOwner || state.dayStarted;
  syncLabel.hidden = !hasOwner || state.dayStarted;
  syncLabel.textContent = hasOwner ? `Sync name: ${owner.name}` : "";
  startDay.disabled = !hasDatabase;
  activityForm.querySelector("button").disabled = !hasDatabase;
  done.disabled = !hasDatabase;
  endDay.disabled = !hasDatabase;
  dbWarningStart.hidden = !dbError;
  dbWarningDay.hidden = !dbError;
  todayLabel.textContent = readableDate;

  renderSummary();

  const current = getCurrentTask();
  const completed = state.dayTasks.filter((task) => task.completed_at).length;
  progressLabel.textContent = `Completed tasks today: ${completed} of ${state.dayTasks.length}`;
  currentCard.hidden = !current;
  currentActivity.textContent = current ? (current.completed_at ? "Day complete" : current.title_snapshot) : "";
  done.disabled = !hasDatabase || !current || Boolean(current.completed_at);

  activityWheel.innerHTML = "";

  state.dayTasks.forEach((task, index) => {
    const item = document.createElement("li");
    item.className = [
      index === state.currentIndex ? "active" : "",
      task.completed_at ? "done" : ""
    ].filter(Boolean).join(" ");

    const number = document.createElement("span");
    number.className = "activity-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("button");
    title.type = "button";
    title.className = "activity-title";
    title.textContent = task.title_snapshot;
    title.addEventListener("click", () => {
      state.currentIndex = index;
      render();
    });

    const actions = document.createElement("div");
    actions.className = "activity-actions";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "mini";
    up.textContent = "Up";
    up.disabled = index === 0;
    up.addEventListener("click", () => handleAction(() => moveTask(task.id, -1)));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "mini";
    down.textContent = "Down";
    down.disabled = index === state.dayTasks.length - 1;
    down.addEventListener("click", () => handleAction(() => moveTask(task.id, 1)));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => handleAction(() => removeTask(task.id)));

    actions.append(up, down, remove);
    item.append(number, title, actions);
    activityWheel.append(item);
  });
}

function renderSummary() {
  const daySummary = state.summary;
  summary.hidden = state.dayStarted || !daySummary;
  summaryDone.innerHTML = "";
  summaryIncomplete.innerHTML = "";

  if (!daySummary) {
    summaryStats.textContent = "";
    return;
  }

  const completed = daySummary.tasks.filter((task) => task.completed_at);
  const incomplete = daySummary.tasks.filter((task) => !task.completed_at);
  summaryStats.textContent = `${completed.length} completed, ${incomplete.length} incomplete. Ended at ${getTallinnTime(daySummary.day.ended_at)}.`;

  for (const task of completed) {
    const item = document.createElement("li");
    item.textContent = `${task.title_snapshot} - ${getTallinnTime(task.completed_at)}`;
    summaryDone.append(item);
  }

  for (const task of incomplete) {
    const item = document.createElement("li");
    item.textContent = task.title_snapshot;
    summaryIncomplete.append(item);
  }
}

async function handleAction(action) {
  try {
    dbBusy = true;
    setMessage("Database sync in progress...");
    render();
    await action();
    dbReady = true;
    dbBusy = false;
    setMessage("");
    render();
  } catch (error) {
    dbReady = false;
    dbBusy = false;
    setMessage(`Database sync problem: ${error.message}`);
    render();
  }
}

startDay.addEventListener("click", () => handleAction(startToday));
endDay.addEventListener("click", () => handleAction(endToday));
done.addEventListener("click", () => handleAction(completeCurrentTask));
retrySyncStart.addEventListener("click", () => loadApp());
retrySyncDay.addEventListener("click", () => loadApp());

syncForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = syncName.value.trim();

  if (!name) {
    return;
  }

  handleAction(async () => {
    const hash = await hashOwnerName(name);
    const nextOwner = { hash, name };
    const previousOwner = owner;

    owner = nextOwner;

    try {
      await ensureOwnerLink();
      await loadData();
      saveOwner(nextOwner);
      syncName.value = "";
    } catch (error) {
      owner = previousOwner;
      throw error;
    }
  });
});

activityForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const title = activityInput.value.trim();

  if (!title) {
    return;
  }

  handleAction(async () => {
    await createActivity(title);
    activityInput.value = "";
  });
});

supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
  session = nextSession;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
}

if ("caches" in window) {
  caches.keys()
    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
}

loadApp().catch((error) => {
  dbReady = false;
  setMessage(`Database sync problem: ${error.message}`);
  render();
});

