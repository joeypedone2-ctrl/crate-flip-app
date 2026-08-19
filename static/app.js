let current = null;

const card = document.getElementById("card");
const emptyState = document.getElementById("empty-state");
const filenameEl = document.getElementById("filename");
const player = document.getElementById("player");
const genreInput = document.getElementById("genre-input");
const energyInput = document.getElementById("energy-input");
const energyValue = document.getElementById("energy-value");
const statsEl = document.getElementById("stats");

async function loadNext(afterId) {
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

function render(track) {
  card.hidden = false;
  document.getElementById("actions").hidden = false;
  emptyState.hidden = true;

  filenameEl.textContent = track.filename;
  genreInput.value = track.predicted_genre || "";
  const energy = track.predicted_energy || 5;
  energyInput.value = energy;
  energyValue.textContent = energy;

  player.src = `/tracks/${track.id}/audio`;
}

energyInput.addEventListener("input", () => {
  energyValue.textContent = energyInput.value;
});

async function refreshStats() {
  const res = await fetch("/tracks/stats");
  const stats = await res.json();
  statsEl.textContent = `${stats.pending} remaining · ${stats.confirmed} confirmed · ${stats.deleted} deleted`;
}

async function confirmTrack() {
  if (!current) return;
  const genre = genreInput.value.trim();
  const energy = parseInt(energyInput.value, 10);
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

document.addEventListener("keydown", (event) => {
  const isTypingTarget = event.target === genreInput || event.target === energyInput;

  if (event.key === " " && !isTypingTarget) {
    event.preventDefault();
    player.paused ? player.play() : player.pause();
    return;
  }

  if (isTypingTarget) return;

  if (event.key === "ArrowRight") {
    event.preventDefault();
    confirmTrack();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    deleteTrack();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    skipTrack();
  }
});

loadNext();
