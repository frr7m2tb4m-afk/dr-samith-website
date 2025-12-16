"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const feeLookup = {
  virtual_consult: { label: "Virtual consult (25 min)", amount: 350 },
  follow_up: { label: "Follow-up (15 min)", amount: 250 },
  mental_health: { label: "Mental health (40 min)", amount: 550 },
};

const today = new Date();

const normalizeTime = (val) => {
  if (val instanceof Date) {
    return `${String(val.getHours()).padStart(2, "0")}:${String(val.getMinutes()).padStart(2, "0")}`;
  }
  const match = String(val || "").trim().match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hh = String(match[1]).padStart(2, "0");
  const mm = match[2];
  return `${hh}:${mm}`;
};

const normalizeDateId = (val) => {
  if (val instanceof Date) {
    return new Date(val.getTime() - val.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }
  const match = String(val || "").match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const formatDisplayDate = (val) => {
  const date = typeof val === "string" ? new Date(val) : val;
  return date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
};

const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

const generateBaseDates = (days = 21) => {
  const res = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    if (isWeekend(date)) continue;
    res.push(date);
  }
  return res;
};

const useAvailability = () => {
  const [slots, setSlots] = useState([]);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    let cancelled = false;
    const fetchAvailability = async () => {
      setStatus("loading");
      try {
        const res = await fetch("/api/availability");
        if (!res.ok) throw new Error("Failed to load availability");
        const { bookings = [], blocks = [] } = await res.json();
        const bookedMap = bookings.reduce((acc, b) => {
          const date = normalizeDateId(b.date || b.Date);
          const time = normalizeTime(b.time || b.Time);
          const status = String(b.status || b.Status || "").toLowerCase();
          if (!date || !time || status === "cancelled") return acc;
          acc[date] = acc[date] || new Set();
          acc[date].add(time);
          return acc;
        }, {});

        const isDateInRange = (dateId, blockDateStr) => {
          if (!blockDateStr) return false;
          if (blockDateStr.includes("to")) {
            const [startStr, endStr] = blockDateStr.split("to").map((s) => s.trim());
            const startId = normalizeDateId(startStr);
            const endId = normalizeDateId(endStr);
            if (!startId || !endId) return false;
            return dateId >= startId && dateId <= endId;
          }
          if (blockDateStr.includes("&")) {
            return blockDateStr.split("&").map((s) => normalizeDateId(s.trim())).includes(dateId);
          }
          return normalizeDateId(blockDateStr) === dateId;
        };

        const isDayBlocked = (dateId) =>
          blocks.some((b) => {
            const scope = String(b.scope || b.Scope || "").toLowerCase();
            const blockDate = b.block_date || b.Date || b.date;
            return (
              isDateInRange(dateId, blockDate) &&
              (scope === "day" || scope === "range" || scope === "week" || scope === "weekend")
            );
          });

        const isTimeBlocked = (dateId, timeStr) =>
          blocks.some((b) => {
            const scope = String(b.scope || b.Scope || "").toLowerCase();
            const window = b.block_window || b.Window || b.window || "";
            const blockDate = b.block_date || b.Date || b.date;
            if (!isDateInRange(dateId, blockDate)) return false;
            if (scope !== "slot" && scope !== "range" && scope !== "weekend" && scope !== "week" && scope !== "day")
              return false;
            if (scope !== "slot") return false;
            const parts = window
              .split("–")
              .map((s) => s.trim())
              .filter(Boolean);
            if (parts.length !== 2) return false;
            const [start, end] = parts;
            return timeStr >= normalizeTime(start) && timeStr <= normalizeTime(end);
          });

        const baseDates = generateBaseDates();
        const allSlots = baseDates.map((date) => {
          const dateId = normalizeDateId(date);
          const dayName = date.toLocaleDateString("en-ZA", { weekday: "short" });
          const label = date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
          const dayBlocked = isDayBlocked(dateId);
          const times = [];
          const start = new Date(date);
          start.setHours(8, 0, 0, 0);
          const end = new Date(date);
          end.setHours(17, 0, 0, 0);
          const cutoff = new Date(today.getTime() + 30 * 60000);
          const slotMinutes = 45;
          while (start < end) {
            const slotStart = new Date(start);
            if (slotStart >= cutoff) {
              const timeStr = normalizeTime(slotStart);
              const isBooked = bookedMap[dateId]?.has(timeStr);
              const blockedTime = dayBlocked || isTimeBlocked(dateId, timeStr);
              if (!isBooked && !blockedTime) times.push(timeStr);
            }
            start.setMinutes(start.getMinutes() + slotMinutes);
          }
          return { id: dateId, day: dayName, label, times };
        });

        if (!cancelled) {
          setSlots(allSlots);
          setStatus("ready");
        }
      } catch (err) {
        console.error("Availability error", err);
        if (!cancelled) setStatus("error");
      }
    };

    fetchAvailability();
    return () => {
      cancelled = true;
    };
  }, []);

  return { slots, status };
};

export default function BookingForm() {
  const { slots, status } = useAvailability();
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const timeGridRef = useRef(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    notes: "",
    appointmentType: "virtual_consult",
    idNumber: "",
    consentTele: false,
    consentPopi: false,
  });
  const [submitState, setSubmitState] = useState({ state: "idle", message: "" });

  const firstAvailableDate = useMemo(() => {
    const withTimes = slots.find((s) => s.times.length);
    return withTimes?.id || null;
  }, [slots]);

  useEffect(() => {
    if (!selectedDate && firstAvailableDate) {
      setSelectedDate(firstAvailableDate);
    }
  }, [firstAvailableDate, selectedDate]);

  useEffect(() => {
    if (selectedDate) {
      const day = slots.find((s) => s.id === selectedDate);
      setSelectedTime(day?.times[0] || null);
    }
  }, [selectedDate, slots]);

  const currentDay = slots.find((s) => s.id === selectedDate);
  const selectedFee = feeLookup[form.appointmentType] || feeLookup.virtual_consult;
  const scrollToTimes = () => {
    if (typeof window === "undefined") return;
    requestAnimationFrame(() => {
      if (timeGridRef.current) {
        timeGridRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };
  const handleDateClick = (dayId, disabled) => {
    if (disabled) return;
    setSelectedDate(dayId);
    scrollToTimes();
  };

  const onInput = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime) {
      setSubmitState({ state: "error", message: "Please pick a date and time." });
      return;
    }
    if (!form.name || !form.email || !form.phone || !form.notes) {
      setSubmitState({ state: "error", message: "Please fill in all required fields." });
      return;
    }
    if (!form.consentTele || !form.consentPopi) {
      setSubmitState({ state: "error", message: "Please accept the telehealth and POPI consent." });
      return;
    }

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      reason: form.notes.trim(),
      date: selectedDate,
      time: selectedTime,
      typeLabel: selectedFee.label,
      amount: String(selectedFee.amount),
      markPaid: true,
    };

    try {
      setSubmitState({ state: "submitting", message: "Reserving your slot and creating booking…" });
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(text || "Unexpected response");
      }
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Booking failed");
      }
      setSubmitState({
        state: "success",
        message: "Booked. Payment recorded; Google Meet link will be emailed.",
      });
      setForm({
        name: "",
        email: "",
        phone: "",
        notes: "",
        appointmentType: "virtual_consult",
        idNumber: "",
        consentTele: false,
        consentPopi: false,
      });
    } catch (err) {
      console.error(err);
      setSubmitState({ state: "error", message: err.message || "Network error while creating booking" });
    }
  };

  return (
    <div className="booking-react">
      <div className="booking-grid-new">
        <div className="booking-card-new">
          <div className="step-chip">Step 1</div>
          <h3>Choose a date & time</h3>
          <p className="muted">Live availability · weekdays 08:00–17:00</p>

          {status === "loading" && <div className="pill ghost">Loading slots…</div>}
          {status === "error" && <div className="pill error">Could not load availability</div>}

          <div className="date-strip" role="listbox" aria-label="Choose a date">
            {slots.map((day) => {
              const isActive = day.id === selectedDate;
              const disabled = !day.times.length;
              return (
                <button
                  key={day.id}
                  type="button"
                  className={`date-chip ${isActive ? "is-active" : ""} ${disabled ? "is-disabled" : ""}`}
                  onClick={() => handleDateClick(day.id, disabled)}
                  disabled={disabled}
                  aria-pressed={isActive}
                >
                  <span>{day.day}</span>
                  <strong>{day.label}</strong>
                  <small>{day.times.length ? `${day.times.length} slots` : "No slots"}</small>
                </button>
              );
            })}
          </div>

          <div className="dates-times-divider" aria-hidden="true" />

          <div className="time-grid" role="listbox" aria-label="Choose a time" ref={timeGridRef}>
            {currentDay?.times?.length ? (
              currentDay.times.map((time) => {
                const isActive = selectedTime === time;
                return (
                  <button
                    key={time}
                    type="button"
                    className={`time-slot ${isActive ? "is-active" : ""}`}
                    onClick={() => setSelectedTime(time)}
                    aria-pressed={isActive}
                  >
                    <strong>{time}</strong>
                    <span>Google Meet</span>
                  </button>
                );
              })
            ) : (
              <div className="no-slots">No available times for this day.</div>
            )}
          </div>
        </div>

        <div className="booking-card-new">
          <div className="step-chip alt">Step 2</div>
          <h3>Patient details & payment</h3>
          <p className="muted">PayFast (card / instant EFT) · Confirmation + Meet link emailed</p>

          <form className="form-grid-new" onSubmit={handleSubmit}>
            <label>
              Full name*
              <input value={form.name} onChange={onInput("name")} autoComplete="name" required />
            </label>
            <label>
              Email*
              <input
                value={form.email}
                onChange={onInput("email")}
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <label>
              Mobile number*
              <input
                value={form.phone}
                onChange={onInput("phone")}
                type="tel"
                placeholder="e.g. 071 234 5678"
                required
              />
            </label>
            <label>
              Appointment type*
              <select value={form.appointmentType} onChange={onInput("appointmentType")}>
                {Object.entries(feeLookup).map(([value, meta]) => (
                  <option key={value} value={value}>{`${meta.label} — R${meta.amount}`}</option>
                ))}
              </select>
            </label>
            <label className="full">
              Notes / reason for visit*
              <textarea
                value={form.notes}
                onChange={onInput("notes")}
                placeholder="e.g. anxiety and sleep issues, blood pressure check, medication review, healthy weight plan"
                required
              />
            </label>
            <label>
              ID / Passport (optional)
              <input value={form.idNumber} onChange={onInput("idNumber")} />
            </label>

            <label className="full consent-row">
              <input type="checkbox" checked={form.consentTele} onChange={onInput("consentTele")} />
              <span>
                I consent to receive medical advice via telehealth, understand its limitations, and confirm I am in
                South Africa at the time of consultation.
              </span>
            </label>
            <label className="full consent-row">
              <input type="checkbox" checked={form.consentPopi} onChange={onInput("consentPopi")} />
              <span>
                I acknowledge the POPI Act notice: my personal and health information will be processed securely for
                care, billing, and legal purposes.
              </span>
            </label>

            <div className="summary-card-new full">
              <div className="summary-row">
                <span>Selected slot</span>
                <strong>
                  {selectedDate && selectedTime ? `${formatDisplayDate(selectedDate)} · ${selectedTime}` : "Choose a time"}
                </strong>
              </div>
              <div className="summary-row">
                <span>Appointment type</span>
                <strong>{selectedFee.label}</strong>
              </div>
              <div className="summary-row">
                <span>Fee</span>
                <strong>R{selectedFee.amount}</strong>
              </div>
              <div className="summary-row">
                <span>Payment</span>
                <strong>PayFast (card / instant EFT)</strong>
              </div>
              <div className="summary-row">
                <span>Video link</span>
                <strong>Google Meet (auto-generated)</strong>
              </div>
            </div>

            {submitState.message && (
              <div
                className={`alert ${submitState.state === "error" ? "error" : "success"}`}
                role="status"
                aria-live="polite"
              >
                {submitState.message}
              </div>
            )}

            <button
              type="submit"
              className="btn-submit wide"
              disabled={submitState.state === "submitting"}
            >
              {submitState.state === "submitting" ? "Booking…" : "Confirm, pay & book"}
            </button>
            <p className="form-disclaimer">Secure telehealth · Google Meet link auto-generated</p>
          </form>
        </div>
      </div>
    </div>
  );
}
