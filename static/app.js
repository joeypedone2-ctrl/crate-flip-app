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
const statsEl = document.getElementById("stats");

let currentEnergy = 3;

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
  genreInput.value = track.predicted_genre || "";
  currentEnergy = track.predicted_energy || 3;
  paintStars(currentEnergy);

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

energyStars.forEach((star) => {
  star.addEventListener("click", () => {
    currentEnergy = parseInt(star.dataset.value, 10);
    paintStars(currentEnergy);
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

document.addEventListener("keydown", (event) => {
  const isTypingTarget = event.target === genreInput;
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
