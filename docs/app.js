const STORAGE_KEY = "time-app-v2";
const TALLINN_TIME_ZONE = "Europe/Tallinn";

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

let state = normalizeState(loadState());

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

function createEmptyState() {
  return {
    date: getTallinnDate(),
    dayStarted: false,
    currentIndex: 0,
    activities: [],
    history: []
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return createEmptyState();
  }

  try {
    return JSON.parse(saved);
  } catch {
    return createEmptyState();
  }
}

function normalizeState(candidate) {
  const today = getTallinnDate();
  const activities = Array.isArray(candidate.activities)
    ? candidate.activities.map((activity) => ({
        id: activity.id || crypto.randomUUID(),
        title: String(activity.title || "").trim(),
        done: Boolean(activity.done),
        completedAt: activity.completedAt || null
      })).filter((activity) => activity.title)
    : [];

  const history = Array.isArray(candidate.history) ? candidate.history : [];
  const normalized = {
    date: candidate.date || today,
    dayStarted: Boolean(candidate.dayStarted),
    currentIndex: Number.isInteger(candidate.currentIndex) ? candidate.currentIndex : 0,
    activities,
    history
  };

  if (normalized.date !== today) {
    normalized.date = today;
    normalized.dayStarted = false;
    normalized.currentIndex = 0;
    normalized.activities = normalized.activities.map((activity) => ({
      ...activity,
      completedAt: null,
      done: false
    }));
  }

  normalized.currentIndex = clampIndex(normalized.currentIndex, normalized.activities);
  return normalized;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clampIndex(index, activities) {
  if (activities.length === 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, activities.length - 1));
}

function getCurrentActivity() {
  return state.activities[state.currentIndex];
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

function createDaySummary() {
  const summaryTasks = state.activities.map((activity, index) => ({
    index: index + 1,
    title: activity.title,
    done: Boolean(activity.done),
    completedAt: activity.completedAt || null
  }));

  return {
    date: state.date,
    endedAt: new Date().toISOString(),
    tasks: summaryTasks
  };
}

function saveDaySummary() {
  const daySummary = createDaySummary();
  state.history = [
    ...state.history.filter((entry) => entry.date !== daySummary.date),
    daySummary
  ];
}

function getTodaySummary() {
  return state.history.find((entry) => entry.date === getTallinnDate()) || null;
}

function moveActivity(id, direction) {
  const from = state.activities.findIndex((activity) => activity.id === id);
  const to = from + direction;

  if (from < 0 || to < 0 || to >= state.activities.length) {
    return;
  }

  const [activity] = state.activities.splice(from, 1);
  state.activities.splice(to, 0, activity);

  if (state.currentIndex === from) {
    state.currentIndex = to;
  } else if (direction < 0 && state.currentIndex === to) {
    state.currentIndex += 1;
  } else if (direction > 0 && state.currentIndex === to) {
    state.currentIndex -= 1;
  }

  saveState();
  render();
}

function removeActivity(id) {
  const removedIndex = state.activities.findIndex((activity) => activity.id === id);
  state.activities = state.activities.filter((activity) => activity.id !== id);

  if (removedIndex <= state.currentIndex) {
    state.currentIndex -= 1;
  }

  state.currentIndex = clampIndex(state.currentIndex, state.activities);
  saveState();
  render();
}

function render() {
  const readableDate = getReadableTallinnDate();
  const todaySummary = getTodaySummary();
  todayLabel.textContent = readableDate;
  startView.hidden = state.dayStarted;
  dayView.hidden = !state.dayStarted;
  renderSummary(todaySummary);

  const current = getCurrentActivity();
  const completed = state.activities.filter((activity) => activity.done).length;
  progressLabel.textContent = `Completed tasks today: ${completed} of ${state.activities.length}`;

  currentCard.hidden = !current;
  currentActivity.textContent = current ? (current.done ? "Day complete" : current.title) : "";
  done.disabled = !current || current.done;

  activityWheel.innerHTML = "";

  state.activities.forEach((activity, index) => {
    const item = document.createElement("li");
    item.className = [
      index === state.currentIndex ? "active" : "",
      activity.done ? "done" : ""
    ].filter(Boolean).join(" ");

    const number = document.createElement("span");
    number.className = "activity-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("button");
    title.type = "button";
    title.className = "activity-title";
    title.textContent = activity.title;
    title.addEventListener("click", () => {
      state.currentIndex = index;
      saveState();
      render();
    });

    const actions = document.createElement("div");
    actions.className = "activity-actions";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "mini";
    up.textContent = "Up";
    up.disabled = index === 0;
    up.addEventListener("click", () => moveActivity(activity.id, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "mini";
    down.textContent = "Down";
    down.disabled = index === state.activities.length - 1;
    down.addEventListener("click", () => moveActivity(activity.id, 1));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => removeActivity(activity.id));

    actions.append(up, down, remove);
    item.append(number, title, actions);
    activityWheel.append(item);
  });
}

function renderSummary(daySummary) {
  summary.hidden = state.dayStarted || !daySummary;
  summaryDone.innerHTML = "";
  summaryIncomplete.innerHTML = "";

  if (!daySummary) {
    summaryStats.textContent = "";
    return;
  }

  const completed = daySummary.tasks.filter((task) => task.done);
  const incomplete = daySummary.tasks.filter((task) => !task.done);
  summaryStats.textContent = `${completed.length} completed, ${incomplete.length} incomplete. Ended at ${getTallinnTime(daySummary.endedAt)}.`;

  for (const task of completed) {
    const item = document.createElement("li");
    item.textContent = `${task.title} - ${getTallinnTime(task.completedAt)}`;
    summaryDone.append(item);
  }

  for (const task of incomplete) {
    const item = document.createElement("li");
    item.textContent = task.title;
    summaryIncomplete.append(item);
  }
}

startDay.addEventListener("click", () => {
  state.date = getTallinnDate();
  state.dayStarted = true;
  state.currentIndex = 0;
  state.activities = state.activities.map((activity) => ({
    ...activity,
    completedAt: null,
    done: false
  }));
  saveState();
  render();
});

endDay.addEventListener("click", () => {
  saveDaySummary();
  state.dayStarted = false;
  state.currentIndex = 0;
  state.activities = state.activities.map((activity) => ({
    ...activity,
    completedAt: null,
    done: false
  }));
  saveState();
  render();
});

done.addEventListener("click", () => {
  const current = getCurrentActivity();

  if (!current) {
    return;
  }

  current.done = true;
  current.completedAt = new Date().toISOString();
  const nextIndex = state.activities.findIndex((activity, index) => index > state.currentIndex && !activity.done);
  state.currentIndex = nextIndex === -1 ? state.activities.length - 1 : nextIndex;
  saveState();
  render();
});

activityForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const title = activityInput.value.trim();

  if (!title) {
    return;
  }

  state.activities.push({
    id: crypto.randomUUID(),
    title,
    completedAt: null,
    done: false
  });

  state.currentIndex = clampIndex(state.currentIndex, state.activities);
  activityInput.value = "";
  saveState();
  render();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

saveState();
render();
