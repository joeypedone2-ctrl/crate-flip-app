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
  // "Revert" always means "back to what the model predicted" — but the
  // displayed starting point favors an existing confirmed edit, since
  // re-opening an already-decided track (e.g. from the browse table)
  // should show what you actually chose, not the original guess.
  predictedGenre = track.predicted_genre || "";
  predictedEnergy = track.predicted_energy || 3;
  genreInput.value = track.confirmed_genre || predictedGenre;
  currentEnergy = track.confirmed_energy || predictedEnergy;
  paintStars(currentEnergy);
  checkDirty();

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

async function reviewTrack(trackId) {
  const res = await fetch(`/tracks/${trackId}`);
  if (!res.ok) return;
  if (current) history.push(current.id);
  current = await res.json();
  render(current);
  refreshStats();
  showReviewMode();
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
const cancelScanBtn = document.getElementById("cancel-scan-btn");
const removeFolderBtn = document.getElementById("remove-folder-btn");
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
  scanBtn.hidden = status.running;
  cancelScanBtn.hidden = !status.running;
  removeFolderBtn.disabled = status.running;

  if (status.error_message) {
    folderStatus.textContent = `Error: ${status.error_message}`;
  } else if (status.phase === "discovering") {
    folderStatus.textContent = "Scanning folder for audio files…";
  } else if (status.phase === "processing") {
    folderStatus.textContent = `Analyzing ${status.processed}/${status.to_process} new files (${status.errors} errors)…`;
  } else if (status.phase === "cancelled") {
    folderStatus.textContent = `Cancelled after ${status.processed}/${status.to_process} files (kept what finished).`;
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

cancelScanBtn.addEventListener("click", async () => {
  cancelScanBtn.disabled = true;
  await fetch("/library/scan/cancel", { method: "POST" });
  cancelScanBtn.disabled = false;
});

removeFolderBtn.addEventListener("click", async () => {
  const folder = folderInput.value.trim();
  if (!folder) return;
  const ok = window.confirm(
    `Remove every track under "${folder}" from the library?\n\nThis only removes them from Crate Flip's index — it does not delete or move the actual files.`
  );
  if (!ok) return;

  const res = await fetch("/library/remove-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  });
  const body = await res.json();
  folderStatus.textContent = `Removed ${body.removed} track(s) from the library.`;
  refreshStats();
  if (current && current.path && (current.path + "/").startsWith(folder.replace(/\/?$/, "/"))) {
    loadNext();
  }
});

const reviewArea = document.getElementById("review-area");
const browseArea = document.getElementById("browse-area");
const browseToggleBtn = document.getElementById("browse-toggle-btn");
const browseSearch = document.getElementById("browse-search");
const browseStatusFilter = document.getElementById("browse-status-filter");
const browseTbody = document.getElementById("browse-tbody");
const browseEmpty = document.getElementById("browse-empty");

let libraryTracks = [];
let librarySortKey = "id";
let librarySortDir = "asc";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function compareTracksBy(a, b, key, dir) {
  let av;
  let bv;
  if (key === "filename") {
    av = a.filename.toLowerCase();
    bv = b.filename.toLowerCase();
  } else if (key === "genre") {
    av = (a.confirmed_genre || a.predicted_genre || "").toLowerCase();
    bv = (b.confirmed_genre || b.predicted_genre || "").toLowerCase();
  } else if (key === "energy") {
    av = a.confirmed_energy || a.predicted_energy || 0;
    bv = b.confirmed_energy || b.predicted_energy || 0;
  } else if (key === "status") {
    av = a.status;
    bv = b.status;
  } else if (key === "modified") {
    av = a.file_mtime || 0;
    bv = b.file_mtime || 0;
  } else if (key === "duration") {
    av = a.file_duration_sec || 0;
    bv = b.file_duration_sec || 0;
  } else {
    av = a.id;
    bv = b.id;
  }
  if (av < bv) return dir === "asc" ? -1 : 1;
  if (av > bv) return dir === "asc" ? 1 : -1;
  return 0;
}

function trackRowHtml(t) {
  const genre = escapeHtml(t.confirmed_genre || t.predicted_genre || "–");
  const energy = t.confirmed_energy || t.predicted_energy;
  const energyLabel = energy ? `★ ${energy}` : "–";
  const modified = t.file_mtime ? new Date(t.file_mtime * 1000).toLocaleDateString() : "–";
  const duration = t.file_duration_sec ? formatTime(t.file_duration_sec) : "–";
  const filename = escapeHtml(t.filename);
  const actions =
    t.status === "deleted"
      ? ""
      : `<button class="browse-action-btn" data-action="review" data-id="${t.id}">Review</button>
         <button class="browse-action-btn danger" data-action="delete" data-id="${t.id}">Delete</button>`;

  return `
    <tr>
      <td class="browse-filename" title="${filename}">${filename}</td>
      <td>${genre}</td>
      <td>${energyLabel}</td>
      <td><span class="browse-badge browse-badge-${t.status}">${t.status}</span></td>
      <td>${modified}</td>
      <td>${duration}</td>
      <td><div class="browse-row-actions">${actions}</div></td>
    </tr>
  `;
}

function renderBrowseTable() {
  const query = browseSearch.value.trim().toLowerCase();
  const statusValue = browseStatusFilter.value;

  let rows = libraryTracks;
  if (statusValue !== "all") rows = rows.filter((t) => t.status === statusValue);
  if (query) {
    rows = rows.filter((t) => {
      const genre = (t.confirmed_genre || t.predicted_genre || "").toLowerCase();
      return t.filename.toLowerCase().includes(query) || genre.includes(query);
    });
  }
  rows = [...rows].sort((a, b) => compareTracksBy(a, b, librarySortKey, librarySortDir));

  browseTbody.innerHTML = rows.map(trackRowHtml).join("");
  browseEmpty.hidden = rows.length > 0;

  document.querySelectorAll(".browse-table th[data-sort]").forEach((th) => {
    const isSorted = th.dataset.sort === librarySortKey;
    th.classList.toggle("sorted", isSorted);
    th.dataset.dir = isSorted ? (librarySortDir === "asc" ? "↑" : "↓") : "";
  });
}

function showReviewMode() {
  browseArea.hidden = true;
  reviewArea.hidden = false;
}

function showBrowseMode() {
  reviewArea.hidden = true;
  browseArea.hidden = false;
}

async function openBrowse() {
  showBrowseMode();
  const res = await fetch("/tracks/all");
  libraryTracks = await res.json();
  renderBrowseTable();
}

browseToggleBtn.addEventListener("click", () => {
  if (browseArea.hidden) {
    openBrowse();
  } else {
    showReviewMode();
  }
});

browseSearch.addEventListener("input", renderBrowseTable);
browseStatusFilter.addEventListener("change", renderBrowseTable);

document.querySelectorAll(".browse-table th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (librarySortKey === key) {
      librarySortDir = librarySortDir === "asc" ? "desc" : "asc";
    } else {
      librarySortKey = key;
      librarySortDir = "asc";
    }
    renderBrowseTable();
  });
});

browseTbody.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  const id = parseInt(btn.dataset.id, 10);

  if (btn.dataset.action === "review") {
    reviewTrack(id);
  } else if (btn.dataset.action === "delete") {
    await fetch(`/tracks/${id}/delete`, { method: "POST" });
    const track = libraryTracks.find((t) => t.id === id);
    if (track) track.status = "deleted";
    renderBrowseTable();
    refreshStats();
  }
});

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
  const isTypingTarget =
    event.target === genreInput || event.target === folderInput || event.target === browseSearch;
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
