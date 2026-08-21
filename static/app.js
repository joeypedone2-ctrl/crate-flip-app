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
const browseTbody = document.getElementById("browse-tbody");
const colFilterPopover = document.getElementById("col-filter-popover");
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

// --- Per-column Excel-style filtering ---------------------------------
//
// Each column has a filter "type" that determines both the popover UI and
// the match logic: "text" (freeform, contains/starts with/etc — filename,
// where a checklist of distinct values would be unwieldy), "values" (a
// checklist of distinct values — genre/status, where the set is small and
// finite), "number" (operator + value(s) — energy/duration), or "date"
// (operator + date(s) — modified). columnFilters holds at most one active
// filter object per column key; an absent/undefined entry means "no filter".
const COLUMN_CONFIG = {
  filename: { type: "text", get: (t) => t.filename },
  genre: { type: "values", get: (t) => t.confirmed_genre || t.predicted_genre || "–" },
  energy: { type: "number", get: (t) => t.confirmed_energy || t.predicted_energy || null, options: [1, 2, 3, 4, 5] },
  status: { type: "values", get: (t) => t.status },
  modified: { type: "date", get: (t) => t.file_mtime || null },
  duration: { type: "number", get: (t) => t.file_duration_sec || null, isDuration: true },
};

const TEXT_OPS = [
  ["contains", "Contains"],
  ["not_contains", "Does not contain"],
  ["equals", "Equals"],
  ["starts_with", "Starts with"],
  ["ends_with", "Ends with"],
  ["is_blank", "Is blank"],
  ["is_not_blank", "Is not blank"],
];

const NUMBER_OPS = [
  ["eq", "Equals"],
  ["neq", "Does not equal"],
  ["gt", "Greater than"],
  ["gte", "Greater than or equal to"],
  ["lt", "Less than"],
  ["lte", "Less than or equal to"],
  ["between", "Between"],
];

const DATE_OPS = [
  ["on", "On"],
  ["before", "Before"],
  ["after", "After"],
  ["between", "Between"],
];

let columnFilters = {};
let activeFilterCol = null;

function parseDurationInput(str) {
  str = String(str).trim();
  if (!str) return NaN;
  if (str.includes(":")) {
    const [m, s] = str.split(":").map(Number);
    if (Number.isNaN(m) || Number.isNaN(s)) return NaN;
    return m * 60 + s;
  }
  return parseFloat(str);
}

function textFilterMatch(filter, rawValue) {
  const v = String(rawValue || "").toLowerCase();
  const q = String(filter.value || "").toLowerCase();
  switch (filter.op) {
    case "contains": return v.includes(q);
    case "not_contains": return !v.includes(q);
    case "equals": return v === q;
    case "starts_with": return v.startsWith(q);
    case "ends_with": return v.endsWith(q);
    case "is_blank": return v === "";
    case "is_not_blank": return v !== "";
    default: return true;
  }
}

function numberFilterMatch(filter, rawValue) {
  if (rawValue === null || rawValue === undefined || Number.isNaN(rawValue)) return false;
  const a = filter.value;
  const b = filter.value2;
  switch (filter.op) {
    case "eq": return rawValue === a;
    case "neq": return rawValue !== a;
    case "gt": return rawValue > a;
    case "gte": return rawValue >= a;
    case "lt": return rawValue < a;
    case "lte": return rawValue <= a;
    case "between": return rawValue >= Math.min(a, b) && rawValue <= Math.max(a, b);
    default: return true;
  }
}

function dateFilterMatch(filter, mtimeSec) {
  if (!mtimeSec) return false;
  const d = new Date(mtimeSec * 1000);
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const parse = (s) => {
    const [y, m, dd] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  const a = parse(filter.value);
  switch (filter.op) {
    case "on": return day === a;
    case "before": return day < a;
    case "after": return day > a;
    case "between": {
      const b = parse(filter.value2);
      return day >= Math.min(a, b) && day <= Math.max(a, b);
    }
    default: return true;
  }
}

function valuesFilterMatch(filter, rawValue) {
  return filter.selected.has(rawValue);
}

function trackPassesColumnFilters(t) {
  for (const col in columnFilters) {
    const filter = columnFilters[col];
    if (!filter) continue;
    const config = COLUMN_CONFIG[col];
    const rawValue = config.get(t);
    let ok;
    if (config.type === "text") ok = textFilterMatch(filter, rawValue);
    else if (config.type === "number") ok = numberFilterMatch(filter, rawValue);
    else if (config.type === "date") ok = dateFilterMatch(filter, rawValue);
    else ok = valuesFilterMatch(filter, rawValue);
    if (!ok) return false;
  }
  return true;
}

function distinctValuesFor(col) {
  const config = COLUMN_CONFIG[col];
  const set = new Set();
  libraryTracks.forEach((t) => set.add(config.get(t)));
  return [...set].sort((a, b) => String(a).localeCompare(String(b)));
}

function closeColumnFilter() {
  colFilterPopover.hidden = true;
  activeFilterCol = null;
}

function positionPopover(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const popW = 240;
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  colFilterPopover.style.left = `${Math.max(8, left)}px`;
  colFilterPopover.style.top = `${rect.bottom + 6}px`;
}

function buildTextFilterHtml(existing) {
  const op = existing?.op || "contains";
  const value = existing?.value || "";
  const hideValue = op === "is_blank" || op === "is_not_blank";
  const opts = TEXT_OPS.map(([v, label]) => `<option value="${v}"${v === op ? " selected" : ""}>${label}</option>`).join("");
  return `
    <div class="cf-row"><select class="cf-op">${opts}</select></div>
    <div class="cf-row cf-value1-row"${hideValue ? " hidden" : ""}><input type="text" class="cf-value" placeholder="Filter value…" value="${escapeHtml(value)}" /></div>
    <div class="col-filter-actions">
      <button type="button" class="cf-clear">Clear</button>
      <button type="button" class="cf-apply">Apply</button>
    </div>
  `;
}

function buildNumberFilterHtml(existing, config) {
  const op = existing?.op || "gte";
  const value = existing?.value ?? "";
  const value2 = existing?.value2 ?? "";
  const isBetween = op === "between";
  const placeholder = config.isDuration ? "mm:ss or seconds" : "";
  const opts = NUMBER_OPS.map(([v, label]) => `<option value="${v}"${v === op ? " selected" : ""}>${label}</option>`).join("");

  const valueInput = (cls, val) => {
    if (config.options) {
      const inner = config.options
        .map((o) => `<option value="${o}"${String(o) === String(val) ? " selected" : ""}>${o}</option>`)
        .join("");
      return `<select class="${cls}"><option value="">–</option>${inner}</select>`;
    }
    return `<input type="text" class="${cls}" placeholder="${placeholder}" value="${escapeHtml(String(val))}" />`;
  };

  return `
    <div class="cf-row"><select class="cf-op">${opts}</select></div>
    <div class="cf-row cf-value1-row">${valueInput("cf-value", value)}</div>
    <div class="cf-row cf-value2-row"${isBetween ? "" : " hidden"}>${valueInput("cf-value2", value2)}</div>
    <div class="col-filter-actions">
      <button type="button" class="cf-clear">Clear</button>
      <button type="button" class="cf-apply">Apply</button>
    </div>
  `;
}

function buildDateFilterHtml(existing) {
  const op = existing?.op || "on";
  const value = existing?.value || "";
  const value2 = existing?.value2 || "";
  const isBetween = op === "between";
  const opts = DATE_OPS.map(([v, label]) => `<option value="${v}"${v === op ? " selected" : ""}>${label}</option>`).join("");
  return `
    <div class="cf-row"><select class="cf-op">${opts}</select></div>
    <div class="cf-row cf-value1-row"><input type="date" class="cf-value" value="${value}" /></div>
    <div class="cf-row cf-value2-row"${isBetween ? "" : " hidden"}><input type="date" class="cf-value2" value="${value2}" /></div>
    <div class="col-filter-actions">
      <button type="button" class="cf-clear">Clear</button>
      <button type="button" class="cf-apply">Apply</button>
    </div>
  `;
}

function buildValuesFilterHtml(col, existing) {
  const allValues = distinctValuesFor(col);
  const selected = existing?.selected || new Set(allValues);
  const allChecked = allValues.every((v) => selected.has(v));
  const rows = allValues
    .map((v) => {
      const label = v === "" || v == null ? "(blank)" : String(v);
      const checked = selected.has(v) ? " checked" : "";
      return `<label class="cf-value-row"><input type="checkbox" class="cf-val-check" value="${escapeHtml(String(v))}"${checked} /><span>${escapeHtml(label)}</span></label>`;
    })
    .join("");
  return `
    <div class="cf-row"><input type="text" class="cf-search" placeholder="Search values…" /></div>
    <div class="cf-values-list">
      <label class="cf-value-row cf-select-all-row"><input type="checkbox" class="cf-select-all"${allChecked ? " checked" : ""} /><span>(Select all)</span></label>
      <div class="cf-values-body">${rows}</div>
    </div>
    <div class="col-filter-actions">
      <button type="button" class="cf-clear">Clear</button>
      <button type="button" class="cf-apply">Apply</button>
    </div>
  `;
}

function readFilterFromPopover(config) {
  if (config.type === "text") {
    return {
      op: colFilterPopover.querySelector(".cf-op").value,
      value: colFilterPopover.querySelector(".cf-value").value.trim(),
    };
  }
  if (config.type === "number") {
    const op = colFilterPopover.querySelector(".cf-op").value;
    const parse = config.isDuration ? parseDurationInput : parseFloat;
    const value = parse(colFilterPopover.querySelector(".cf-value").value);
    const value2 = op === "between" ? parse(colFilterPopover.querySelector(".cf-value2").value) : undefined;
    return { op, value, value2 };
  }
  if (config.type === "date") {
    const op = colFilterPopover.querySelector(".cf-op").value;
    const value = colFilterPopover.querySelector(".cf-value").value;
    const value2 = op === "between" ? colFilterPopover.querySelector(".cf-value2").value : undefined;
    return { op, value, value2 };
  }
  const selected = new Set([...colFilterPopover.querySelectorAll(".cf-val-check:checked")].map((cb) => cb.value));
  return { selected };
}

function wirePopoverEvents(col, config) {
  const opSelect = colFilterPopover.querySelector(".cf-op");
  if (opSelect) {
    opSelect.addEventListener("change", () => {
      const op = opSelect.value;
      const value1Row = colFilterPopover.querySelector(".cf-value1-row");
      const value2Row = colFilterPopover.querySelector(".cf-value2-row");
      if (config.type === "text") {
        value1Row.hidden = op === "is_blank" || op === "is_not_blank";
      } else if (value2Row) {
        value2Row.hidden = op !== "between";
      }
    });
  }

  const selectAll = colFilterPopover.querySelector(".cf-select-all");
  if (selectAll) {
    const checks = () => [...colFilterPopover.querySelectorAll(".cf-val-check")];
    selectAll.addEventListener("change", () => {
      checks().forEach((cb) => (cb.checked = selectAll.checked));
    });
    checks().forEach((cb) => {
      cb.addEventListener("change", () => {
        selectAll.checked = checks().every((c) => c.checked);
      });
    });
  }

  const searchInput = colFilterPopover.querySelector(".cf-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      colFilterPopover.querySelectorAll(".cf-values-body .cf-value-row").forEach((row) => {
        row.hidden = !row.querySelector("span").textContent.toLowerCase().includes(q);
      });
    });
  }

  colFilterPopover.querySelector(".cf-clear").addEventListener("click", () => {
    delete columnFilters[col];
    closeColumnFilter();
    renderBrowseTable();
  });

  colFilterPopover.querySelector(".cf-apply").addEventListener("click", () => {
    const filter = readFilterFromPopover(config);
    let invalid = false;
    if (config.type === "number") {
      invalid = Number.isNaN(filter.value) || (filter.op === "between" && Number.isNaN(filter.value2));
    } else if (config.type === "date") {
      invalid = !filter.value || (filter.op === "between" && !filter.value2);
    } else if (config.type === "text") {
      invalid = !["is_blank", "is_not_blank"].includes(filter.op) && !filter.value;
    } else if (config.type === "values") {
      invalid = filter.selected.size === distinctValuesFor(col).length;
    }
    if (invalid) delete columnFilters[col];
    else columnFilters[col] = filter;
    closeColumnFilter();
    renderBrowseTable();
  });
}

function openColumnFilter(col, btnEl) {
  if (activeFilterCol === col && !colFilterPopover.hidden) {
    closeColumnFilter();
    return;
  }
  activeFilterCol = col;
  const config = COLUMN_CONFIG[col];
  const existing = columnFilters[col];

  let html;
  if (config.type === "text") html = buildTextFilterHtml(existing);
  else if (config.type === "number") html = buildNumberFilterHtml(existing, config);
  else if (config.type === "date") html = buildDateFilterHtml(existing);
  else html = buildValuesFilterHtml(col, existing);

  colFilterPopover.innerHTML = html;
  colFilterPopover.hidden = false;
  positionPopover(btnEl);
  wirePopoverEvents(col, config);
}

document.querySelectorAll(".col-filter-btn").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    openColumnFilter(btn.dataset.col, btn);
  });
});

document.addEventListener("click", (event) => {
  if (colFilterPopover.hidden) return;
  if (colFilterPopover.contains(event.target)) return;
  closeColumnFilter();
});

document.addEventListener("keydown", (event) => {
  if (!colFilterPopover.hidden && event.key === "Escape") closeColumnFilter();
});

function renderBrowseTable() {
  const query = browseSearch.value.trim().toLowerCase();

  let rows = libraryTracks;
  if (query) {
    rows = rows.filter((t) => {
      const genre = (t.confirmed_genre || t.predicted_genre || "").toLowerCase();
      return t.filename.toLowerCase().includes(query) || genre.includes(query);
    });
  }
  rows = rows.filter(trackPassesColumnFilters);
  rows = [...rows].sort((a, b) => compareTracksBy(a, b, librarySortKey, librarySortDir));

  browseTbody.innerHTML = rows.map(trackRowHtml).join("");
  browseEmpty.hidden = rows.length > 0;

  document.querySelectorAll(".browse-table th[data-sort]").forEach((th) => {
    const isSorted = th.dataset.sort === librarySortKey;
    th.classList.toggle("sorted", isSorted);
    th.dataset.dir = isSorted ? (librarySortDir === "asc" ? "↑" : "↓") : "";
  });

  document.querySelectorAll(".col-filter-btn").forEach((btn) => {
    btn.classList.toggle("active", !!columnFilters[btn.dataset.col]);
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
