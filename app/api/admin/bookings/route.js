import { NextResponse } from "next/server";
import { google } from "googleapis";

async function getRefreshToken() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  const res = await fetch(`${supabaseUrl}/rest/v1/oauth_tokens?provider=eq.google&select=refresh_token&limit=1`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.refresh_token || null;
}

async function createMeetLink({ summary, description, startISO, endISO }) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const refreshToken = await getRefreshToken();
  if (!clientId || !clientSecret || !redirectUri || !refreshToken) {
    return { link: "Google Meet (pending)", id: null };
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: startISO, timeZone: "Africa/Johannesburg" },
      end: { dateTime: endISO, timeZone: "Africa/Johannesburg" },
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
    conferenceDataVersion: 1,
  });

  const link =
    res.data?.hangoutLink ||
    res.data?.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ||
    "Google Meet (pending)";
  return { link, id: res.data?.id || null };
}

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

export async function POST(req) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ success: false, message: "Missing Supabase env" }, { status: 500 });
  }

  const { name, email, phone, reason, date, time, type_label, amount, status = "pending" } = await req.json();
  if (!name || !email || !phone || !reason || !date || !time || !type_label) {
    return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
  }

  const paymentBase = process.env.PAYMENT_LINK_BASE || process.env.NEXT_PUBLIC_PAYMENT_LINK_BASE || "";

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  try {
    // Create Meet link (attempt; graceful fallback)
    let hangoutLink = "Google Meet (pending)";
    let calendarEventId = null;
    try {
      const [hh, mm] = String(time).split(":").map(Number);
      const start = new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+02:00`);
      const end = new Date(start.getTime() + 30 * 60000);
      const meet = await createMeetLink({
        summary: `Telehealth: ${name} (${type_label})`,
        description: reason,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
      });
      hangoutLink = meet.link || hangoutLink;
      calendarEventId = meet.id;
    } catch (err) {
      console.error("Admin create meet link failed", err);
    }

    // Insert booking (pending by default)
    const res = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name,
        full_name: name,
        email,
        phone,
        reason,
        booking_date: date,
        booking_time: time,
        date,
        time,
        type_label,
        amount,
        status,
        payment_method: "Manual",
        video_link: hangoutLink,
        calendar_event_id: calendarEventId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ success: false, message: data?.message || "Create failed" }, { status: 500 });
    }
    const booking = data?.[0] || data;
    const paymentLink =
      paymentBase && booking?.id
        ? `${paymentBase}${paymentBase.includes("?") ? "&" : "?"}reference=booking-${booking.id}&amount=${encodeURIComponent(amount || "")}`
        : "";

    // Send email confirmation with payment link
    try {
      if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM && email) {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.EMAIL_FROM,
          to: email,
          subject: "Online Appointment Confirmed – Dr Samith Kalyan",
          html: `
            <p>Dear ${name},</p>
            <p>Thank you for your booking. Your online consultation with Dr Samith Kalyan has been successfully confirmed.</p>
            <p><strong>Appointment details:</strong><br/>
            🗓 Date: ${date}<br/>
            ⏰ Time: ${time}<br/>
            💻 Consultation type: ${type_label}</p>
            <p><strong>Consultation link:</strong><br/>👉 <a href="${hangoutLink}">${hangoutLink}</a></p>
            ${
              paymentLink
                ? `<p><strong>Payment link:</strong><br/>👉 <a href="${paymentLink}">${paymentLink}</a></p>`
                : ""
            }
            <p>Please join the consultation 5 minutes before your scheduled time. Ensure you have a stable internet connection and are in a quiet, private space.</p>
            <p>If you experience any difficulties or need to make changes, please contact us as soon as possible.</p>
            <p>Kind regards,<br/>Dr Samith Kalyan</p>
          `,
        });
      }
    } catch (err) {
      console.error("Admin create email failed", err);
    }

    return NextResponse.json({ success: true, booking, paymentLink });
  } catch (err) {
    return NextResponse.json({ success: false, message: err?.message || "Server error" }, { status: 500 });
  }
}
