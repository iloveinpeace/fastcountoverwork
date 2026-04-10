const STORAGE_KEY = "work-hours-calculator-records-v1";
const DAILY_LIMIT_MINUTES = 8 * 60;

const state = {
  records: loadRecords(),
};

const elements = {
  shiftForm: document.querySelector("#shiftForm"),
  quickEntryForm: document.querySelector("#quickEntryForm"),
  quickEntryInput: document.querySelector("#quickEntryInput"),
  recordId: document.querySelector("#recordId"),
  employeeName: document.querySelector("#employeeName"),
  shiftDate: document.querySelector("#shiftDate"),
  clockIn: document.querySelector("#clockIn"),
  clockOut: document.querySelector("#clockOut"),
  breakMinutes: document.querySelector("#breakMinutes"),
  notes: document.querySelector("#notes"),
  formModeBadge: document.querySelector("#formModeBadge"),
  resetFormBtn: document.querySelector("#resetFormBtn"),
  exportCsvBtn: document.querySelector("#exportCsvBtn"),
  clearAllBtn: document.querySelector("#clearAllBtn"),
  recordsTableBody: document.querySelector("#recordsTable tbody"),
  recordsEmpty: document.querySelector("#recordsEmpty"),
  summaryList: document.querySelector("#summaryList"),
  summaryEmpty: document.querySelector("#summaryEmpty"),
  totalRecords: document.querySelector("#totalRecords"),
  totalWorked: document.querySelector("#totalWorked"),
  totalOvertime: document.querySelector("#totalOvertime"),
};

bootstrap();

function bootstrap() {
  setTodayIfEmpty();
  bindEvents();
  render();
}

function bindEvents() {
  elements.shiftForm.addEventListener("submit", handleFormSubmit);
  elements.quickEntryForm.addEventListener("submit", handleQuickEntrySubmit);
  elements.resetFormBtn.addEventListener("click", () => resetForm());
  elements.exportCsvBtn.addEventListener("click", exportCsv);
  elements.clearAllBtn.addEventListener("click", clearAllRecords);
  elements.clockIn.addEventListener("input", handleTimeInput);
  elements.clockOut.addEventListener("input", handleTimeInput);
  elements.clockIn.addEventListener("blur", normalizeTimeField);
  elements.clockOut.addEventListener("blur", normalizeTimeField);
}

function handleFormSubmit(event) {
  event.preventDefault();

  const payload = collectFormData();
  if (!payload) {
    return;
  }

  saveRecord(payload);
  resetForm({ preserveEmployee: true });
}

function handleQuickEntrySubmit(event) {
  event.preventDefault();

  const payload = collectQuickEntryData();
  if (!payload) {
    return;
  }

  saveRecord(payload, { forceInsert: true });
  elements.quickEntryInput.value = "";
  resetForm({ preserveEmployee: true, preserveDate: true, preserveBreak: true });
  elements.quickEntryInput.focus();
}

function collectFormData() {
  const employee = elements.employeeName.value.trim();
  const date = elements.shiftDate.value;
  const start = normalizeFlexibleTimeInput(elements.clockIn.value);
  const end = normalizeFlexibleTimeInput(elements.clockOut.value);
  const breakMinutes = clampNumber(elements.breakMinutes.value, 0);
  const notes = elements.notes.value.trim();

  if (!date || !start || !end) {
    alert("請先填寫日期、上班時間與下班時間。");
    return null;
  }

  const totals = calculateShift(start, end, breakMinutes);
  if (!totals) {
    alert("時間格式有誤，請重新確認。");
    return null;
  }

  elements.clockIn.value = start;
  elements.clockOut.value = end;

  return {
    id: elements.recordId.value || createId(),
    employee,
    date,
    start,
    end,
    breakMinutes,
    notes,
    workMinutes: totals.workMinutes,
    overtimeMinutes: totals.overtimeMinutes,
    source: elements.recordId.value ? "manual-edit" : "manual",
  };
}

function collectQuickEntryData() {
  const raw = normalizeText(elements.quickEntryInput.value).trim();
  if (!raw) {
    alert("請先輸入快速格式，例如 0401,0900,1800。");
    return null;
  }

  const parts = raw.split(/[,\uFF0C，、;；\s]+/).filter(Boolean);
  if (parts.length < 3) {
    alert("快速輸入格式請使用 MMDD,上班,下班，例如 0401,0900,1800。");
    return null;
  }

  const referenceYear = getReferenceYearFromDate(elements.shiftDate.value);
  const date = normalizeQuickDateInput(parts[0], referenceYear);
  const start = normalizeFlexibleTimeInput(parts[1]);
  const end = normalizeFlexibleTimeInput(parts[2]);

  if (!date || !start || !end) {
    alert("快速輸入格式有誤，請使用像 0401,0900,1800 的格式。");
    return null;
  }

  const totals = calculateShift(start, end, 0);
  if (!totals) {
    alert("快速輸入的時間格式有誤，請重新確認。");
    return null;
  }

  return {
    id: createId(),
    employee: elements.employeeName.value.trim(),
    date,
    start,
    end,
    breakMinutes: 0,
    notes: "快速輸入",
    workMinutes: totals.workMinutes,
    overtimeMinutes: totals.overtimeMinutes,
    source: "quick-entry",
  };
}

function saveRecord(payload, options = {}) {
  const existingId = options.forceInsert ? "" : elements.recordId.value;
  if (existingId) {
    state.records = state.records.map((record) => (record.id === existingId ? payload : record));
  } else {
    state.records.unshift(payload);
  }

  persistRecords();
  render();
}

function calculateShift(start, end, breakMinutes) {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  let duration = endMinutes - startMinutes;
  if (duration < 0) {
    duration += 24 * 60;
  }

  duration -= breakMinutes;
  const workMinutes = Math.max(duration, 0);

  return {
    workMinutes,
    overtimeMinutes: Math.max(workMinutes - DAILY_LIMIT_MINUTES, 0),
  };
}

function parseTimeToMinutes(value) {
  const normalized = normalizeFlexibleTimeInput(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function render() {
  renderRecordsTable();
  renderSummary();
  updateTopMetrics();
}

function renderRecordsTable() {
  const sorted = [...state.records].sort((left, right) => {
    const byDate = right.date.localeCompare(left.date);
    if (byDate !== 0) {
      return byDate;
    }
    return right.start.localeCompare(left.start);
  });

  elements.recordsTableBody.innerHTML = "";
  elements.recordsEmpty.hidden = sorted.length > 0;

  sorted.forEach((record) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(getDisplayEmployeeName(record.employee))}</td>
      <td>${formatDate(record.date)}</td>
      <td>${record.start} - ${record.end}</td>
      <td>${record.breakMinutes} 分</td>
      <td>${formatMinutes(record.workMinutes)}</td>
      <td>${formatMinutes(record.overtimeMinutes)}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="secondary-btn mini-btn" data-action="edit" data-id="${record.id}">編輯</button>
          <button type="button" class="ghost-btn mini-btn" data-action="delete" data-id="${record.id}">刪除</button>
        </div>
      </td>
    `;
    elements.recordsTableBody.appendChild(row);
  });

  elements.recordsTableBody.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", handleRecordAction);
  });
}

function renderSummary() {
  const groups = buildDailyGroups();
  elements.summaryList.innerHTML = "";
  elements.summaryEmpty.hidden = groups.length > 0;

  groups.forEach((group) => {
    const item = document.createElement("article");
    item.className = "summary-item";
    item.innerHTML = `
      <header>
        <div>
          <h4>${escapeHtml(getDisplayEmployeeName(group.employee))}</h4>
          <div class="subtle">${formatDate(group.date)}</div>
          <div class="subtle">${escapeHtml(buildSummaryTimeText(group.entries))}</div>
        </div>
        <span class="badge">${group.entries.length} 筆紀錄</span>
      </header>
      <div class="summary-meta">
        <span class="chip">實際工時 ${formatMinutes(group.workMinutes)}</span>
        <span class="chip overtime">加班 ${formatMinutes(group.overtimeMinutes)}</span>
      </div>
    `;
    elements.summaryList.appendChild(item);
  });
}

function updateTopMetrics() {
  const totalWorkedMinutes = state.records.reduce((sum, record) => sum + record.workMinutes, 0);
  const groups = buildDailyGroups();
  const totalOvertimeMinutes = groups.reduce((sum, group) => sum + group.overtimeMinutes, 0);

  elements.totalRecords.textContent = String(state.records.length);
  elements.totalWorked.textContent = formatMinutes(totalWorkedMinutes);
  elements.totalOvertime.textContent = formatMinutes(totalOvertimeMinutes);
}

function buildDailyGroups() {
  const map = new Map();

  state.records.forEach((record) => {
    const employeeKey = record.employee.trim() || record.id;
    const key = `${employeeKey}__${record.date}`;
    if (!map.has(key)) {
      map.set(key, {
        employee: record.employee,
        date: record.date,
        entries: [],
        workMinutes: 0,
      });
    }

    const group = map.get(key);
    group.entries.push(record);
    group.workMinutes += record.workMinutes;
  });

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((left, right) => left.start.localeCompare(right.start)),
      overtimeMinutes: Math.max(group.workMinutes - DAILY_LIMIT_MINUTES, 0),
    }))
    .sort((left, right) => {
      const byDate = right.date.localeCompare(left.date);
      if (byDate !== 0) {
        return byDate;
      }
      return left.employee.localeCompare(right.employee, "zh-Hant");
    });
}

function buildSummaryTimeText(entries) {
  return entries.map((entry) => `${entry.start} 上班 ${entry.end} 下班`).join(" / ");
}

function handleRecordAction(event) {
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;
  const record = state.records.find((item) => item.id === id);
  if (!record) {
    return;
  }

  if (action === "edit") {
    fillForm(record);
    return;
  }

  if (action === "delete") {
    const confirmed = window.confirm(
      `確定要刪除 ${getDisplayEmployeeName(record.employee)} ${formatDate(record.date)} 的紀錄嗎？`,
    );
    if (!confirmed) {
      return;
    }

    state.records = state.records.filter((item) => item.id !== id);
    persistRecords();
    render();
  }
}

function fillForm(record) {
  elements.recordId.value = record.id;
  elements.employeeName.value = record.employee;
  elements.shiftDate.value = record.date;
  elements.clockIn.value = record.start;
  elements.clockOut.value = record.end;
  elements.breakMinutes.value = String(record.breakMinutes);
  elements.notes.value = record.notes || "";
  elements.formModeBadge.textContent = "編輯模式";
  elements.shiftForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm(options = {}) {
  const preserveEmployee = options.preserveEmployee ? elements.employeeName.value : "";
  const preserveDate = options.preserveDate ? elements.shiftDate.value : "";
  const preserveBreak = options.preserveBreak ? elements.breakMinutes.value : "0";
  const preserveNotes = options.preserveNotes ? elements.notes.value : "";

  elements.shiftForm.reset();
  elements.recordId.value = "";
  elements.formModeBadge.textContent = "新增模式";
  elements.employeeName.value = preserveEmployee;
  elements.shiftDate.value = preserveDate;
  elements.notes.value = preserveNotes;
  setTodayIfEmpty();
  elements.breakMinutes.value = preserveBreak || "0";
}

function exportCsv() {
  if (!state.records.length) {
    alert("目前沒有資料可以匯出。");
    return;
  }

  const rows = [
    ["員工", "日期", "上班時間", "下班時間", "休息分鐘", "實際工時", "加班時數", "備註"],
    ...[...state.records]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((record) => [
        record.employee,
        record.date,
        record.start,
        record.end,
        String(record.breakMinutes),
        formatMinutes(record.workMinutes),
        formatMinutes(record.overtimeMinutes),
        record.notes || "",
      ]),
  ];

  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `work-hours-${getLocalDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function clearAllRecords() {
  if (!state.records.length) {
    return;
  }

  const confirmed = window.confirm("確定要清空全部資料嗎？這會移除目前瀏覽器中的所有暫存紀錄。");
  if (!confirmed) {
    return;
  }

  state.records = [];
  persistRecords();
  render();
  resetForm();
}

function setTodayIfEmpty() {
  if (!elements.shiftDate.value) {
    elements.shiftDate.value = getLocalDateString();
  }
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to read records from storage.", error);
    return [];
  }
}

function persistRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

function normalizeText(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/／/g, "/")
    .replace(/－/g, "-")
    .replace(/\t/g, " ");
}

function normalizeQuickDateInput(value, referenceYear) {
  const cleaned = normalizeText(String(value || "")).trim();
  if (!cleaned) {
    return "";
  }

  const slashMatch = cleaned.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
  let month = 0;
  let day = 0;

  if (slashMatch) {
    month = Number(slashMatch[1]);
    day = Number(slashMatch[2]);
  } else {
    const digits = cleaned.replace(/\D/g, "");
    if (/^\d{4}$/.test(digits)) {
      month = Number(digits.slice(0, 2));
      day = Number(digits.slice(2));
    } else if (/^\d{3}$/.test(digits)) {
      month = Number(digits.slice(0, 1));
      day = Number(digits.slice(1));
    }
  }

  if (!month || !day || month > 12 || day > 31) {
    return "";
  }

  return `${referenceYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function clampNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getReferenceYearFromDate(value) {
  const match = String(value || "").match(/^(\d{4})-/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function normalizeFlexibleTimeInput(value) {
  const raw = normalizeText(String(value || "")).trim();
  if (!raw) {
    return "";
  }

  const compact = raw.replace(/\s+/g, "");
  const colonMatch = compact.match(/^(\d{1,2})[:：](\d{1,2})$/);
  if (colonMatch) {
    const hours = Number(colonMatch[1]);
    const minuteText = colonMatch[2].length === 1 ? `${colonMatch[2]}0` : colonMatch[2];
    const minutes = Number(minuteText);
    if (hours > 23 || minutes > 59) {
      return "";
    }
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  const digitsOnly = compact.replace(/\D/g, "");
  if (/^\d{3,4}$/.test(digitsOnly)) {
    const hoursText = digitsOnly.length === 3 ? digitsOnly.slice(0, 1) : digitsOnly.slice(0, 2);
    const minutesText = digitsOnly.length === 3 ? digitsOnly.slice(1) : digitsOnly.slice(2);
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    if (hours > 23 || minutes > 59) {
      return "";
    }
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return "";
}

function formatMinutes(totalMinutes) {
  const safeMinutes = Math.max(Number(totalMinutes) || 0, 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours} 小時 ${minutes} 分`;
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createId() {
  if (window.crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function handleTimeInput(event) {
  const digits = normalizeText(event.target.value).replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) {
    event.target.value = digits;
    return;
  }

  if (digits.length === 3) {
    event.target.value = `${digits.slice(0, 1)}:${digits.slice(1)}`;
    return;
  }

  event.target.value = `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function normalizeTimeField(event) {
  const normalized = normalizeFlexibleTimeInput(event.target.value);
  if (normalized) {
    event.target.value = normalized;
  }
}

function getDisplayEmployeeName(employee) {
  return employee?.trim() || "未填姓名";
}
