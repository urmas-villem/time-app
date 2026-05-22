const SUPABASE_URL = "https://apxplnunivpegqwegtvm.supabase.co";
const SUPABASE_KEY = "sb_publishable_CaLa5ZIsn8L8UUhC4bbVMQ_KnzfaXH1";
const CACHE_KEY = "time-app-cache-v1";
const TALLINN_TIME_ZONE = "Europe/Tallinn";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const authView = document.querySelector("#auth-view");
const authForm = document.querySelector("#auth-form");
const email = document.querySelector("#email");
const password = document.querySelector("#password");
const signUp = document.querySelector("#sign-up");
const authMessage = document.querySelector("#auth-message");
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
const signOutStart = document.querySelector("#sign-out-start");
const signOutDay = document.querySelector("#sign-out-day");
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

function setMessage(message) {
  authMessage.textContent = message;
}

function requireUserId() {
  if (!session?.user?.id) {
    throw new Error("Sign in required.");
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
  setMessage("Loading...");

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    setMessage(sessionError.message);
    return;
  }

  session = sessionData.session;

  if (!session) {
    render();
    setMessage("");
    return;
  }

  await loadData();
  render();
  setMessage("");
}

async function loadData() {
  const userId = requireUserId();
  const today = getTallinnDate();

  const [{ data: activities, error: activitiesError }, { data: day, error: dayError }] = await Promise.all([
    supabase
      .from("activities")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("days")
      .select("*")
      .eq("user_id", userId)
      .eq("day_date", today)
      .maybeSingle()
  ]);

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
    const { data: tasks, error: tasksError } = await supabase
      .from("day_tasks")
      .select("*")
      .eq("day_id", day.id)
      .order("sort_order", { ascending: true });

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
  const nextOrder = state.activities.length;

  const { data: activity, error } = await supabase
    .from("activities")
    .insert({
      active: true,
      sort_order: nextOrder,
      title,
      user_id: userId
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  state.activities.push(activity);

  if (state.dayStarted && state.day) {
    const { data: task, error: taskError } = await supabase
      .from("day_tasks")
      .insert({
        activity_id: activity.id,
        day_id: state.day.id,
        sort_order: state.dayTasks.length,
        title_snapshot: activity.title,
        user_id: userId
      })
      .select()
      .single();

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
  const today = getTallinnDate();
  const now = new Date().toISOString();

  const { data: day, error } = await supabase
    .from("days")
    .upsert({
      day_date: today,
      ended_at: null,
      started_at: now,
      user_id: userId
    }, { onConflict: "user_id,day_date" })
    .select()
    .single();

  if (error) {
    throw error;
  }

  await supabase.from("day_tasks").delete().eq("day_id", day.id).eq("user_id", userId);

  const taskRows = sortByOrder(state.activities).map((activity, index) => ({
    activity_id: activity.id,
    day_id: day.id,
    sort_order: index,
    title_snapshot: activity.title,
    user_id: userId
  }));

  let tasks = [];

  if (taskRows.length > 0) {
    const { data, error: tasksError } = await supabase
      .from("day_tasks")
      .insert(taskRows)
      .select();

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
  const userId = requireUserId();

  if (!state.day) {
    return;
  }

  const endedAt = new Date().toISOString();
  const { data: day, error } = await supabase
    .from("days")
    .update({ ended_at: endedAt })
    .eq("id", state.day.id)
    .eq("user_id", userId)
    .select()
    .single();

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
  const userId = requireUserId();
  const task = getCurrentTask();

  if (!task || task.completed_at) {
    return;
  }

  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("day_tasks")
    .update({ completed_at: completedAt })
    .eq("id", task.id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  state.dayTasks[state.currentIndex] = data;
  const nextIndex = findNextOpenTaskIndex(state.currentIndex);
  state.currentIndex = nextIndex === -1 ? state.dayTasks.length - 1 : nextIndex;
  saveCache();
}

async function moveTask(id, direction) {
  const userId = requireUserId();
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
    supabase.from("day_tasks").update({ sort_order: item.sort_order }).eq("id", item.id)
  ));

  const activityUpdates = state.dayTasks
    .filter((item) => item.activity_id)
    .map((item, index) => (
      supabase
        .from("activities")
        .update({ sort_order: index })
        .eq("id", item.activity_id)
        .eq("user_id", userId)
    ));

  await Promise.all([...taskUpdates, ...activityUpdates]);
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
  const userId = requireUserId();
  const task = state.dayTasks.find((candidate) => candidate.id === id);

  if (!task) {
    return;
  }

  await supabase.from("day_tasks").delete().eq("id", id).eq("user_id", userId);

  if (task.activity_id) {
    await supabase
      .from("activities")
      .update({ active: false })
      .eq("id", task.activity_id)
      .eq("user_id", userId);

    state.activities = state.activities.filter((activity) => activity.id !== task.activity_id);
  }

  state.dayTasks = state.dayTasks.filter((candidate) => candidate.id !== id);
  normalizeCurrentIndex();
  saveCache();
}

function render() {
  const signedIn = Boolean(session);
  const readableDate = getReadableTallinnDate();
  authView.hidden = signedIn;
  startView.hidden = !signedIn || state.dayStarted;
  dayView.hidden = !signedIn || !state.dayStarted;
  todayLabel.textContent = readableDate;

  renderSummary();

  const current = getCurrentTask();
  const completed = state.dayTasks.filter((task) => task.completed_at).length;
  progressLabel.textContent = `Completed tasks today: ${completed} of ${state.dayTasks.length}`;
  currentCard.hidden = !current;
  currentActivity.textContent = current ? (current.completed_at ? "Day complete" : current.title_snapshot) : "";
  done.disabled = !current || Boolean(current.completed_at);

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
    setMessage("");
    await action();
    render();
  } catch (error) {
    setMessage(error.message);
  }
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();

  handleAction(async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value
    });

    if (error) {
      throw error;
    }

    session = data.session;
    await loadData();
  });
});

signUp.addEventListener("click", () => {
  handleAction(async () => {
    const { data, error } = await supabase.auth.signUp({
      email: email.value.trim(),
      password: password.value
    });

    if (error) {
      throw error;
    }

    if (!data.session) {
      setMessage("Check your email to confirm the account, then sign in.");
      return;
    }

    session = data.session;
    await loadData();
  });
});

startDay.addEventListener("click", () => handleAction(startToday));
endDay.addEventListener("click", () => handleAction(endToday));
done.addEventListener("click", () => handleAction(completeCurrentTask));

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

async function signOut() {
  await supabase.auth.signOut();
  session = null;
  state = {
    activities: [],
    currentIndex: 0,
    day: null,
    dayStarted: false,
    dayTasks: [],
    summary: null
  };
  render();
}

signOutStart.addEventListener("click", () => handleAction(signOut));
signOutDay.addEventListener("click", () => handleAction(signOut));

supabase.auth.onAuthStateChange((_event, nextSession) => {
  session = nextSession;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

loadApp().catch((error) => {
  setMessage(error.message);
  render();
});
