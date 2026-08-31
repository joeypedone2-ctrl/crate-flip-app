// Mobile review page — Phase 2: online-only. Fetches a batch, lets you
// swipe/tap through it, accumulates decisions in memory, and syncs them
// back in one request. No offline storage yet (that's Phase 3) — if the
// page reloads mid-batch, in-progress decisions are lost, same as any
// other in-memory web app state.

const startView = document.getElementById("m-start");
const swipeView = document.getElementById("m-swipe-area");
const doneView = document.getElementById("m-done");

const batchSizeInput = document.getElementById("m-batch-size");
const checkoutBtn = document.getElementById("m-checkout-btn");
const startStatus = document.getElementById("m-start-status");
const batchInfo = document.getElementById("m-batch-info");

const card = document.getElementById("m-card");
const filenameEl = document.getElementById("m-filename");
const genreInput = document.getElementById("m-genre-input");
const energyStars = document.querySelectorAll("#m-energy-stars .m-star");
const swipeHint = document.getElementById("m-swipe-hint");

const player = document.getElementById("m-player");
const playBtn = document.getElementById("m-play-btn");
const playIcon = document.getElementById("m-play-icon");
const pauseIcon = document.getElementById("m-pause-icon");
const playerBar = document.getElementById("m-player-bar");
const playerProgress = document.getElementById("m-player-progress");
const timeCurrent = document.getElementById("m-time-current");
const timeDuration = document.getElementById("m-time-duration");

const deleteBtn = document.getElementById("m-delete-btn");
const skipBtn = document.getElementById("m-skip-btn");
const confirmBtn = document.getElementById("m-confirm-btn");

const pendingCountEl = document.getElementById("m-pending-count");
const syncBtn = document.getElementById("m-sync-btn");
const moreBtn = document.getElementById("m-more-btn");
const syncStatus = document.getElementById("m-sync-status");

let currentBatch = null; // { batch_id, tracks: [...] }
let currentIndex = 0;
let decisions = [];
let currentEnergy = 0;

function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function showView(view) {
  startView.hidden = view !== startView;
  swipeView.hidden = view !== swipeView;
  doneView.hidden = view !== doneView;
}

// --- Batch checkout -----------------------------------------------------

checkoutBtn.addEventListener("click", async () => {
  const size = Math.min(Math.max(parseInt(batchSizeInput.value, 10) || 20, 1), 100);
  checkoutBtn.disabled = true;
  startStatus.textContent = "Checking out a batch…";
  try {
    const res = await fetch(`/mobile/batch/checkout?size=${size}`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      startStatus.textContent = body.detail || "Failed to check out a batch.";
      return;
    }
    currentBatch = await res.json();
    if (currentBatch.tracks.length === 0) {
      startStatus.textContent = "No tracks could be prepared for review right now.";
      return;
    }
    currentIndex = 0;
    decisions = [];
    startStatus.textContent = "";
    showView(swipeView);
    renderCurrentCard();
  } catch (err) {
    startStatus.textContent = `Couldn't reach the server: ${err.message}`;
  } finally {
    checkoutBtn.disabled = false;
  }
});

moreBtn.addEventListener("click", () => {
  showView(startView);
});

// --- Card rendering -------------------------------------------------------

function renderCurrentCard() {
  if (!currentBatch || currentIndex >= currentBatch.tracks.length) {
    return showDoneView();
  }
  const track = currentBatch.tracks[currentIndex];
  batchInfo.textContent = `${currentIndex + 1} / ${currentBatch.tracks.length}`;

  filenameEl.textContent = track.filename;
  genreInput.value = track.confirmed_genre || track.predicted_genre || "";
  currentEnergy = track.confirmed_energy || track.predicted_energy || 3;
  paintStars(currentEnergy);

  card.style.transform = "";
  card.style.opacity = "1";
  card.classList.remove("m-dragging");
  clearSwipeHint();

  player.pause();
  player.src = track.preview_url;
  playerProgress.style.width = "0%";
  timeCurrent.textContent = "0:00";
  timeDuration.textContent = "0:00";
  setPlayingIcon(false);
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
});

// --- Player (same seek-debounce approach as the desktop app: a real seek
// on every drag tick can desync the decoder on a fast scrub, so the bar
// updates instantly but the actual currentTime assignment is debounced) --

let seekTarget = null;
let seekCommitTimer = null;
const SEEK_COMMIT_DELAY_MS = 150;

function displaySeekTime(seconds) {
  timeCurrent.textContent = formatTime(seconds);
  if (player.duration) {
    playerProgress.style.width = `${(seconds / player.duration) * 100}%`;
  }
}

function commitSeek() {
  seekCommitTimer = null;
  if (seekTarget !== null) player.currentTime = seekTarget;
}

function scheduleSeek(target) {
  seekTarget = target;
  displaySeekTime(seekTarget);
  clearTimeout(seekCommitTimer);
  seekCommitTimer = setTimeout(commitSeek, SEEK_COMMIT_DELAY_MS);
}

player.addEventListener("seeked", () => {
  seekTarget = null;
});

player.addEventListener("loadedmetadata", () => {
  timeDuration.textContent = formatTime(player.duration);
});

player.addEventListener("timeupdate", () => {
  if (seekTarget !== null) return;
  timeCurrent.textContent = formatTime(player.currentTime);
  if (player.duration) {
    playerProgress.style.width = `${(player.currentTime / player.duration) * 100}%`;
  }
});

function setPlayingIcon(isPlaying) {
  playIcon.classList.toggle("m-icon-hidden", isPlaying);
  pauseIcon.classList.toggle("m-icon-hidden", !isPlaying);
}

player.addEventListener("play", () => setPlayingIcon(true));
player.addEventListener("pause", () => setPlayingIcon(false));

playBtn.addEventListener("click", () => {
  if (player.paused) player.play();
  else player.pause();
});

function seekToClientX(clientX) {
  if (!player.duration) return;
  const rect = playerBar.getBoundingClientRect();
  const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  scheduleSeek(ratio * player.duration);
}

playerBar.addEventListener("click", (event) => {
  seekToClientX(event.clientX);
});

// --- Decisions --------------------------------------------------------

function recordDecision(action) {
  const track = currentBatch.tracks[currentIndex];
  const decision = { track_id: track.id, action };
  if (action === "confirm") {
    decision.genre = genreInput.value.trim();
    decision.energy = currentEnergy;
    if (!decision.genre) {
      genreInput.focus();
      return false;
    }
  }
  decisions.push(decision);
  currentIndex += 1;
  renderCurrentCard();
  return true;
}

confirmBtn.addEventListener("click", () => recordDecision("confirm"));
deleteBtn.addEventListener("click", () => recordDecision("delete"));
skipBtn.addEventListener("click", () => recordDecision("skip"));

// --- Swipe gestures (buttons above are the reliable primary interaction;
// this is a progressive-enhancement layer on top) ----------------------

const SWIPE_THRESHOLD_X = 110;
const SWIPE_THRESHOLD_Y = -90;
let dragStartX = 0;
let dragStartY = 0;
let dragging = false;

function clearSwipeHint() {
  swipeHint.textContent = "";
  swipeHint.className = "m-swipe-hint";
}

function updateSwipeHint(dx, dy) {
  if (dy < SWIPE_THRESHOLD_Y && dy < -Math.abs(dx)) {
    swipeHint.textContent = "Skip";
    swipeHint.className = "m-swipe-hint m-hint-skip";
  } else if (dx > 40) {
    swipeHint.textContent = "Confirm";
    swipeHint.className = "m-swipe-hint m-hint-confirm";
  } else if (dx < -40) {
    swipeHint.textContent = "Delete";
    swipeHint.className = "m-swipe-hint m-hint-delete";
  } else {
    clearSwipeHint();
  }
}

function onDragStart(x, y) {
  // Ignore drags that start on a control the card already handles itself.
  dragStartX = x;
  dragStartY = y;
  dragging = true;
  card.classList.add("m-dragging");
}

function onDragMove(x, y) {
  if (!dragging) return;
  const dx = x - dragStartX;
  const dy = y - dragStartY;
  card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 20}deg)`;
  updateSwipeHint(dx, dy);
}

function onDragEnd(x, y) {
  if (!dragging) return;
  dragging = false;
  card.classList.remove("m-dragging");
  const dx = x - dragStartX;
  const dy = y - dragStartY;

  if (dy < SWIPE_THRESHOLD_Y && dy < -Math.abs(dx)) {
    flyOut(0, -400, () => recordDecision("skip"));
  } else if (dx > SWIPE_THRESHOLD_X) {
    flyOut(600, dx / 4, () => recordDecision("confirm"));
  } else if (dx < -SWIPE_THRESHOLD_X) {
    flyOut(-600, dx / 4, () => recordDecision("delete"));
  } else {
    card.style.transform = "";
    clearSwipeHint();
  }
}

function flyOut(x, y, onDone) {
  card.style.transform = `translate(${x}px, ${y}px) rotate(${x / 20}deg)`;
  card.style.opacity = "0";
  setTimeout(onDone, 180);
}

let activeTouchId = null;

card.addEventListener("touchstart", (event) => {
  if (event.target.closest(".m-player, .m-field, .m-star-rating")) return;
  const touch = event.changedTouches[0];
  activeTouchId = touch.identifier;
  onDragStart(touch.clientX, touch.clientY);
});

card.addEventListener("touchmove", (event) => {
  const touch = [...event.changedTouches].find((t) => t.identifier === activeTouchId);
  if (!touch) return;
  onDragMove(touch.clientX, touch.clientY);
});

card.addEventListener("touchend", (event) => {
  const touch = [...event.changedTouches].find((t) => t.identifier === activeTouchId);
  if (!touch) return;
  onDragEnd(touch.clientX, touch.clientY);
  activeTouchId = null;
});

// Mouse equivalents so this is testable on a desktop browser too.
let mouseDragging = false;
card.addEventListener("mousedown", (event) => {
  if (event.target.closest(".m-player, .m-field, .m-star-rating")) return;
  mouseDragging = true;
  onDragStart(event.clientX, event.clientY);
});
window.addEventListener("mousemove", (event) => {
  if (mouseDragging) onDragMove(event.clientX, event.clientY);
});
window.addEventListener("mouseup", (event) => {
  if (mouseDragging) {
    mouseDragging = false;
    onDragEnd(event.clientX, event.clientY);
  }
});

// --- Done view / sync ---------------------------------------------------

function showDoneView() {
  player.pause();
  pendingCountEl.textContent = decisions.length;
  syncStatus.textContent = "";
  showView(doneView);
}

syncBtn.addEventListener("click", async () => {
  if (!currentBatch) return;
  syncBtn.disabled = true;
  syncStatus.textContent = "Syncing…";
  try {
    const res = await fetch(`/mobile/batch/${currentBatch.batch_id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      syncStatus.textContent = body.detail || "Sync failed — your decisions are still queued, try again.";
      return;
    }
    const summary = await res.json();
    syncStatus.textContent =
      `Synced: ${summary.confirmed} confirmed, ${summary.deleted} deleted, ${summary.skipped} skipped` +
      (summary.errors.length ? ` (${summary.errors.length} error(s))` : "");
    currentBatch = null;
    decisions = [];
  } catch (err) {
    syncStatus.textContent = `Couldn't reach the server: ${err.message}`;
  } finally {
    syncBtn.disabled = false;
  }
});
