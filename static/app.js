let current = null;
const history = [];

const card = document.getElementById("card");
const emptyState = document.getElementById("empty-state");
const filenameEl = document.getElementById("filename");
const player = document.getElementById("player");
const playBtn = document.getElementById("play-btn");
const playIcon = document.getElementById("play-icon");
const pauseIcon = document.getElementById("pause-icon");
const playerBar = document.getElementById("player-bar");
const playerProgress = document.getElementById("player-progress");
const timeCurrent = document.getElementById("time-current");
const timeDuration = document.getElementById("time-duration");
const genreInput = document.getElementById("genre-input");
const energyStars = document.querySelectorAll("#energy-stars .star");
const revertBtn = document.getElementById("revert-btn");
const statsEl = document.getElementById("stats");

let currentEnergy = 3;
let predictedGenre = "";
let predictedEnergy = 3;

function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

async function loadNext(afterId) {
  if (current) history.push(current.id);

  const url = afterId ? `/tracks/next?after_id=${afterId}` : "/tracks/next";
  const res = await fetch(url);

  if (res.status === 404) {
    current = null;
    card.hidden = true;
    document.getElementById("actions").hidden = true;
    emptyState.hidden = false;
    return;
  }

  current = await res.json();
  render(current);
  refreshStats();
}

async function backTrack() {
  if (history.length === 0) return;
  const prevId = history.pop();
  const res = await fetch(`/tracks/${prevId}`);
  if (!res.ok) return;
  current = await res.json();
  render(current);
  refreshStats();
}

function render(track) {
  card.hidden = false;
  document.getElementById("actions").hidden = false;
  emptyState.hidden = true;

  filenameEl.textContent = track.filename;
  predictedGenre = track.predicted_genre || "";
  predictedEnergy = track.predicted_energy || 3;
  genreInput.value = predictedGenre;
  currentEnergy = predictedEnergy;
  paintStars(currentEnergy);
  revertBtn.hidden = true;

  player.pause();
  player.src = `/tracks/${track.id}/audio`;
  playerProgress.style.width = "0%";
  timeCurrent.textContent = "0:00";
  timeDuration.textContent = "0:00";
  setPlayingIcon(false);
}

function setPlayingIcon(isPlaying) {
  playIcon.classList.toggle("icon-hidden", isPlaying);
  pauseIcon.classList.toggle("icon-hidden", !isPlaying);
}

function paintStars(value) {
  energyStars.forEach((star) => {
    star.classList.toggle("active", parseInt(star.dataset.value, 10) <= value);
  });
}

function checkDirty() {
  const isDirty = genreInput.value.trim() !== predictedGenre || currentEnergy !== predictedEnergy;
  revertBtn.hidden = !isDirty;
}

function revertToPrediction() {
  genreInput.value = predictedGenre;
  currentEnergy = predictedEnergy;
  paintStars(currentEnergy);
  revertBtn.hidden = true;
}

revertBtn.addEventListener("click", revertToPrediction);
genreInput.addEventListener("input", checkDirty);

energyStars.forEach((star) => {
  star.addEventListener("click", () => {
    currentEnergy = parseInt(star.dataset.value, 10);
    paintStars(currentEnergy);
    checkDirty();
  });
  star.addEventListener("mouseenter", () => {
    paintStars(parseInt(star.dataset.value, 10));
  });
});

document.getElementById("energy-stars").addEventListener("mouseleave", () => {
  paintStars(currentEnergy);
});

playBtn.addEventListener("click", () => {
  if (player.paused) player.play();
  else player.pause();
});

player.addEventListener("play", () => setPlayingIcon(true));
player.addEventListener("pause", () => setPlayingIcon(false));

player.addEventListener("loadedmetadata", () => {
  timeDuration.textContent = formatTime(player.duration);
});

player.addEventListener("timeupdate", () => {
  timeCurrent.textContent = formatTime(player.currentTime);
  if (player.duration) {
    playerProgress.style.width = `${(player.currentTime / player.duration) * 100}%`;
  }
});

function seekToClientX(clientX) {
  if (!player.duration) return;
  const rect = playerBar.getBoundingClientRect();
  const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  player.currentTime = ratio * player.duration;
}

let isDraggingBar = false;

playerBar.addEventListener("mousedown", (event) => {
  isDraggingBar = true;
  seekToClientX(event.clientX);
});

window.addEventListener("mousemove", (event) => {
  if (isDraggingBar) seekToClientX(event.clientX);
});

window.addEventListener("mouseup", () => {
  isDraggingBar = false;
});

const SEEK_STEP_SEC = 10;

function seekBy(deltaSeconds) {
  if (!player.duration) return;
  player.currentTime = Math.min(Math.max(player.currentTime + deltaSeconds, 0), player.duration);
}

async function refreshStats() {
  const res = await fetch("/tracks/stats");
  const stats = await res.json();
  statsEl.textContent = `${stats.pending} remaining · ${stats.confirmed} confirmed · ${stats.deleted} deleted`;
}

async function confirmTrack() {
  if (!current) return;
  const genre = genreInput.value.trim();
  const energy = currentEnergy;
  if (!genre) {
    genreInput.focus();
    return;
  }
  await fetch(`/tracks/${current.id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ genre, energy }),
  });
  loadNext();
}

async function deleteTrack() {
  if (!current) return;
  await fetch(`/tracks/${current.id}/delete`, { method: "POST" });
  loadNext();
}

function skipTrack() {
  if (!current) return;
  loadNext(current.id);
}

document.getElementById("confirm-btn").addEventListener("click", confirmTrack);
document.getElementById("delete-btn").addEventListener("click", deleteTrack);
document.getElementById("skip-btn").addEventListener("click", skipTrack);
document.getElementById("back-btn").addEventListener("click", backTrack);

const folderToggleBtn = document.getElementById("folder-toggle-btn");
const folderPanel = document.getElementById("folder-panel");
const folderInput = document.getElementById("folder-input");
const browseBtn = document.getElementById("browse-btn");
const scanBtn = document.getElementById("scan-btn");
const folderStatus = document.getElementById("folder-status");

folderToggleBtn.addEventListener("click", () => {
  folderPanel.hidden = !folderPanel.hidden;
});

// pywebview injects window.pywebview once its JS bridge is ready — only
// then can we call the native folder-picker exposed from desktop.py. In a
// plain browser tab this event never fires, so Browse stays hidden and
// the text field is the only way in (browsers never expose real paths).
window.addEventListener("pywebviewready", () => {
  browseBtn.hidden = false;
});

browseBtn.addEventListener("click", async () => {
  const folder = await window.pywebview.api.choose_folder();
  if (folder) folderInput.value = folder;
});

function renderScanStatus(status) {
  if (status.error_message) {
    folderStatus.textContent = `Error: ${status.error_message}`;
  } else if (status.phase === "discovering") {
    folderStatus.textContent = "Scanning folder for audio files…";
  } else if (status.phase === "processing") {
    folderStatus.textContent = `Analyzing ${status.processed}/${status.to_process} new files (${status.errors} errors)…`;
  } else if (status.phase === "done") {
    folderStatus.textContent =
      status.to_process === 0
        ? "Up to date — no new files found."
        : `Done: ${status.processed} files added (${status.errors} errors).`;
  }
}

let scanPollTimer = null;

function pollScanStatus() {
  if (scanPollTimer) return;
  scanPollTimer = setInterval(async () => {
    const res = await fetch("/library/scan/status");
    const status = await res.json();
    renderScanStatus(status);
    if (!status.running) {
      clearInterval(scanPollTimer);
      scanPollTimer = null;
      refreshStats();
      if (!current) loadNext();
    }
  }, 1000);
}

async function startScan() {
  const folder = folderInput.value.trim();
  if (!folder) return;
  folderStatus.textContent = "Starting…";
  const res = await fetch("/library/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    folderStatus.textContent = body.detail || "Failed to start scan.";
    return;
  }
  pollScanStatus();
}

scanBtn.addEventListener("click", startScan);

(async function resumeScanIfRunning() {
  const res = await fetch("/library/scan/status");
  const status = await res.json();
  if (status.running) {
    folderPanel.hidden = false;
    if (status.folder) folderInput.value = status.folder;
    renderScanStatus(status);
    pollScanStatus();
  }
})();

document.addEventListener("keydown", (event) => {
  const isTypingTarget = event.target === genreInput || event.target === folderInput;
  if (isTypingTarget) return;

  const key = event.key.toLowerCase();

  if (key === " ") {
    event.preventDefault();
    player.paused ? player.play() : player.pause();
  } else if (key === "arrowup") {
    event.preventDefault();
    backTrack();
  } else if (key === "arrowdown") {
    event.preventDefault();
    skipTrack();
  } else if (key === "arrowleft") {
    event.preventDefault();
    seekBy(-SEEK_STEP_SEC);
  } else if (key === "arrowright") {
    event.preventDefault();
    seekBy(SEEK_STEP_SEC);
  } else if (key === "x") {
    event.preventDefault();
    deleteTrack();
  } else if (key === "c") {
    event.preventDefault();
    confirmTrack();
  }
});

loadNext();
