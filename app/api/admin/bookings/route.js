import { NextResponse } from "next/server";

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ success: false, message: "Missing Supabase env" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get("start");
  const endDate = searchParams.get("end");
  const status = searchParams.get("status");
  const q = searchParams.get("q");
  const includeStats = searchParams.get("stats");

  // Build query string for Supabase REST
  const filters = [];
  if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
  if (startDate) filters.push(`date=gte.${encodeURIComponent(startDate)}`);
  if (endDate) filters.push(`date=lte.${encodeURIComponent(endDate)}`);
  if (q) {
    // simple ilike filters on name/email/phone/reason
    const orParts = ["name", "email", "phone", "reason"].map(
      (field) => `${field}.ilike.%25${encodeURIComponent(q)}%25`
    );
    filters.push(`or=(${orParts.join(',')})`);
  }
  // Always include select=*, append filters if present
  const query = filters.length ? `?${filters.join("&")}&select=*` : "?select=*";

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/bookings${query}`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, message: text || "Failed to fetch" }, { status: 500 });
    }
    const data = await res.json();

    let stats = null;
    if (includeStats) {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday as 0
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 7);

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

      const within = (d, start, end) => d >= start && d < end;

      const parsed = data.map((b) => ({
        ...b,
        _dateObj: parseDate(b.date || b.booking_date),
        _amount: Number(b.amount) || 0,
      }));

      const inDay = parsed.filter((b) => b._dateObj && within(b._dateObj, startOfDay, endOfDay));
      const inWeek = parsed.filter((b) => b._dateObj && within(b._dateObj, startOfWeek, endOfWeek));
      const inMonth = parsed.filter((b) => b._dateObj && within(b._dateObj, startOfMonth, endOfMonth));

      const sum = (arr) => arr.reduce((acc, b) => acc + (b._amount || 0), 0);

      stats = {
        bookings: {
          total: parsed.length,
          month: inMonth.length,
          week: inWeek.length,
          today: inDay.length,
          pending: parsed.filter((b) => (b.status || "").toLowerCase() === "pending").length,
          paid: parsed.filter((b) => (b.status || "").toLowerCase() === "paid").length,
          completed: parsed.filter((b) => (b.status || "").toLowerCase() === "completed").length,
        },
        payments: {
          total: sum(parsed),
          month: sum(inMonth),
          week: sum(inWeek),
          today: sum(inDay),
        },
      };
    }

    return NextResponse.json({ success: true, bookings: data, stats });
  } catch (err) {
    return NextResponse.json({ success: false, message: err?.message || "Server error" }, { status: 500 });
  }
}
