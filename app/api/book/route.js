import { NextResponse } from "next/server";
import { google } from "googleapis";
import { Resend } from "resend";

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

function extractMeetLink(data) {
  return (
    data?.hangoutLink ||
    data?.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ||
    data?.htmlLink ||
    null
  );
}

async function createMeetLink({ summary, description, startISO, endISO }) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const refreshToken = await getRefreshToken();

  if (!clientId || !clientSecret || !redirectUri || !refreshToken) {
    throw new Error("Missing Google OAuth config or refresh token");
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: "v3", auth });

  const event = {
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
  };

  const res = await calendar.events.insert({
    calendarId,
    requestBody: event,
    conferenceDataVersion: 1,
  });

  return {
    link: extractMeetLink(res.data) || "Google Meet (pending)",
    id: res.data?.id || null,
  };
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !to) {
    return { sent: false, reason: "Missing Resend env or recipient" };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  });
  if (error) {
    throw new Error(error?.message || "Resend error");
  }
  return { sent: true, id: data?.id };
}

export async function POST(req) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, message: "Supabase env not set" }, { status: 500 });
    }

    const { name, email, phone, reason, date, time, typeLabel, amount } = await req.json();
    if (!name || !email || !phone || !reason || !date || !time) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    // Create Meet link (attempt; fallback if it fails)
    let hangoutLink = "Google Meet (pending)";
    let calendarEventId = null;
    try {
      const [hh, mm] = time.split(":").map(Number);
      const start = new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+02:00`);
      const end = new Date(start.getTime() + 30 * 60000);
      const meet = await createMeetLink({
        summary: `Telehealth: ${name} (${typeLabel})`,
        description: reason,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
      });
      hangoutLink = meet.link || hangoutLink;
      calendarEventId = meet.id;
    } catch (err) {
      console.error("Meet link generation failed", err);
    }

    const bookingPayload = {
      name,
      full_name: name,
      email,
      phone,
      reason,
      booking_date: date,
      booking_time: time,
      date,
      time,
      type_label: typeLabel,
      amount,
      status: "paid",
      payment_method: "PayFast",
      video_link: hangoutLink,
      calendar_event_id: calendarEventId,
    };

    const res = await fetch(`${supabaseUrl}/rest/v1/bookings`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(bookingPayload),
    });

    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      const text = await res.text();
      return NextResponse.json({ success: false, message: text || "Unknown error" }, { status: 500 });
    }
    if (!res.ok) {
      return NextResponse.json({ success: false, message: data?.message || "Booking failed" }, { status: 500 });
    }

    // Fire-and-forget email (does not block the response)
    let emailResult = { sent: false };
    try {
      emailResult = await sendEmail({
        to: email,
        subject: "Your telehealth booking is confirmed",
        html: `
          <p>Hi ${name},</p>
          <p>Your booking is confirmed.</p>
          <ul>
            <li>Date: ${date}</li>
            <li>Time: ${time}</li>
            <li>Type: ${typeLabel}</li>
            <li>Video: <a href="${hangoutLink}">${hangoutLink}</a></li>
          </ul>
          <p>Notes: ${reason}</p>
          <p>— Dr Samith Kalyan</p>
        `,
      });
    } catch (err) {
      console.error("Email send failed", err);
    }

    return NextResponse.json({ success: true, booking: data?.[0] || data, hangoutLink, emailSent: emailResult?.sent || false });
  } catch (err) {
    console.error("Booking API error", err);
    return NextResponse.json({ success: false, message: err?.message || "Unknown server error" }, { status: 500 });
  }
}
