const SESSION_SECONDS = 25 * 60;
const stateKey = "time-app-state";

const clock = document.querySelector("#clock");
const startPause = document.querySelector("#start-pause");
const reset = document.querySelector("#reset");
const taskForm = document.querySelector("#task-form");
const taskInput = document.querySelector("#task-input");
const taskList = document.querySelector("#task-list");
const taskCount = document.querySelector("#task-count");

let state = loadState();
let ticker = null;

function loadState() {
  const saved = localStorage.getItem(stateKey);

  if (!saved) {
    return { remaining: SESSION_SECONDS, running: false, tasks: [] };
  }

  try {
    return JSON.parse(saved);
  } catch {
    return { remaining: SESSION_SECONDS, running: false, tasks: [] };
  }
}

function saveState() {
  localStorage.setItem(stateKey, JSON.stringify(state));
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const leftover = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(leftover).padStart(2, "0")}`;
}

function render() {
  clock.textContent = formatTime(state.remaining);
  startPause.textContent = state.running ? "Pause" : "Start";

  taskList.innerHTML = "";

  for (const task of state.tasks) {
    const item = document.createElement("li");
    item.className = task.done ? "done" : "";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Mark ${task.title} done`);
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      saveState();
      render();
    });

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      state.tasks = state.tasks.filter((candidate) => candidate.id !== task.id);
      saveState();
      render();
    });

    item.append(checkbox, title, remove);
    taskList.append(item);
  }

  const openTasks = state.tasks.filter((task) => !task.done).length;
  taskCount.textContent = `${openTasks} open`;
}

function startTimer() {
  if (ticker) {
    return;
  }

  ticker = setInterval(() => {
    if (state.remaining <= 1) {
      state.remaining = 0;
      state.running = false;
      stopTimer();
    } else {
      state.remaining -= 1;
    }

    saveState();
    render();
  }, 1000);
}

function stopTimer() {
  clearInterval(ticker);
  ticker = null;
}

startPause.addEventListener("click", () => {
  state.running = !state.running;

  if (state.running) {
    startTimer();
  } else {
    stopTimer();
  }

  saveState();
  render();
});

reset.addEventListener("click", () => {
  state.remaining = SESSION_SECONDS;
  state.running = false;
  stopTimer();
  saveState();
  render();
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const title = taskInput.value.trim();

  if (!title) {
    return;
  }

  state.tasks.push({
    id: crypto.randomUUID(),
    title,
    done: false
  });

  taskInput.value = "";
  saveState();
  render();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

if (state.running) {
  startTimer();
}

render();
