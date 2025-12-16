"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import StatusBadge from "../../components/admin/StatusBadge";

const addDays = (d, n) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};
const formatDate = (d) => d.toISOString().slice(0, 10);

export default function AdminPage() {
  const [isHydrated, setIsHydrated] = useState(false);
  const todayStr = useMemo(() => {
    const now = new Date();
    return formatDate(now);
  }, []);
  const nextFortnightStr = useMemo(() => {
    const now = new Date();
    return formatDate(addDays(now, 14));
  }, []);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    start: "",
    end: "",
    status: "",
    q: "",
  });
  const [stats, setStats] = useState(null);
  const [blockForm, setBlockForm] = useState({ date: "", window: "", scope: "day" });
  const [blockMessage, setBlockMessage] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [editingBlock, setEditingBlock] = useState(null);
  const [newBooking, setNewBooking] = useState({
    name: "",
    email: "",
    phone: "",
    reason: "",
    date: "",
    time: "08:00",
    type: "General",
    amount: "350",
  });
  const [newBookingMessage, setNewBookingMessage] = useState("");
  const [newBookingSlots, setNewBookingSlots] = useState({ slots: [], loading: false, error: "" });
  const [rescheduleDropdown, setRescheduleDropdown] = useState({
    id: null,
    slots: [],
    loading: false,
    error: "",
  });
  const [toast, setToast] = useState({ message: "", type: "info" });
  useEffect(() => {
    if (!toast.message) return undefined;
    const timer = setTimeout(() => setToast({ message: "", type: "info" }), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setIsHydrated(true);
    setFilters((prev) => ({
      ...prev,
      start: todayStr,
      end: nextFortnightStr,
    }));
    setBlockForm((prev) => ({ ...prev, date: todayStr }));
    setNewBooking((prev) => ({ ...prev, date: todayStr }));
  }, []);

  const fetchBookings = async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (filters.start) params.set("start", filters.start);
    if (filters.end) params.set("end", filters.end);
    if (filters.status) params.set("status", filters.status);
    if (filters.q) params.set("q", filters.q);
    try {
      params.set("stats", "1");
      const res = await fetch(`/api/admin/bookings?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load");
      setBookings(Array.isArray(data.bookings) ? data.bookings : []);
      setStats(data.stats || null);
    } catch (err) {
      setError(err.message || "Error loading bookings");
    } finally {
      setLoading(false);
    }
  };

  const fetchBlocks = async () => {
    try {
      const res = await fetch("/api/admin/blocks");
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load blocks");
      setBlocks(Array.isArray(data.blocks) ? data.blocks : []);
    } catch (err) {
      setBlockMessage(err.message || "Could not load blocks");
    }
  };

  useEffect(() => {
    fetchBookings();
    fetchBlocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNewBookingSlots = async () => {
    setNewBookingSlots({ slots: [], loading: true, error: "" });
    try {
      const res = await fetch("/api/availability");
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load availability");
      const bookingsArr = Array.isArray(data.bookings) ? data.bookings : [];
      const bookedMap = bookingsArr.reduce((acc, b) => {
        const date = normalizeDateId(b.date || b.booking_date);
        const time = normalizeTime(b.time || b.booking_time);
        const status = String(b.status || b.Status || "").toLowerCase();
        if (!date || !time || status === "cancelled") return acc;
        acc[date] = acc[date] || new Set();
        acc[date].add(time);
        return acc;
      }, {});
      const slots = generateSlots(bookedMap, data.blocks || []);
      setNewBookingSlots({ slots, loading: false, error: "" });
    } catch (err) {
      setNewBookingSlots({ slots: [], loading: false, error: err.message || "Failed to load slots" });
    }
  };

  useEffect(() => {
    loadNewBookingSlots();
  }, []);

  useEffect(() => {
    if (!newBookingSlots.slots.length) return;
    const currentDay = newBookingSlots.slots.find((s) => s.id === newBooking.date && s.times.length);
    const firstAvailable = newBookingSlots.slots.find((s) => s.times.length);
    if (!currentDay && firstAvailable) {
      setNewBooking((p) => ({ ...p, date: firstAvailable.id, time: firstAvailable.times[0] || p.time }));
      return;
    }
    if (currentDay && currentDay.times.length && !currentDay.times.includes(newBooking.time)) {
      setNewBooking((p) => ({ ...p, time: currentDay.times[0] }));
    }
  }, [newBookingSlots.slots, newBooking.date, newBooking.time]);

  const grouped = useMemo(() => {
    const map = {};
    bookings.forEach((b) => {
      const key = b.date || b.booking_date || "unknown";
      map[key] = map[key] || [];
      map[key].push(b);
    });
    return map;
  }, [bookings]);

  const counts = useMemo(() => {
    const total = bookings.length;
    const paid = bookings.filter((b) => (b.status || "").toLowerCase() === "paid").length;
    const pending = bookings.filter((b) => (b.status || "").toLowerCase() !== "paid").length;
    return { total, paid, pending };
  }, [bookings]);

  const normalizeDateId = (val) => {
    if (val instanceof Date) {
      return new Date(val.getTime() - val.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    const match = String(val || "").match(/(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : "";
  };

  const completedBookings = useMemo(
    () => bookings.filter((b) => (b.status || "").toLowerCase() === "completed"),
    [bookings]
  );

  const dateFromId = (id) => (id ? new Date(`${id}T00:00:00`) : null);
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const pastBookings = useMemo(
    () =>
      bookings.filter((b) => {
        const id = normalizeDateId(b.date || b.booking_date);
        const date = dateFromId(id);
        return date && date < startOfToday;
      }),
    [bookings, startOfToday]
  );

  const pastCompleted = useMemo(
    () => pastBookings.filter((b) => (b.status || "").toLowerCase() === "completed"),
    [pastBookings]
  );

  const completionRate = useMemo(() => {
    if (!pastBookings.length) return 0;
    return Math.round((pastCompleted.length / pastBookings.length) * 100);
  }, [pastBookings, pastCompleted]);

  const paidRate = useMemo(() => {
    const total = stats?.bookings?.total ?? counts.total;
    if (!total) return 0;
    const paid = stats?.bookings?.paid ?? counts.paid;
    return Math.round((paid / total) * 100);
  }, [stats, counts]);

  const slotsPerDay = 12; // 08:00–17:00 with 45 min slots
  const weekdaysInRange = (days) => {
    let count = 0;
    const base = new Date(startOfToday);
    for (let i = 0; i < days; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) count += 1;
    }
    return count;
  };

  const bookingsInNext = (days) =>
    bookings.filter((b) => {
      const id = normalizeDateId(b.date || b.booking_date);
      const date = dateFromId(id);
      if (!date) return false;
      const diff = date.getTime() - startOfToday.getTime();
      return diff >= 0 && diff < days * 86400000;
    }).length;

  const weekLoad = useMemo(() => {
    const capacity = weekdaysInRange(7) * slotsPerDay;
    if (!capacity) return 0;
    const count = bookingsInNext(7);
    return Math.min(100, Math.round((count / capacity) * 100));
  }, [bookings, startOfToday]);

  const capacityBuffer = useMemo(() => {
    const capacity = weekdaysInRange(14) * slotsPerDay;
    if (!capacity) return 100;
    const upcoming = bookingsInNext(14);
    return Math.max(0, 100 - Math.round((upcoming / capacity) * 100));
  }, [bookings, startOfToday]);

  const selectedNewBookingDay = newBookingSlots.slots.find((s) => s.id === newBooking.date);

  const handleInput = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  // Availability helpers for reschedule
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
  const generateSlots = (bookedMap = {}, blocked = []) => {
    const slots = [];
    const now = new Date();
    const cutoff = new Date(now.getTime() + 30 * 60000);
    for (let i = 0; i < 14; i++) {
      const date = new Date(now);
      date.setDate(now.getDate() + i);
      const dayName = date.toLocaleDateString("en-ZA", { weekday: "long" });
      if (dayName === "Saturday" || dayName === "Sunday") continue;
      const label = date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
      const times = [];
      const dateId = normalizeDateId(date);
      const start = new Date(date);
      start.setHours(8, 0, 0, 0);
      const end = new Date(date);
      end.setHours(17, 0, 0, 0);
      const slotMinutes = 45;
      while (start < end) {
        const slotStart = new Date(start);
        if (slotStart >= cutoff) {
          const hh = String(slotStart.getHours()).padStart(2, "0");
          const mm = String(slotStart.getMinutes()).padStart(2, "0");
          const timeStr = `${hh}:${mm}`;
          const isBooked = bookedMap[dateId]?.has(timeStr);
          if (!isBooked) times.push(timeStr);
        }
        start.setMinutes(start.getMinutes() + slotMinutes);
      }
      slots.push({ id: dateId, day: dayName.slice(0, 3), label, times });
    }
    return slots;
  };

  const openRescheduleDropdown = async (booking) => {
    if (rescheduleDropdown.id === booking.id) {
      setRescheduleDropdown({ id: null, slots: [], loading: false, error: "" });
      return;
    }
    setRescheduleDropdown({ id: booking.id, slots: [], loading: true, error: "" });
    try {
      const res = await fetch("/api/availability");
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load availability");
      const bookingsArr = Array.isArray(data.bookings) ? data.bookings : [];
      const bookedMap = bookingsArr.reduce((acc, b) => {
        const date = normalizeDateId(b.date || b.booking_date);
        const time = normalizeTime(b.time || b.booking_time);
        const status = String(b.status || b.Status || "").toLowerCase();
        if (!date || !time || status === "cancelled") return acc;
        acc[date] = acc[date] || new Set();
        acc[date].add(time);
        return acc;
      }, {});
      const slots = generateSlots(bookedMap, data.blocks || []);
      setRescheduleDropdown({ id: booking.id, slots, loading: false, error: "" });
    } catch (err) {
      setRescheduleDropdown({ id: booking.id, slots: [], loading: false, error: err.message || "Failed to load slots" });
    }
  };

  const saveReschedule = async (bookingId, date, time) => {
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: bookingId,
          booking_date: date,
          booking_time: time,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Update failed");
      fetchBookings();
      setRescheduleDropdown({ id: null, slots: [], loading: false, error: "" });
      setToast({ message: "Booking updated", type: "success" });
    } catch (err) {
      alert(err.message || "Update failed");
    }
  };

  if (!isHydrated) {
    return <div className="admin-shell">Loading…</div>;
  }

  return (
    <div className="admin-shell">
      {toast.message ? <div className={`toast-float ${toast.type === "success" ? "success" : ""}`}>{toast.message}</div> : null}
      <header className="admin-header">
        <div className="welcome">
          <div className="logo-wrap">
            <Image src="/sk-logo.svg" alt="Logo" width={52} height={52} />
          </div>
          <div className="pill-soft">Admin</div>
          <h1>Welcome back, Dr Samith</h1>
          <p>Here’s a quick snapshot of your upcoming telehealth schedule.</p>
        </div>
        <button className="btn" onClick={fetchBookings} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="visual-band">
        <div className="band-copy">
          <p className="eyebrow">Schedule momentum</p>
          <h2 className="band-title">A cleaner view of the week ahead</h2>
          <div className="band-chips">
            <div className="band-chip">
              <span>Upcoming 14 days</span>
              <strong>{bookings.length}</strong>
            </div>
            <div className="band-chip">
              <span>Completed</span>
              <strong>{completedBookings.length}</strong>
            </div>
            <div className="band-chip">
              <span>Active blocks</span>
              <strong>{blocks.length}</strong>
            </div>
          </div>
        </div>
        <div className="band-visual" aria-hidden>
          <div className="orb primary"></div>
          <div className="orb secondary"></div>
          <div className="band-meter">
            <div className="band-meter-label">Week load</div>
            <div className="band-meter-bar">
              <span style={{ width: `${weekLoad}%` }} />
            </div>
            <div className="band-meter-sub">{weekLoad || 0}% of this week’s weekday capacity is booked.</div>
          </div>
        </div>
      </section>

      <section className="stats two-col">
        <div className="stat-card tall">
          <div className="stat-header">Bookings</div>
          <div className="stat-row">
            <div className="stat-label">Total</div>
            <div className="stat-value">{stats?.bookings?.total ?? counts.total}</div>
          </div>
          <div className="stat-row">
            <div className="stat-label">This month</div>
            <div className="stat-value">{stats?.bookings?.month ?? 0}</div>
          </div>
          <div className="stat-row">
            <div className="stat-label">This week</div>
            <div className="stat-value">{stats?.bookings?.week ?? 0}</div>
          </div>
          <div className="stat-row">
            <div className="stat-label">Paid</div>
            <div className="stat-value success">{stats?.bookings?.paid ?? counts.paid}</div>
          </div>
          <div className="stat-row">
            <div className="stat-label">Pending/Other</div>
            <div className="stat-value warn">{stats?.bookings?.pending ?? counts.pending}</div>
          </div>
        </div>
        <div className="stat-card tall">
          <div className="stat-header">Payments</div>
          <div className="stat-row">
            <div className="stat-label">Total</div>
            <div className="stat-value">R{stats?.payments?.total ?? 0}</div>
          </div>
          <div className="stat-row">
            <div className="stat-label">This month</div>
            <div className="stat-value">R{stats?.payments?.month ?? 0}</div>
          </div>
          <div className="stat-row">
            <div className="stat-label">This week</div>
            <div className="stat-value">R{stats?.payments?.week ?? 0}</div>
          </div>
          <div className="stat-row">
            <div className="stat-label">Today</div>
            <div className="stat-value">R{stats?.payments?.today ?? 0}</div>
          </div>
        </div>
      </section>
      {toast.message ? <div className={`alert ${toast.type === "success" ? "success" : ""}`}>{toast.message}</div> : null}

      <section className="insight-grid">
        <div className="insight-card">
          <div className="insight-top">
            <div className="insight-label">Completion rate</div>
            <div className="pill-soft">Live</div>
          </div>
          <div className="insight-value">{completionRate}%</div>
          <div className="progress">
            <span style={{ width: `${completionRate}%` }} />
          </div>
          <div className="insight-sub">Based on {stats?.bookings?.total ?? counts.total} bookings</div>
        </div>
        <div className="insight-card">
          <div className="insight-top">
            <div className="insight-label">Paid vs pending</div>
            <div className="pill-soft ghost">Cashflow</div>
          </div>
          <div className="insight-value">{paidRate}%</div>
          <div className="progress dual">
            <span className="success" style={{ width: `${paidRate}%` }} />
            <span className="muted-bar" style={{ width: `${Math.max(0, 100 - paidRate)}%` }} />
          </div>
          <div className="insight-sub">
            Paid: {stats?.bookings?.paid ?? counts.paid} · Pending: {stats?.bookings?.pending ?? counts.pending}
          </div>
        </div>
        <div className="insight-card">
          <div className="insight-top">
            <div className="insight-label">Capacity buffer</div>
            <div className="pill-soft ghost">Next 14 days</div>
          </div>
          <div className="insight-value">{capacityBuffer}%</div>
          <div className="sparkline">
            {Array.from({ length: 8 }).map((_, idx) => {
              const height = 35 + (idx * 7) % 30;
              return <span key={idx} style={{ height: `${height}%` }} />;
            })}
          </div>
          <div className="insight-sub">Room to add priority consults before the next two weeks fill up.</div>
        </div>
      </section>

      <section className="filters">
        <label>
          Start date
          <input type="date" value={filters.start} onChange={handleInput("start")} />
        </label>
        <label>
          End date
          <input type="date" value={filters.end} onChange={handleInput("end")} />
        </label>
        <label>
          Status
          <select value={filters.status} onChange={handleInput("status")}>
            <option value="">All</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="full">
          Search (name, email, phone, reason)
          <input
            type="text"
            placeholder="e.g. anxiety"
            value={filters.q}
            onChange={handleInput("q")}
            onKeyDown={(e) => e.key === "Enter" && fetchBookings()}
          />
        </label>
        <button className="btn secondary" onClick={fetchBookings} disabled={loading}>
          Apply filters
        </button>
      </section>
      <div className="status-legend">
        <div className="legend-item">
          <span className="dot paid" />
          Paid confirmed
        </div>
        <div className="legend-item">
          <span className="dot pending" />
          Pending / to-do
        </div>
        <div className="legend-item">
          <span className="dot blocked" />
          Blocked times
        </div>
      </div>

      {process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_EMBED_URL ? (
        <section className="calendar-embed">
          <div className="calendar-title">Google Calendar</div>
          <iframe
            src={process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_EMBED_URL}
            style={{ border: 0 }}
            width="100%"
            height="450"
            frameBorder="0"
            scrolling="no"
            title="Google Calendar"
          ></iframe>
        </section>
      ) : null}

      {error ? <div className="alert error">{error}</div> : null}

      <div className="calendar-wrap">
        <div className="calendar-column">
          <div className="calendar-title">Today</div>
          <div className="calendar-list">
            {bookings
              .filter((b) => b.date === todayStr || b.booking_date === todayStr)
              .sort((a, b) => (a.time || a.booking_time || "").localeCompare(b.time || b.booking_time || ""))
              .map((b) => (
                <div key={b.id} className="calendar-item">
                  <div className="time-badge">{b.time || b.booking_time}</div>
                  <div>
                    <div className="booking-name">{b.name || b.full_name}</div>
                    <div className="muted">{b.type_label}</div>
                    <div className="muted">{b.reason}</div>
                  </div>
                </div>
              ))}
            {!bookings.some((b) => b.date === todayStr || b.booking_date === todayStr) && (
              <div className="muted">No bookings today.</div>
            )}
          </div>
        </div>
        <div className="calendar-column">
          <div className="calendar-title">This week</div>
          <div className="calendar-list">
            {bookings
              .slice()
              .sort((a, b) => {
                const da = a.date || a.booking_date || "";
                const db = b.date || b.booking_date || "";
                if (da === db) {
                  return (a.time || a.booking_time || "").localeCompare(b.time || b.booking_time || "");
                }
                return da.localeCompare(db);
              })
              .map((b) => (
                <div key={`${b.id}-week`} className="calendar-item">
                  <div className="time-badge">{(b.date || b.booking_date || "").slice(5)} · {b.time || b.booking_time}</div>
                  <div>
                    <div className="booking-name">{b.name || b.full_name}</div>
                    <div className="muted">{b.type_label}</div>
                    <div className="muted">{b.reason}</div>
                  </div>
                </div>
              ))}
            {!bookings.length && <div className="muted">No bookings in range.</div>}
          </div>
        </div>
      </div>

      <div className="day-groups">
        {Object.keys(grouped)
          .sort()
          .map((day) => (
            <div key={day} className="day-card">
              <div className="day-header">
                <div>
                  <div className="day-title">{day}</div>
                  <div className="day-sub">{grouped[day].length} bookings</div>
                </div>
                <div className="pill-soft">{grouped[day][0]?.time || grouped[day][0]?.booking_time || ""}</div>
              </div>
              <div className="booking-list">
                {grouped[day].map((b) => (
                <div key={b.id} className="booking-item">
                  <div className="booking-main">
                    <div className="booking-name">{b.name || b.full_name}</div>
              <div className="booking-type">{b.type_label}</div>
              <div className="booking-reason">{b.reason}</div>
            </div>
            <div className="booking-meta">
              <div>{b.time || b.booking_time}</div>
              <StatusBadge value={b.status} />
              <a className="link" href={`mailto:${b.email}`}>{b.email}</a>
              <div className="link">{b.phone}</div>
              <a className="link" href={b.video_link || "#"} target="_blank" rel="noreferrer">
                {b.video_link ? "Meet link" : "No link"}
              </a>
              <button
                className="btn secondary small"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/admin/bookings/${b.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "completed" }),
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) throw new Error(data.message || "Update failed");
                    fetchBookings();
                    setToast({ message: "Consult marked as completed", type: "success" });
                  } catch (err) {
                    alert(err.message || "Update failed");
                  }
                }}
              >
                Mark completed
              </button>
              <div className="reschedule-inline">
                <button
                  className="btn small"
                  onClick={() => openRescheduleDropdown(b)}
                >
                    Reschedule
                  </button>
                  {rescheduleDropdown.id === b.id ? (
                    <div className="slot-pop">
                      {rescheduleDropdown.loading ? (
                        <div className="muted">Loading slots…</div>
                      ) : rescheduleDropdown.error ? (
                        <div className="alert error">{rescheduleDropdown.error}</div>
                      ) : (
                        <div className="slot-pop-body">
                          {rescheduleDropdown.slots.map((day) => (
                            <div key={day.id} className="slot-day">
                              <div className="slot-day-header">{day.day} · {day.label}</div>
                              <div className="slot-grid">
                                {day.times.map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    className="slot-pill"
                                    onClick={() => saveReschedule(b.id, day.id, t)}
                                  >
                                    {t}
                                  </button>
                                ))}
                                {!day.times.length && <div className="muted">No slots</div>}
                              </div>
                            </div>
                          ))}
                          {!rescheduleDropdown.slots.length && <div className="muted">No slots available</div>}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
            {!Object.keys(grouped).length && !loading ? <div className="muted">No bookings found.</div> : null}
      </div>

      <section className="completed-card">
        <div className="day-header">
          <div>
            <div className="day-title">Completed bookings</div>
            <div className="day-sub">{completedBookings.length} completed</div>
          </div>
        </div>
        <div className="booking-list">
          {completedBookings.map((b) => (
            <div key={b.id} className="booking-item">
              <div className="booking-main">
                <div className="booking-name">{b.name || b.full_name}</div>
                <div className="booking-type">{b.type_label}</div>
                <div className="booking-reason">{b.reason}</div>
              </div>
              <div className="booking-meta">
                <div>{b.booking_date || b.date} · {b.booking_time || b.time}</div>
                <StatusBadge value={b.status} />
                <a className="link" href={b.video_link || "#"} target="_blank" rel="noreferrer">
                  {b.video_link ? "Meet link" : "No link"}
                </a>
              </div>
            </div>
          ))}
          {!completedBookings.length && <div className="muted">No completed bookings yet.</div>}
        </div>
      </section>

      <section className="block-card">
        <div className="block-card-header">
          <div>
            <div className="block-title">Availability blocks</div>
            <div className="muted">Set days or time windows you’re unavailable. Existing blocks shown below.</div>
          </div>
        </div>
        <div className="block-form">
          <label>
            Date
            <input
              type="date"
              value={blockForm.date}
              onChange={(e) => setBlockForm((p) => ({ ...p, date: e.target.value }))}
            />
          </label>
          <label>
            Scope
            <select value={blockForm.scope} onChange={(e) => setBlockForm((p) => ({ ...p, scope: e.target.value }))}>
              <option value="day">Day</option>
              <option value="slot">Slot window</option>
              <option value="range">Range</option>
              <option value="week">Week</option>
              <option value="weekend">Weekend</option>
            </select>
          </label>
          <label className="full">
            Time window (optional, e.g., 08:00–12:00)
            <input
              type="text"
              placeholder="HH:MM–HH:MM"
              value={blockForm.window}
              onChange={(e) => setBlockForm((p) => ({ ...p, window: e.target.value }))}
            />
          </label>
          <button
            className="btn"
            onClick={async () => {
              setBlockMessage("");
              try {
                const method = editingBlock ? "PATCH" : "POST";
                const body = editingBlock ? { ...blockForm, id: editingBlock.id } : blockForm;
                const res = await fetch("/api/admin/blocks", {
                  method,
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.message || "Failed to save block");
                setBlockMessage(editingBlock ? "Block updated" : "Block saved");
                setToast({ message: editingBlock ? "Block updated" : "Block saved", type: "success" });
                setEditingBlock(null);
                fetchBlocks();
              } catch (err) {
                setBlockMessage(err.message || "Failed to save block");
                setToast({ message: err.message || "Failed to save block", type: "error" });
              }
            }}
          >
            {editingBlock ? "Update block" : "Save block"}
          </button>
          {blockMessage ? <div className="alert">{blockMessage}</div> : null}
        </div>
        <div className="block-list">
          {blocks.map((b) => (
            <div key={b.id} className="block-item">
              <div>
                <div className="block-line">{b.block_date}</div>
                <div className="muted">{b.scope}{b.block_window ? ` · ${b.block_window}` : ""}</div>
              </div>
              <div className="block-actions">
                <button
                  className="btn secondary small"
                  onClick={() => {
                    setEditingBlock(b);
                    setBlockForm({ date: b.block_date, window: b.block_window || "", scope: b.scope || "day" });
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn small"
                  onClick={async () => {
                    const res = await fetch("/api/admin/blocks", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: b.id }),
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) {
                      const msg = data.message || "Delete failed";
                      alert(msg);
                      setToast({ message: msg, type: "error" });
                    } else {
                      fetchBlocks();
                      setToast({ message: "Block deleted", type: "success" });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!blocks.length && <div className="muted">No blocks set.</div>}
        </div>
      </section>

      <section className="create-card">
        <div className="create-header">
          <div>
            <div className="block-title">Add a booking (sends email + payment link)</div>
            <div className="muted">Use this for manual bookings; patient receives confirmation email.</div>
          </div>
          <button
            className="btn secondary small"
            onClick={() => {
              setNewBooking({
                name: "",
                email: "",
                phone: "",
                reason: "",
                date: todayStr,
                time: "08:00",
                type: "General",
                amount: "350",
              });
              setNewBookingMessage("");
            }}
          >
            Reset
          </button>
        </div>
        <div className="create-form">
          <div className="full create-form-meta">
            {newBookingSlots.loading ? <div className="pill ghost">Loading availability…</div> : null}
            {newBookingSlots.error ? <div className="alert error">{newBookingSlots.error}</div> : null}
            <button className="btn secondary small" type="button" onClick={loadNewBookingSlots}>
              Refresh availability
            </button>
          </div>
          <label>
            Name
            <input value={newBooking.name} onChange={(e) => setNewBooking((p) => ({ ...p, name: e.target.value }))} />
          </label>
          <label>
            Email
            <input value={newBooking.email} onChange={(e) => setNewBooking((p) => ({ ...p, email: e.target.value }))} />
          </label>
          <label>
            Phone
            <input value={newBooking.phone} onChange={(e) => setNewBooking((p) => ({ ...p, phone: e.target.value }))} />
          </label>
          <label>
            Type
            <select value={newBooking.type} onChange={(e) => setNewBooking((p) => ({ ...p, type: e.target.value }))}>
              <option>General</option>
              <option>Mental Health</option>
              <option>Follow-up</option>
            </select>
          </label>
          <label>
            Amount (R)
            <input value={newBooking.amount} onChange={(e) => setNewBooking((p) => ({ ...p, amount: e.target.value }))} />
          </label>
          <label>
            Date
            <select
              value={newBooking.date}
              onChange={(e) => setNewBooking((p) => ({ ...p, date: e.target.value }))}
              disabled={newBookingSlots.loading || !newBookingSlots.slots.length}
            >
              {!newBookingSlots.slots.length && <option value="">No available dates</option>}
              {newBookingSlots.slots.map((day) => (
                <option key={day.id} value={day.id} disabled={!day.times.length}>
                  {day.day} · {day.label} ({day.times.length ? `${day.times.length} slots` : "no slots"})
                </option>
              ))}
            </select>
          </label>
          <label>
            Time
            <select
              value={newBooking.time}
              onChange={(e) => setNewBooking((p) => ({ ...p, time: e.target.value }))}
              disabled={!selectedNewBookingDay || !selectedNewBookingDay.times.length}
            >
              {selectedNewBookingDay?.times?.length ? (
                selectedNewBookingDay.times.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))
              ) : (
                <option value="">No times available</option>
              )}
            </select>
          </label>
          <label className="full">
            Reason / notes
            <textarea
              value={newBooking.reason}
              onChange={(e) => setNewBooking((p) => ({ ...p, reason: e.target.value }))}
              rows={2}
            />
          </label>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              setNewBookingMessage("");
              if (!newBooking.name || !newBooking.email || !newBooking.phone || !newBooking.reason || !newBooking.date || !newBooking.time) {
                setNewBookingMessage("Please fill in name, email, phone, reason, date and time.");
                return;
              }
              try {
                const res = await fetch("/api/admin/bookings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: newBooking.name,
                    email: newBooking.email,
                    phone: newBooking.phone,
                    reason: newBooking.reason,
                    date: newBooking.date,
                    time: newBooking.time,
                    type_label: newBooking.type,
                    amount: newBooking.amount,
                    status: "pending",
                  }),
                });
                const data = await res.json();
                if (!res.ok || !data?.success) throw new Error(data?.message || "Failed to add booking");
                setToast({ message: "Booking added and email sent", type: "success" });
                setNewBookingMessage(data.paymentLink ? `Payment link: ${data.paymentLink}` : "Booking created");
                fetchBookings();
              } catch (err) {
                setNewBookingMessage(err.message || "Failed to add booking");
                setToast({ message: err.message || "Failed to add booking", type: "error" });
              }
            }}
          >
            Add booking
          </button>
          {newBookingMessage ? <div className="alert">{newBookingMessage}</div> : null}
        </div>
      </section>

    </div>
  );
}
