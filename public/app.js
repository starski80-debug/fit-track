const state = { data: null, view: "dashboard", historyPersonId: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const areas = { Petto:"PET", Schiena:"SCH", Spalle:"SPA", Braccia:"BRA", Gambe:"GAM", Addome:"ADD", Cardio:"CAR", Altro:"ALT" };
const defaultExerciseCatalog = {
  Petto: [
    "Panca piana con bilanciere", "Panca inclinata con bilanciere",
    "Panca piana con manubri", "Panca inclinata con manubri",
    "Chest press", "Croci con manubri", "Croci ai cavi", "Dip per il petto", "Piegamenti"
  ],
  Schiena: [
    "Trazioni alla sbarra", "Lat machine", "Pulley basso", "Rematore con bilanciere",
    "Rematore con manubrio", "Rematore alla macchina", "Stacco da terra",
    "Pullover ai cavi", "Iperestensioni"
  ],
  Spalle: [
    "Military press", "Shoulder press", "Arnold press", "Lento avanti",
    "Alzate laterali", "Alzate frontali", "Alzate posteriori", "Face pull", "Tirate al mento"
  ],
  Braccia: [
    "Curl con bilanciere", "Curl con manubri", "Curl a martello", "Curl alla panca Scott",
    "Curl ai cavi", "French press", "Push down ai cavi", "Estensioni sopra la testa",
    "Dip per tricipiti", "Panca presa stretta"
  ],
  Gambe: [
    "Squat", "Front squat", "Pressa", "Affondi", "Bulgarian split squat",
    "Leg extension", "Leg curl", "Stacco rumeno", "Hip thrust", "Calf raise"
  ],
  Addome: [
    "Crunch", "Crunch inverso", "Plank", "Plank laterale", "Sit-up",
    "Leg raise", "Mountain climber", "Russian twist", "Ab wheel"
  ],
  Cardio: [
    "Corsa", "Camminata veloce", "Cyclette", "Ellittica", "Vogatore",
    "Salto con la corda", "Stepper", "Circuito HIIT"
  ],
  Altro: ["Mobilita", "Stretching", "Riscaldamento"]
};

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
})[char]);

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2300);
}

async function request(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) }
  });
  const body = await response.json();
  if (response.status === 401 && url !== "/api/auth/login") showLogin();
  if (!response.ok) throw new Error(body.error || "Errore");
  return body;
}

function showLogin(message = "") {
  const dialog = $("#login-dialog");
  $("#login-error").textContent = message;
  $("#login-error").classList.toggle("hidden", !message);
  if (!dialog.open) dialog.showModal();
}

const formatDate = (date) => new Intl.DateTimeFormat("it-IT", {
  day:"numeric", month:"short", year:"numeric"
}).format(new Date(`${date}T12:00:00`));

function workoutCard(workout) {
  const bodyAreas = [...new Set(workout.exercises.map((item) => item.body_area))];
  const exerciseCount = workout.exercises.length;
  return `<article class="workout-card">
    <div class="avatar" style="background:${escapeHtml(workout.person_color)}">${escapeHtml(workout.person_name[0])}</div>
    <div class="workout-main">
      <h3>${escapeHtml(workout.person_name)} · ${bodyAreas.map(escapeHtml).join(" + ")}</h3>
      <div class="workout-meta">
        <span>${formatDate(workout.workout_date)}</span>
        <span>${exerciseCount} ${exerciseCount === 1 ? "esercizio" : "esercizi"}</span>
      </div>
      <div class="exercise-tags">${workout.exercises.slice(0, 4).map((item) =>
        `<span class="tag area-tag" data-area="${escapeHtml(item.body_area)}">${areas[item.body_area] || "ALT"} · ${escapeHtml(item.name)}</span>`
      ).join("")}</div>
    </div>
    <div class="workout-side">
      <b>${workout.duration} min</b>
      <button class="delete" data-delete="${workout.id}">Elimina</button>
    </div>
  </article>`;
}

function render() {
  const { people, workouts, stats } = state.data;
  $("#stats").innerHTML = [
    ["Allenamenti", stats.workouts],
    ["Questo mese", stats.monthWorkouts],
    ["Tempo totale", `${Math.floor(stats.minutes / 60)}h ${stats.minutes % 60}m`],
    ["Persone", stats.people]
  ].map(([label,value]) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`).join("");

  $("#recent-workouts").innerHTML = workouts.slice(0, 4).map(workoutCard).join("") ||
    `<div class="empty">Nessun allenamento registrato.</div>`;
  renderHistory();
  $("#people-grid").innerHTML = people.map((person) => {
    const personWorkouts = workouts.filter((item) => item.person_id === person.id);
    const details = [
      person.birth_date ? `Nato/a: ${formatDate(person.birth_date)}` : "",
      person.height ? `${person.height} cm` : "",
      person.weight ? `${person.weight} kg` : ""
    ].filter(Boolean);
    return `<article class="person-card" data-edit-person="${person.id}" tabindex="0" role="button">
      <div class="avatar" style="background:${escapeHtml(person.color)}">${escapeHtml(person.name[0])}</div>
      <h3>${escapeHtml(person.name)}</h3>
      <p>${personWorkouts.length} ${personWorkouts.length === 1 ? "allenamento" : "allenamenti"}</p>
      ${details.length ? `<div class="person-details">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</div>` : ""}
    </article>`;
  }).join("");

  const personOptions = people.map((person) =>
    `<option value="${person.id}">${escapeHtml(person.name)}</option>`
  ).join("");
  $("#person-select").innerHTML = personOptions;
  renderCatalog();
}

function renderCatalog() {
  const filter = $("#catalog-filter").value;
  const bodyAreas = Object.keys(defaultExerciseCatalog).filter((area) => !filter || area === filter);
  $("#catalog-grid").innerHTML = bodyAreas.map((area) => {
    const items = (state.data.catalog || []).filter((item) => item.body_area === area);
    return `<section class="catalog-group">
      <h3>${escapeHtml(area)} <span>${items.length} esercizi</span></h3>
      <div class="catalog-list">${items.map((item) => `
        <div class="catalog-item">
          <span>${escapeHtml(item.name)}</span>
          <button class="catalog-delete" data-delete-catalog="${item.id}" title="Rimuovi">Elimina</button>
        </div>`).join("") || `<span class="empty-catalog">Nessun esercizio</span>`}</div>
    </section>`;
  }).join("");
}

function renderHistory() {
  const person = state.data.people.find((item) => item.id === state.historyPersonId);
  $("#history-people").classList.toggle("hidden", Boolean(person));
  $("#history-detail").classList.toggle("hidden", !person);
  $("#history-back").classList.toggle("hidden", !person);
  $("#history-help").classList.toggle("hidden", Boolean(person));
  $("#history-title").textContent = person ? `Storico di ${person.name}` : "Scegli una persona";

  if (!person) {
    $("#history-people").innerHTML = state.data.people.map((item) => {
      const workouts = state.data.workouts.filter((workout) => workout.person_id === item.id);
      const days = new Set(workouts.map((workout) => workout.workout_date)).size;
      return `<button class="history-person" data-history-person="${item.id}">
        <div class="avatar" style="background:${escapeHtml(item.color)}">${escapeHtml(item.name[0])}</div>
        <div><h3>${escapeHtml(item.name)}</h3><p>${days} ${days === 1 ? "giorno" : "giorni"} · ${workouts.length} ${workouts.length === 1 ? "sessione" : "sessioni"}</p></div>
      </button>`;
    }).join("") || `<div class="empty">Nessuna persona inserita.</div>`;
    return;
  }

  const groupedDays = groupWorkoutsByDay(
    state.data.workouts.filter((workout) => workout.person_id === person.id)
  );
  const totalVolume = groupedDays.reduce((sum, day) => sum + day.volume, 0);
  const totalSessions = groupedDays.reduce((sum, day) => sum + day.workouts.length, 0);
  const totalMinutes = groupedDays.reduce((sum, day) => sum + day.duration, 0);
  const averageVolume = groupedDays.length ? Math.round(totalVolume / groupedDays.length) : 0;
  $("#history-summary").innerHTML = [
    ["Giorni allenati", groupedDays.length],
    ["Sessioni", totalSessions],
    ["Tempo totale", `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`],
    ["Volume medio", `${formatNumber(averageVolume)} kg`]
  ].map(([label, value]) => `<div class="history-stat"><span>${label}</span><b>${value}</b></div>`).join("");
  $("#progress-chart").innerHTML = progressChart(groupedDays);
  $("#history-days").innerHTML = groupedDays.map(dayCard).join("") ||
    `<div class="empty">Nessun allenamento registrato per ${escapeHtml(person.name)}.</div>`;
}

function exerciseVolume(exercise) {
  return Number(exercise.sets || 0) * Number(exercise.reps || 0) * Number(exercise.weight || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits:1 }).format(value || 0);
}

function groupWorkoutsByDay(workouts) {
  const groups = new Map();
  for (const workout of workouts) {
    if (!groups.has(workout.workout_date)) {
      groups.set(workout.workout_date, {
        date:workout.workout_date, workouts:[], exercises:[], duration:0, notes:[], volume:0
      });
    }
    const day = groups.get(workout.workout_date);
    day.workouts.push(workout);
    day.exercises.push(...workout.exercises);
    day.duration += Number(workout.duration || 0);
    if (workout.notes) day.notes.push(workout.notes);
    day.volume += workout.exercises.reduce((sum, exercise) => sum + exerciseVolume(exercise), 0);
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function dayCard(day) {
  const bodyAreas = [...new Set(day.exercises.map((exercise) => exercise.body_area))];
  return `<article class="day-card">
    <div class="day-head">
      <div><h3>${formatDate(day.date)}</h3><p>${day.workouts.length} ${day.workouts.length === 1 ? "sessione" : "sessioni"} · ${day.duration} minuti</p></div>
      <div class="day-volume"><b>${formatNumber(day.volume)} kg</b><span>volume totale</span></div>
    </div>
    <div class="day-areas">${bodyAreas.map((area) => `<span class="tag area-tag" data-area="${escapeHtml(area)}">${escapeHtml(area)}</span>`).join("")}</div>
    <div class="exercise-table">
      <div class="exercise-detail exercise-table-head"><span>Esercizio</span><span>Serie</span><span>Rip.</span><span>Peso</span><span>Volume</span></div>
      ${day.exercises.map((exercise) => `<div class="exercise-detail">
        <strong>${escapeHtml(exercise.name)} <small class="tag area-tag" data-area="${escapeHtml(exercise.body_area)}">${escapeHtml(exercise.body_area)}</small></strong>
        <span>${exercise.sets} serie</span>
        <span>${exercise.reps} rip.</span>
        <span>${formatNumber(exercise.weight)} kg</span>
        <span class="exercise-volume">${formatNumber(exerciseVolume(exercise))} kg</span>
      </div>`).join("")}
    </div>
    ${day.notes.length ? `<div class="day-notes">${day.notes.map(escapeHtml).join(" · ")}</div>` : ""}
  </article>`;
}

function progressChart(days) {
  if (!days.length) return `<div class="empty">Il grafico comparira dopo il primo allenamento.</div>`;
  const points = [...days].reverse().slice(-12);
  const width = 760;
  const height = 230;
  const padding = { left:45, right:20, top:25, bottom:38 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((day) => day.volume), 1);
  const coordinates = points.map((day, index) => ({
    ...day,
    x:padding.left + (points.length === 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1)),
    y:padding.top + chartHeight - (day.volume / maxValue) * chartHeight
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${coordinates[0].x},${padding.top + chartHeight} ${line} ${coordinates.at(-1).x},${padding.top + chartHeight}`;
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const y = padding.top + chartHeight * ratio;
    const value = maxValue * (1 - ratio);
    return `<line class="chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/>
      <text class="chart-label" x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${formatNumber(value)}</text>`;
  }).join("");
  const dateLabels = coordinates.map((point, index) => {
    if (points.length > 7 && index % 2 && index !== points.length - 1) return "";
    const label = new Intl.DateTimeFormat("it-IT", { day:"2-digit", month:"2-digit" }).format(new Date(`${point.date}T12:00:00`));
    return `<text class="chart-label" x="${point.x}" y="${height - 12}" text-anchor="middle">${label}</text>`;
  }).join("");
  const dots = coordinates.map((point) => `<circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="5">
    <title>${formatDate(point.date)}: ${formatNumber(point.volume)} kg</title>
  </circle>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico del volume sollevato">
    <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6c63ff" stop-opacity=".24"/><stop offset="100%" stop-color="#6c63ff" stop-opacity=".02"/></linearGradient></defs>
    ${grid}<polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${line}"/>${dots}${dateLabels}
  </svg>`;
}

async function load() {
  state.data = await request("/api/dashboard");
  if (!Array.isArray(state.data.catalog)) {
    state.data.catalog = Object.entries(defaultExerciseCatalog).flatMap(([bodyArea, names]) =>
      names.map((name, index) => ({ id:`default-${bodyArea}-${index}`, body_area:bodyArea, name }))
    );
    state.data.catalogFallback = true;
  }
  render();
}

function switchView(view) {
  state.view = view;
  $$(".view").forEach((element) => element.classList.add("hidden"));
  $(`#${view}-view`).classList.remove("hidden");
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $("#page-title").textContent = {
    dashboard:"Bentornato", history:"Il tuo diario", people:"Le persone", catalog:"I tuoi esercizi"
  }[view];
  window.scrollTo({ top:0, behavior:"smooth" });
}

function addExercise(defaults = {}) {
  const row = $("#exercise-template").content.firstElementChild.cloneNode(true);
  $(".body-area", row).value = defaults.bodyArea || "Petto";
  updateExerciseOptions(row, defaults.name);
  $(".sets", row).value = defaults.sets || "";
  $(".reps", row).value = defaults.reps || "";
  $(".weight", row).value = defaults.weight || "";
  $("#exercise-list").append(row);
}

function updateExerciseOptions(row, selectedName = "") {
  const area = $(".body-area", row).value;
  const select = $(".exercise-name", row);
  const customInput = $(".custom-exercise", row);
  const options = state.data && Array.isArray(state.data.catalog)
    ? state.data.catalog.filter((item) => item.body_area === area).map((item) => item.name)
    : defaultExerciseCatalog[area] || [];
  const knownExercise = options.includes(selectedName);
  select.innerHTML = [
    `<option value="">Seleziona esercizio</option>`,
    ...options.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`),
    `<option value="__custom__">Altro / personalizzato...</option>`
  ].join("");
  select.value = selectedName && knownExercise ? selectedName : selectedName ? "__custom__" : "";
  customInput.value = selectedName && !knownExercise ? selectedName : "";
  toggleCustomExercise(row);
}

function toggleCustomExercise(row) {
  const isCustom = $(".exercise-name", row).value === "__custom__";
  const input = $(".custom-exercise", row);
  input.classList.toggle("hidden", !isCustom);
  input.required = isCustom;
  if (isCustom) input.focus();
}

function openWorkout() {
  if (!state.data) return toast("Attendi il caricamento dei dati.");
  if (!state.data.people.length) return toast("Aggiungi prima una persona.");
  $("#workout-form").reset();
  $("#workout-form [name=date]").value = new Date().toISOString().slice(0, 10);
  $("#exercise-list").innerHTML = "";
  addExercise({ sets:3, reps:10 });
  $("#workout-dialog").showModal();
}

function openPerson(person = null) {
  const form = $("#person-form");
  form.reset();
  form.elements.id.value = person?.id || "";
  form.elements.name.value = person?.name || "";
  form.elements.color.value = person?.color || "#6c63ff";
  form.elements.birthDate.value = person?.birth_date || "";
  form.elements.height.value = person?.height || "";
  form.elements.weight.value = person?.weight || "";
  form.elements.notes.value = person?.notes || "";
  $("#person-dialog-title").textContent = person ? "Modifica persona" : "Aggiungi persona";
  $("#delete-person").classList.toggle("hidden", !person);
  $("#person-dialog").showModal();
}

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view],[data-go]");
  if (viewButton) switchView(viewButton.dataset.view || viewButton.dataset.go);
  const historyPerson = event.target.closest("[data-history-person]");
  if (historyPerson) {
    state.historyPersonId = Number(historyPerson.dataset.historyPerson);
    renderHistory();
  }
  if (event.target.closest("#history-back")) {
    state.historyPersonId = null;
    renderHistory();
  }
  if (event.target.closest("#new-workout,#mobile-new")) openWorkout();
  if (event.target.closest("#new-person")) openPerson();
  if (event.target.closest("#new-catalog-exercise")) {
    if (state.data?.catalogFallback) return toast("Chiudi e riavvia FitTrack per modificare il catalogo.");
    $("#catalog-dialog").showModal();
  }
  const personCard = event.target.closest("[data-edit-person]");
  if (personCard) {
    const person = state.data.people.find((item) => item.id === Number(personCard.dataset.editPerson));
    if (person) openPerson(person);
  }
  if (event.target.matches(".close")) event.target.closest("dialog").close();
  if (event.target.matches("#add-exercise")) addExercise({ sets:3, reps:10 });
  if (event.target.matches(".remove-exercise")) {
    if ($$(".exercise-row").length > 1) event.target.closest(".exercise-row").remove();
    else toast("Serve almeno un esercizio.");
  }
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton && confirm("Eliminare questo allenamento?")) {
    await request(`/api/workouts/${deleteButton.dataset.delete}`, { method:"DELETE" });
    await load();
    toast("Allenamento eliminato.");
  }
  const catalogDeleteButton = event.target.closest("[data-delete-catalog]");
  if (catalogDeleteButton && String(catalogDeleteButton.dataset.deleteCatalog).startsWith("default-")) {
    return toast("Chiudi e riavvia FitTrack per modificare il catalogo.");
  }
  if (catalogDeleteButton && confirm("Rimuovere questo esercizio dal catalogo? Gli allenamenti gia registrati resteranno invariati.")) {
    await request(`/api/catalog/${catalogDeleteButton.dataset.deleteCatalog}`, { method:"DELETE" });
    await load();
    toast("Esercizio rimosso dal catalogo.");
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-edit-person]")) {
    event.preventDefault();
    event.target.click();
  }
});

document.addEventListener("change", (event) => {
  const row = event.target.closest(".exercise-row");
  if (!row) return;
  if (event.target.matches(".body-area")) updateExerciseOptions(row);
  if (event.target.matches(".exercise-name")) toggleCustomExercise(row);
});

$("#catalog-filter").addEventListener("change", renderCatalog);
$("#workout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const exercises = $$(".exercise-row").map((row) => ({
    bodyArea: $(".body-area", row).value,
    name: $(".exercise-name", row).value === "__custom__"
      ? $(".custom-exercise", row).value
      : $(".exercise-name", row).value,
    sets: $(".sets", row).value,
    reps: $(".reps", row).value,
    weight: $(".weight", row).value
  }));
  try {
    await request("/api/workouts", {
      method:"POST",
      body:JSON.stringify({
        personId:Number(form.get("personId")), date:form.get("date"),
        duration:Number(form.get("duration")), notes:form.get("notes"), exercises
      })
    });
    $("#workout-dialog").close();
    await load();
    toast("Allenamento salvato!");
  } catch (error) { toast(error.message); }
});

$("#person-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    const id = form.get("id");
    await request(id ? `/api/people/${id}` : "/api/people", {
      method:id ? "PUT" : "POST",
      body:JSON.stringify({
        name:form.get("name"), color:form.get("color"), birthDate:form.get("birthDate"),
        height:form.get("height"), weight:form.get("weight"), notes:form.get("notes")
      })
    });
    $("#person-dialog").close();
    formElement.reset();
    await load();
    toast(id ? "Dati della persona aggiornati!" : "Persona aggiunta!");
  } catch (error) { toast(error.message); }
});

$("#delete-person").addEventListener("click", async () => {
  const id = $("#person-form").elements.id.value;
  if (!id) return;
  const person = state.data.people.find((item) => item.id === Number(id));
  if (!confirm(`Eliminare ${person?.name || "questa persona"}? Verranno eliminati anche tutti i suoi allenamenti.`)) return;
  try {
    await request(`/api/people/${id}`, { method:"DELETE" });
    $("#person-dialog").close();
    await load();
    toast("Persona eliminata.");
  } catch (error) { toast(error.message); }
});

$("#catalog-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    await request("/api/catalog", {
      method:"POST",
      body:JSON.stringify({ bodyArea:form.get("bodyArea"), name:form.get("name") })
    });
    $("#catalog-dialog").close();
    formElement.reset();
    await load();
    switchView("catalog");
    toast("Esercizio aggiunto al catalogo!");
  } catch (error) { toast(error.message); }
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    await request("/api/auth/login", {
      method:"POST", body:JSON.stringify({ password:form.get("password") })
    });
    $("#login-dialog").close();
    formElement.reset();
    $("#logout").classList.remove("hidden");
    await load();
  } catch (error) {
    showLogin(error.message);
  }
});

$("#logout").addEventListener("click", async () => {
  await request("/api/auth/logout", { method:"POST" });
  state.data = null;
  showLogin();
});

$("#today").textContent = new Intl.DateTimeFormat("it-IT", {
  weekday:"long", day:"numeric", month:"long"
}).format(new Date()).toUpperCase();

const savedTheme = localStorage.getItem("fittrack-theme");
if (savedTheme === "dark") document.documentElement.dataset.theme = "dark";
function updateThemeIcon() {
  $(".theme-icon").textContent = document.documentElement.dataset.theme === "dark" ? "S" : "L";
  $("#theme-toggle").title = document.documentElement.dataset.theme === "dark" ? "Tema chiaro" : "Tema scuro";
}
$("#theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  localStorage.setItem("fittrack-theme", dark ? "dark" : "light");
  updateThemeIcon();
});
updateThemeIcon();

async function initialize() {
  try {
    const auth = await request("/api/auth/status");
    $("#logout").classList.toggle("hidden", !auth.required);
    if (!auth.authenticated) return showLogin();
    await load();
  } catch (error) {
    toast("Impossibile collegarsi al server.");
  }
}
initialize();
