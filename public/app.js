const state = { data: null, view: "dashboard", historyPersonId: null, peopleSearch: "", scheduleDate:new Date().toISOString().slice(0, 10) };
let deferredInstallPrompt = null;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const areas = { Petto:"PET", Dorso:"DOR", Spalle:"SPA", Braccia:"BRA", Gambe:"GAM", Addome:"ADD", Cardio:"CAR", Altro:"ALT" };
const phaseLabels = { warmup:"Warm up", main:"Main part", cooldown:"Cool down" };
const rpeLabels = {
  0:"Rest", 1:"Very Easy", 2:"Easy", 3:"Comfortable", 4:"Moderate", 5:"Challenging",
  6:"Sort of Hard", 7:"Hard", 8:"Really Hard", 9:"Extremely Hard", 10:"Maximum Effort"
};
const defaultExerciseCatalog = {
  Petto: [
    "Panca piana con bilanciere", "Panca inclinata con bilanciere",
    "Panca piana con manubri", "Panca inclinata con manubri",
    "Chest press", "Croci con manubri", "Croci ai cavi", "Dip per il petto", "Piegamenti"
  ],
  Dorso: [
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

function bodyAreaList() {
  const names = new Set(Object.keys(defaultExerciseCatalog));
  for (const item of state.data?.catalog || []) names.add(item.body_area);
  for (const workout of state.data?.workouts || []) {
    for (const exercise of workout.exercises || []) names.add(exercise.body_area);
  }
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, "it"));
}

function fillAreaSelect(select, selected = "") {
  const current = selected || select.value || "Petto";
  select.innerHTML = bodyAreaList().map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("");
  select.value = bodyAreaList().includes(current) ? current : "Altro";
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2300);
}

async function request(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal:controller.signal,
      credentials:"same-origin",
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) }
    });
    const body = await response.json();
    if (response.status === 401 && url !== "/api/auth/login") showLogin();
    if (!response.ok) throw new Error(body.error || "Errore");
    return body;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Il server non risponde. Controlla la connessione e riprova.");
    if (error instanceof TypeError) throw new Error("Connessione assente. Controlla internet e riprova.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function setFormBusy(form, busy) {
  const submit = form.querySelector('[type="submit"]');
  if (!submit) return;
  submit.disabled = busy;
  submit.classList.toggle("is-loading", busy);
  if (busy) {
    submit.dataset.label = submit.textContent;
    submit.textContent = "Attendi...";
  } else if (submit.dataset.label) {
    submit.textContent = submit.dataset.label;
    delete submit.dataset.label;
  }
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
    <button type="button" class="avatar avatar-button" data-open-person-history="${workout.person_id}" style="background:${escapeHtml(workout.person_color)}" aria-label="Apri allenamenti di ${escapeHtml(workout.person_name)}">${escapeHtml(workout.person_name[0])}</button>
    <div class="workout-main">
      <h3><button type="button" class="person-link" data-open-person-history="${workout.person_id}">${escapeHtml(workout.person_name)}</button> · ${bodyAreas.map(escapeHtml).join(" + ")}</h3>
      <div class="workout-meta">
        <span>${formatDate(workout.workout_date)}</span>
        <span>${exerciseCount} ${exerciseCount === 1 ? "esercizio" : "esercizi"}</span>
        ${workout.operator ? `<span>Operatore: ${escapeHtml(workout.operator)}</span>` : ""}
        ${workout.rpe !== undefined && workout.rpe !== null && workout.rpe !== "" ? `<span>RPE ${workout.rpe}${rpeLabels[workout.rpe] ? ` - ${escapeHtml(rpeLabels[workout.rpe])}` : ""}</span>` : ""}
      </div>
      <div class="exercise-tags">${workout.exercises.slice(0, 4).map((item) =>
        `<span class="tag area-tag" data-area="${escapeHtml(item.body_area)}">${areas[item.body_area] || "ALT"} · ${escapeHtml(item.name)}</span>`
      ).join("")}</div>
    </div>
    <div class="workout-side">
      <b>${workout.duration} min</b>
      <button class="delete" data-edit-workout="${workout.id}">Modifica</button>
      <button class="delete whatsapp-button" data-rpe-whatsapp="${workout.id}">Invia RPE</button>
      <button class="delete" data-delete="${workout.id}">Elimina</button>
    </div>
  </article>`;
}

function scheduleCard(item) {
  const reminderText = `Ciao ${item.person_name}, ti ricordiamo l'allenamento del ${formatDate(item.scheduled_date)} alle ${item.scheduled_time} con ${item.trainer}. A presto!`;
  return `<article class="schedule-item">
    <div class="schedule-time">${escapeHtml(item.scheduled_time || "--:--")}</div>
    <div class="avatar" style="background:${escapeHtml(item.person_color)}">${escapeHtml(item.person_name[0] || "?")}</div>
    <div class="schedule-body">
      <h3>${escapeHtml(item.person_name)}</h3>
      <p>${formatDate(item.scheduled_date)} · PT ${escapeHtml(item.trainer || "Da assegnare")}</p>
      ${item.notes ? `<span>${escapeHtml(item.notes)}</span>` : ""}
    </div>
    <div class="schedule-item-actions">
      <button type="button" class="schedule-reminder whatsapp-button" data-schedule-reminder="${item.id}">WhatsApp</button>
      <button type="button" class="schedule-edit" data-edit-schedule="${item.id}">Modifica</button>
      <button type="button" class="schedule-delete" data-delete-schedule="${item.id}">Elimina</button>
    </div>
    <span class="hidden" data-reminder-text="${item.id}">${escapeHtml(reminderText)}</span>
  </article>`;
}

function resetScheduleForm() {
  const form = $("#schedule-form");
  form.reset();
  form.elements.id.value = "";
  $("#schedule-submit").textContent = "Aggiungi in agenda";
  $("#schedule-cancel-edit").classList.add("hidden");
}

function openScheduleEdit(item) {
  const form = $("#schedule-form");
  state.scheduleDate = item.scheduled_date;
  $("#schedule-date").value = state.scheduleDate;
  form.elements.id.value = item.id;
  form.elements.personId.value = item.person_id;
  form.elements.trainer.value = item.trainer || "";
  form.elements.time.value = item.scheduled_time || "";
  form.elements.notes.value = item.notes || "";
  $("#schedule-submit").textContent = "Salva modifiche";
  $("#schedule-cancel-edit").classList.remove("hidden");
  renderSchedule();
  form.scrollIntoView({ behavior:"smooth", block:"center" });
}

function renderSchedule() {
  const schedule = state.data.schedule || [];
  $("#schedule-date").value = state.scheduleDate;
  $("#schedule-person").innerHTML = state.data.people.map((person) =>
    `<option value="${person.id}">${escapeHtml(person.name)}</option>`
  ).join("");
  const selected = schedule.filter((item) => item.scheduled_date === state.scheduleDate);
  const upcoming = schedule
    .filter((item) => item.scheduled_date > state.scheduleDate)
    .slice(0, 6);
  const tomorrow = tomorrowDate();
  const reminders = schedule.filter((item) => item.scheduled_date === tomorrow);
  $("#schedule-list").innerHTML = `
    <div class="schedule-column schedule-reminders">
      <h3>Promemoria di domani</h3>
      ${reminders.map(scheduleCard).join("") || `<div class="empty schedule-empty">Nessun promemoria per domani.</div>`}
    </div>
    <div class="schedule-column">
      <h3>${formatDate(state.scheduleDate)}</h3>
      ${selected.map(scheduleCard).join("") || `<div class="empty schedule-empty">Nessuno in agenda per questo giorno.</div>`}
    </div>
    <div class="schedule-column">
      <h3>Prossimi appuntamenti</h3>
      ${upcoming.map(scheduleCard).join("") || `<div class="empty schedule-empty">Nessun appuntamento futuro.</div>`}
    </div>
  `;
}

function tomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function whatsappReminderUrl(item, text) {
  const phone = String(item.person_phone || "").replace(/[^\d]/g, "");
  if (!phone) return "";
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function render() {
  const { people, workouts, stats } = state.data;
  $("#stats").innerHTML = [
    ["Allenamenti", stats.workouts],
    ["Questo mese", stats.monthWorkouts],
    ["Tempo totale", `${Math.floor(stats.minutes / 60)}h ${stats.minutes % 60}m`],
    ["Persone", stats.people]
  ].map(([label,value]) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`).join("");

  renderSchedule();
  renderHistory();
  const peopleFilter = state.peopleSearch.trim().toLowerCase();
  const visiblePeople = people.filter((person) => [
    person.name,
    person.birth_date,
    person.height,
    person.weight,
    person.phone,
    person.notes
  ].some((value) => String(value || "").toLowerCase().includes(peopleFilter)));
  $("#people-grid").innerHTML = visiblePeople.map((person) => {
    const personWorkouts = workouts.filter((item) => item.person_id === person.id);
    const details = [
      person.birth_date ? `Nato/a: ${formatDate(person.birth_date)}` : "",
      person.height ? `${person.height} cm` : "",
      person.weight ? `${person.weight} kg` : "",
      person.phone ? `WhatsApp: ${person.phone}` : ""
    ].filter(Boolean);
    return `<article class="person-card" data-open-person-history="${person.id}" tabindex="0" role="button" aria-label="Apri allenamenti di ${escapeHtml(person.name)}">
      <div class="avatar" style="background:${escapeHtml(person.color)}">${escapeHtml(person.name[0])}</div>
      <h3>${escapeHtml(person.name)}</h3>
      <p>${personWorkouts.length} ${personWorkouts.length === 1 ? "allenamento" : "allenamenti"}</p>
      ${details.length ? `<div class="person-details">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</div>` : ""}
      <button type="button" class="person-edit" data-edit-person="${person.id}">Modifica dati</button>
    </article>`;
  }).join("") || `<div class="empty">Nessuna persona trovata.</div>`;

  const personOptions = people.map((person) =>
    `<option value="${person.id}">${escapeHtml(person.name)}</option>`
  ).join("");
  $("#person-select").innerHTML = personOptions;
  $("#catalog-filter").innerHTML = [
    `<option value="">Tutte le zone</option>`,
    ...bodyAreaList().map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`)
  ].join("");
  renderCatalog();
}

function renderCatalog() {
  const filter = $("#catalog-filter").value;
  const bodyAreas = bodyAreaList().filter((area) => !filter || area === filter);
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
  const totalUnits = groupedDays.reduce((sum, day) => sum + day.units, 0);
  const totalSessions = groupedDays.reduce((sum, day) => sum + day.workouts.length, 0);
  const totalMinutes = groupedDays.reduce((sum, day) => sum + day.duration, 0);
  const averageUnits = groupedDays.length ? Math.round(totalUnits / groupedDays.length) : 0;
  $("#history-summary").innerHTML = [
    ["Giorni allenati", groupedDays.length],
    ["Sessioni", totalSessions],
    ["Tempo totale", `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`],
    ["Unita media", formatNumber(averageUnits)]
  ].map(([label, value]) => `<div class="history-stat"><span>${label}</span><b>${value}</b></div>`).join("");
  $("#progress-chart").innerHTML = progressChart(groupedDays);
  $("#rpe-progress-chart").innerHTML = rpeTrendChart(groupedDays);
  $("#history-days").innerHTML = groupedDays.map(dayCard).join("") ||
    `<div class="empty">Nessun allenamento registrato per ${escapeHtml(person.name)}.</div>`;
}

function exerciseUnits(exercise) {
  return Number(exercise.sets || 0) * Number(exercise.reps || 0) *
    (Number(exercise.weight || 0) + Number(exercise.seconds || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits:1 }).format(value || 0);
}

function hasRpe(workout) {
  return workout.rpe !== undefined && workout.rpe !== null && workout.rpe !== "";
}

function rpeSummary(values) {
  const unique = [...new Set(values.map((value) => Number(value)))].filter((value) => Number.isFinite(value));
  if (!unique.length) return "";
  if (unique.length === 1) {
    const value = unique[0];
    return `RPE ${value}${rpeLabels[value] ? ` - ${rpeLabels[value]}` : ""}`;
  }
  return `RPE ${unique.join(" / ")}`;
}

function dayRpeValue(day) {
  const values = (day.rpes || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupWorkoutsByDay(workouts) {
  const groups = new Map();
  for (const workout of workouts) {
    if (!groups.has(workout.workout_date)) {
      groups.set(workout.workout_date, {
        date:workout.workout_date, workouts:[], exercises:[], duration:0, notes:[], units:0, rpes:[]
      });
    }
    const day = groups.get(workout.workout_date);
    day.workouts.push(workout);
    day.exercises.push(...workout.exercises);
    day.duration += Number(workout.duration || 0);
    if (workout.notes) day.notes.push(workout.notes);
    if (hasRpe(workout)) day.rpes.push(workout.rpe);
    day.units += workout.exercises.reduce((sum, exercise) => sum + exerciseUnits(exercise), 0);
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function dayCard(day) {
  const bodyAreas = [...new Set(day.exercises.map((exercise) => exercise.body_area))];
  const groupIds = day.workouts.map((workout) => workout.id).join(",");
  const dayRpe = rpeSummary(day.rpes || []);
  const sessionActions = groupIds ? `
    <button type="button" class="session-edit" data-edit-workout-group="${escapeHtml(groupIds)}">
      Modifica
    </button>
    <button type="button" class="session-edit whatsapp-button" data-rpe-whatsapp-group="${escapeHtml(groupIds)}">
      Invia RPE
    </button>
  ` : "";
  const phaseOrder = ["warmup", "main", "cooldown"];
  const exerciseRows = phaseOrder.map((phase) => {
    const exercises = day.exercises.filter((exercise) => (exercise.phase || "main") === phase);
    if (!exercises.length) return "";
    return `<div class="phase-group">
      <h4>${phaseLabels[phase]}</h4>
      ${exercises.map((exercise) => `<div class="exercise-detail">
        <strong>${escapeHtml(exercise.name)} <small class="tag area-tag" data-area="${escapeHtml(exercise.body_area)}">${escapeHtml(exercise.body_area)}</small></strong>
        <span>${exercise.sets} serie</span>
        <span>${exercise.reps} rip.</span>
        <span>${formatNumber(exercise.weight)} kg · ${Number(exercise.seconds || 0)} sec</span>
        <span class="exercise-volume">${formatNumber(exerciseUnits(exercise))}</span>
      </div>`).join("")}
    </div>`;
  }).join("");
  return `<article class="day-card">
    <div class="day-head">
      <div>
        <h3>${formatDate(day.date)}</h3>
        <p class="day-meta">
          <span>${day.workouts.length} ${day.workouts.length === 1 ? "sessione" : "sessioni"}</span>
          <span>${day.duration} minuti</span>
          ${dayRpe ? `<span class="rpe-chip">${escapeHtml(dayRpe)}</span>` : ""}
        </p>
      </div>
      <div class="day-volume"><b>${formatNumber(day.units)}</b><span>unita totale</span></div>
    </div>
    <div class="day-actions">${sessionActions}</div>
    <div class="day-areas">${bodyAreas.map((area) => `<span class="tag area-tag" data-area="${escapeHtml(area)}">${escapeHtml(area)}</span>`).join("")}</div>
    <div class="exercise-table">
      <div class="exercise-detail exercise-table-head"><span>Esercizio</span><span>Serie</span><span>Rip.</span><span>Peso / sec</span><span>Unita</span></div>
      ${exerciseRows}
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
  const maxValue = Math.max(...points.map((day) => day.units), 1);
  const coordinates = points.map((day, index) => ({
    ...day,
    x:padding.left + (points.length === 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1)),
    y:padding.top + chartHeight - (day.units / maxValue) * chartHeight
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
    <title>${formatDate(point.date)}: ${formatNumber(point.units)} unita</title>
  </circle>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico delle unita di allenamento">
    <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6c63ff" stop-opacity=".24"/><stop offset="100%" stop-color="#6c63ff" stop-opacity=".02"/></linearGradient></defs>
    ${grid}<polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${line}"/>${dots}${dateLabels}
  </svg>`;
}

function rpeTrendChart(days) {
  const points = [...days]
    .reverse()
    .map((day) => ({ ...day, rpeValue:dayRpeValue(day) }))
    .filter((day) => day.rpeValue !== null)
    .slice(-12);
  if (!points.length) return `<div class="empty">Il grafico RPE comparira dopo la prima risposta.</div>`;
  const width = 760;
  const height = 230;
  const padding = { left:45, right:20, top:25, bottom:38 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const coordinates = points.map((day, index) => ({
    ...day,
    x:padding.left + (points.length === 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1)),
    y:padding.top + chartHeight - (day.rpeValue / 10) * chartHeight
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${coordinates[0].x},${padding.top + chartHeight} ${line} ${coordinates.at(-1).x},${padding.top + chartHeight}`;
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const y = padding.top + chartHeight * ratio;
    const value = 10 * (1 - ratio);
    return `<line class="chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/>
      <text class="chart-label" x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${formatNumber(value)}</text>`;
  }).join("");
  const dateLabels = coordinates.map((point, index) => {
    if (points.length > 7 && index % 2 && index !== points.length - 1) return "";
    const label = new Intl.DateTimeFormat("it-IT", { day:"2-digit", month:"2-digit" }).format(new Date(`${point.date}T12:00:00`));
    return `<text class="chart-label" x="${point.x}" y="${height - 12}" text-anchor="middle">${label}</text>`;
  }).join("");
  const dots = coordinates.map((point) => `<circle class="chart-dot rpe-chart-dot" cx="${point.x}" cy="${point.y}" r="5">
    <title>${formatDate(point.date)}: RPE ${formatNumber(point.rpeValue)}</title>
  </circle>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico RPE nel tempo">
    <defs><linearGradient id="rpeChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#16a36f" stop-opacity=".24"/><stop offset="100%" stop-color="#16a36f" stop-opacity=".02"/></linearGradient></defs>
    ${grid}<polygon class="chart-area rpe-chart-area" points="${area}"/><polyline class="chart-line rpe-chart-line" points="${line}"/>${dots}${dateLabels}
  </svg>`;
}

async function load() {
  state.data = await request("/api/dashboard");
  for (const item of state.data.catalog || []) {
    if (item.body_area === "Schiena") item.body_area = "Dorso";
  }
  for (const workout of state.data.workouts || []) {
    workout.operator = workout.operator || workout.trainer || "";
    for (const exercise of workout.exercises || []) {
      if (exercise.body_area === "Schiena") exercise.body_area = "Dorso";
      exercise.phase = exercise.phase || "main";
      exercise.seconds = Number(exercise.seconds || 0);
    }
  }
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

function phaseList(phase) {
  return $(`[data-phase-list="${phaseLabels[phase] ? phase : "main"}"]`);
}

function addExercise(defaults = {}) {
  const row = $("#exercise-template").content.firstElementChild.cloneNode(true);
  const phase = phaseLabels[defaults.phase] ? defaults.phase : "main";
  fillAreaSelect($(".body-area", row), defaults.bodyArea || "Petto");
  $(".phase", row).value = phase;
  updateExerciseOptions(row, defaults.name);
  $(".sets", row).value = defaults.sets || "";
  $(".reps", row).value = defaults.reps || "";
  $(".weight", row).value = defaults.weight || "";
  $(".seconds", row).value = String(defaults.seconds || 0);
  phaseList(phase).append(row);
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

function openWorkout(workout = null) {
  if (!state.data) return toast("Attendi il caricamento dei dati.");
  if (!state.data.people.length) return toast("Aggiungi prima una persona.");
  const form = $("#workout-form");
  form.reset();
  form.elements.id.value = workout?.id || "";
  form.elements.groupIds.value = "";
  form.elements.personId.value = workout?.person_id || state.data.people[0]?.id || "";
  form.elements.date.value = workout?.workout_date || new Date().toISOString().slice(0, 10);
  form.elements.duration.value = workout?.duration || 45;
  form.elements.operator.value = workout?.operator || workout?.trainer || "";
  form.elements.rpe.value = workout?.rpe || 0;
  $$("[data-phase-list]").forEach((list) => { list.innerHTML = ""; });
  const exercises = workout?.exercises?.length ? workout.exercises : [{ sets:3, reps:10, phase:"main" }];
  for (const exercise of exercises) {
    addExercise({
      bodyArea:exercise.body_area || exercise.bodyArea,
      phase:exercise.phase,
      name:exercise.name,
      sets:exercise.sets,
      reps:exercise.reps,
      weight:exercise.weight,
      seconds:exercise.seconds
    });
  }
  $("#workout-dialog").showModal();
}

function openWorkoutGroup(workoutIds) {
  const workouts = workoutIds
    .map((id) => state.data.workouts.find((item) => item.id === Number(id)))
    .filter(Boolean);
  if (!workouts.length) return toast("Allenamento non trovato.");
  const first = workouts[0];
  openWorkout({
    ...first,
    duration:workouts.reduce((sum, workout) => sum + Number(workout.duration || 0), 0),
    rpe:workouts.find((workout) => workout.rpe !== undefined && workout.rpe !== null && workout.rpe !== "")?.rpe ?? first.rpe ?? 0,
    operator:workouts.find((workout) => workout.operator || workout.trainer)?.operator || first.operator || first.trainer || "",
    exercises:workouts.flatMap((workout) => workout.exercises || [])
  });
  $("#workout-form").elements.groupIds.value = workoutIds.join(",");
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
  form.elements.phone.value = person?.phone || "";
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
  if (event.target.closest("#dashboard-new-workout")) openWorkout();
  if (event.target.closest("#new-person")) openPerson();
  if (event.target.closest("#new-catalog-exercise")) {
    if (state.data?.catalogFallback) return toast("Chiudi e riavvia FitTrack per modificare il catalogo.");
    $("#catalog-form").reset();
    $("#catalog-custom-area-wrap").classList.add("hidden");
    $("#catalog-dialog").showModal();
  }
  const personHistoryCard = event.target.closest("[data-open-person-history]");
  if (personHistoryCard && !event.target.closest("[data-edit-person]")) {
    state.historyPersonId = Number(personHistoryCard.dataset.openPersonHistory);
    switchView("history");
    renderHistory();
  }
  const personCard = event.target.closest("[data-edit-person]");
  if (personCard) {
    event.stopPropagation();
    const person = state.data.people.find((item) => item.id === Number(personCard.dataset.editPerson));
    if (person) openPerson(person);
  }
  if (event.target.matches(".close")) event.target.closest("dialog").close();
  const phaseAddButton = event.target.closest("[data-add-phase]");
  if (phaseAddButton) addExercise({ sets:3, reps:10, phase:phaseAddButton.dataset.addPhase });
  if (event.target.matches(".remove-exercise")) {
    if ($$(".exercise-row").length > 1) event.target.closest(".exercise-row").remove();
    else toast("Serve almeno un esercizio.");
  }
  const editWorkoutButton = event.target.closest("[data-edit-workout]");
  if (editWorkoutButton) {
    const workout = state.data.workouts.find((item) => item.id === Number(editWorkoutButton.dataset.editWorkout));
    if (workout) openWorkout(workout);
  }
  const editWorkoutGroupButton = event.target.closest("[data-edit-workout-group]");
  if (editWorkoutGroupButton) {
    openWorkoutGroup(editWorkoutGroupButton.dataset.editWorkoutGroup.split(",").map(Number));
  }
  const rpeWhatsappButton = event.target.closest("[data-rpe-whatsapp]");
  if (rpeWhatsappButton) {
    try {
      const data = await request(`/api/workouts/${rpeWhatsappButton.dataset.rpeWhatsapp}/rpe-link`, { method:"POST" });
      window.open(data.whatsappUrl, "_blank", "noopener");
      toast("WhatsApp aperto con il messaggio RPE.");
    } catch (error) {
      toast(error.message);
    }
  }
  const rpeWhatsappGroupButton = event.target.closest("[data-rpe-whatsapp-group]");
  if (rpeWhatsappGroupButton) {
    try {
      const workoutIds = rpeWhatsappGroupButton.dataset.rpeWhatsappGroup.split(",").map(Number).filter(Boolean);
      const data = await request("/api/workout-groups/rpe-link", {
        method:"POST",
        body:JSON.stringify({ workoutIds })
      });
      window.open(data.whatsappUrl, "_blank", "noopener");
      toast("WhatsApp aperto con il messaggio RPE della sessione.");
    } catch (error) {
      toast(error.message);
    }
  }
  const scheduleEditButton = event.target.closest("[data-edit-schedule]");
  if (scheduleEditButton) {
    const item = (state.data.schedule || []).find((entry) => entry.id === Number(scheduleEditButton.dataset.editSchedule));
    if (item) openScheduleEdit(item);
  }
  const scheduleReminderButton = event.target.closest("[data-schedule-reminder]");
  if (scheduleReminderButton) {
    const item = (state.data.schedule || []).find((entry) => entry.id === Number(scheduleReminderButton.dataset.scheduleReminder));
    if (item) {
      const text = `Ciao ${item.person_name}, ti ricordiamo l'allenamento del ${formatDate(item.scheduled_date)} alle ${item.scheduled_time} con ${item.trainer}. A presto!`;
      const url = whatsappReminderUrl(item, text);
      if (!url) return toast("Inserisci il telefono WhatsApp nella scheda della persona.");
      window.open(url, "_blank", "noopener");
      toast("WhatsApp aperto con il promemoria.");
    }
  }
  const scheduleDeleteButton = event.target.closest("[data-delete-schedule]");
  if (scheduleDeleteButton && confirm("Eliminare questo appuntamento dall'agenda?")) {
    try {
      await request(`/api/schedule/${scheduleDeleteButton.dataset.deleteSchedule}`, { method:"DELETE" });
      await load();
      toast("Appuntamento eliminato.");
    } catch (error) {
      toast(error.message);
    }
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
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-open-person-history]")) {
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
$("#people-search").addEventListener("input", (event) => {
  state.peopleSearch = event.target.value;
  render();
});
$("#schedule-date").addEventListener("change", (event) => {
  state.scheduleDate = event.target.value || new Date().toISOString().slice(0, 10);
  renderSchedule();
});
$("#schedule-cancel-edit").addEventListener("click", resetScheduleForm);
$("#catalog-form [name=bodyArea]").addEventListener("change", (event) => {
  $("#catalog-custom-area-wrap").classList.toggle("hidden", event.target.value !== "__custom__");
});
$("#schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  if (!state.data.people.length) return toast("Aggiungi prima una persona.");
  if (formElement.dataset.busy === "true") return;
  formElement.dataset.busy = "true";
  setFormBusy(formElement, true);
  const form = new FormData(formElement);
  try {
    const id = form.get("id");
    await request(id ? `/api/schedule/${id}` : "/api/schedule", {
      method:id ? "PUT" : "POST",
      body:JSON.stringify({
        personId:Number(form.get("personId")),
        trainer:form.get("trainer"),
        date:state.scheduleDate,
        time:form.get("time"),
        notes:form.get("notes")
      })
    });
    resetScheduleForm();
    await load();
    toast(id ? "Appuntamento aggiornato." : "Appuntamento aggiunto in agenda.");
  } catch (error) {
    toast(error.message);
  } finally {
    formElement.dataset.busy = "false";
    setFormBusy(formElement, false);
  }
});
$("#workout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  if (formElement.dataset.busy === "true") return;
  formElement.dataset.busy = "true";
  setFormBusy(formElement, true);
  const form = new FormData(formElement);
  const exercises = $$(".exercise-row").map((row) => ({
    phase: $(".phase", row).value,
    bodyArea: $(".body-area", row).value,
    name: $(".exercise-name", row).value === "__custom__"
      ? $(".custom-exercise", row).value
      : $(".exercise-name", row).value,
    sets: $(".sets", row).value,
    reps: $(".reps", row).value,
    weight: $(".weight", row).value,
    seconds: $(".seconds", row).value
  }));
  try {
    const id = form.get("id");
    const groupIds = String(form.get("groupIds") || "").split(",").map((item) => Number(item)).filter(Boolean);
    const url = groupIds.length ? "/api/workout-groups" : id ? `/api/workouts/${id}` : "/api/workouts";
    const method = groupIds.length || id ? "PUT" : "POST";
    await request(url, {
      method,
      body:JSON.stringify({
        personId:Number(form.get("personId")), date:form.get("date"),
        duration:Number(form.get("duration")), operator:form.get("operator"),
        rpe:Number(form.get("rpe")), notes:"", workoutIds:groupIds, exercises
      })
    });
    $("#workout-dialog").close();
    await load();
    toast(id ? "Allenamento aggiornato!" : "Allenamento salvato!");
  } catch (error) {
    toast(error.message);
  } finally {
    formElement.dataset.busy = "false";
    setFormBusy(formElement, false);
  }
});

$("#person-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  if (formElement.dataset.busy === "true") return;
  formElement.dataset.busy = "true";
  setFormBusy(formElement, true);
  const form = new FormData(formElement);
  try {
    const id = form.get("id");
    await request(id ? `/api/people/${id}` : "/api/people", {
      method:id ? "PUT" : "POST",
      body:JSON.stringify({
        name:form.get("name"), color:form.get("color"), birthDate:form.get("birthDate"),
        height:form.get("height"), weight:form.get("weight"), phone:form.get("phone"), notes:form.get("notes")
      })
    });
    $("#person-dialog").close();
    formElement.reset();
    await load();
    toast(id ? "Dati della persona aggiornati!" : "Persona aggiunta!");
  } catch (error) {
    toast(error.message);
  } finally {
    formElement.dataset.busy = "false";
    setFormBusy(formElement, false);
  }
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
  if (formElement.dataset.busy === "true") return;
  formElement.dataset.busy = "true";
  setFormBusy(formElement, true);
  const form = new FormData(formElement);
  const bodyArea = form.get("bodyArea") === "__custom__"
    ? form.get("customBodyArea")
    : form.get("bodyArea");
  try {
    await request("/api/catalog", {
      method:"POST",
      body:JSON.stringify({ bodyArea, name:form.get("name") })
    });
    $("#catalog-dialog").close();
    formElement.reset();
    $("#catalog-custom-area-wrap").classList.add("hidden");
    await load();
    switchView("catalog");
    toast("Esercizio aggiunto al catalogo!");
  } catch (error) {
    toast(error.message);
  } finally {
    formElement.dataset.busy = "false";
    setFormBusy(formElement, false);
  }
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  if (formElement.dataset.busy === "true") return;
  formElement.dataset.busy = "true";
  setFormBusy(formElement, true);
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
  } finally {
    formElement.dataset.busy = "false";
    setFormBusy(formElement, false);
  }
});

$("#logout").addEventListener("click", async () => {
  await request("/api/auth/logout", { method:"POST" });
  state.data = null;
  showLogin();
});

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function updateInstallButton() {
  const available = !isStandalone() && (Boolean(deferredInstallPrompt) || isIosDevice());
  $("#install-app").classList.toggle("hidden", !available);
}

function applyDeviceMode() {
  document.documentElement.classList.toggle("app-standalone", isStandalone());
  document.documentElement.classList.toggle("device-ios", isIosDevice());
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  toast("FitTrack installata!");
});

$("#install-app").addEventListener("click", async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallButton();
    return;
  }
  $("#install-dialog").showModal();
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
applyDeviceMode();
updateInstallButton();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.update().catch(() => {});
    }).catch(() => {
      console.warn("Installazione PWA non disponibile.");
    });
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (sessionStorage.getItem("fittrack-sw-reloaded-v31")) return;
    sessionStorage.setItem("fittrack-sw-reloaded-v31", "1");
    window.location.reload();
  });
}

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
