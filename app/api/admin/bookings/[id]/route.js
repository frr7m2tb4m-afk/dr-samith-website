import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { Resend } from "resend";
import { google } from "googleapis";

async function getRefreshToken() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  const res = await fetch(`${supabaseUrl}/rest/v1/oauth_tokens?provider=eq.google&select=refresh_token&limit=1`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.refresh_token || null;
}

async function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const refreshToken = await getRefreshToken();
  if (!clientId || !clientSecret || !redirectUri || !refreshToken) return null;
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

async function updateCalendarEvent({ eventId, date, time, summary, description }) {
  const auth = await getOAuthClient();
  if (!auth) return { link: null, id: eventId };
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const calendar = google.calendar({ version: "v3", auth });
  const [hh, mm] = String(time || "").split(":").map(Number);
  const start = new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+02:00`);
  const end = new Date(start.getTime() + 30 * 60000);

  const body = {
    summary: summary || "Telehealth consult",
    description,
    start: { dateTime: start.toISOString(), timeZone: "Africa/Johannesburg" },
    end: { dateTime: end.toISOString(), timeZone: "Africa/Johannesburg" },
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  if (eventId) {
    const res = await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: body,
      conferenceDataVersion: 1,
    });
    const link =
      res.data?.hangoutLink ||
      res.data?.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ||
      null;
    return { link, id: res.data.id || eventId };
  }

  const res = await calendar.events.insert({
    calendarId,
    requestBody: body,
    conferenceDataVersion: 1,
  });
  const link =
    res.data?.hangoutLink || res.data?.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri || null;
  return { link, id: res.data.id };
}

async function sendUpdateEmail({ to, name, date, time, type }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !to) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject: "Updated booking details",
    html: `
      <p>Hi ${name || ""},</p>
      <p>Your booking has been updated:</p>
      <ul>
        <li>Date: ${date}</li>
        <li>Time: ${time}</li>
        <li>Type: ${type || "Consult"}</li>
      </ul>
      <p>If this time no longer works, please reply to adjust.</p>
      <p>— Dr Samith Kalyan</p>
    `,
  });
}

async function sendCompletionEmail({ to, name }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !to) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject: "Thank you for your consult today",
    html: `
      <p>Hi ${name || ""},</p>
      <p>Thank you for your consult today. I hope you had a good experience.</p>
      <p>If you have any further questions or need follow-up care, please reply to this email and I will assist.</p>
      <p>— Dr Samith Kalyan</p>
    `,
  });
}

export async function PATCH(req, { params }) {
  try {
    const body = await req.json();
    const paramId = params?.id;
    const bodyId = body?.id;
    const urlId = req?.url ? req.url.split("/").pop() : null;
    const id = paramId || bodyId || urlId;
    if (!id) return NextResponse.json({ success: false, message: "id required" }, { status: 400 });
    const { booking_date, booking_time, date, time, status } = body;
    const supabase = getSupabaseAdmin();

    const existing = await supabase
      .from("bookings")
      .select("calendar_event_id,type_label,reason,name,full_name,email,video_link")
      .eq("id", id)
      .single();

    const updateFields = {};
    if (booking_date || date) updateFields.booking_date = booking_date || date;
    if (booking_time || time) updateFields.booking_time = booking_time || time;
    if (date || booking_date) updateFields.date = booking_date || date;
    if (time || booking_time) updateFields.time = booking_time || time;
    if (status) updateFields.status = status;

    // Update calendar if we have date/time
    const shouldUpdateCalendar = (updateFields.booking_date && updateFields.booking_time) || (updateFields.date && updateFields.time);
    if (shouldUpdateCalendar) {
      const summary = `Telehealth: ${existing.data?.name || existing.data?.full_name || ""} ${existing.data?.type_label ? `(${existing.data?.type_label})` : ""}`;
      const cal = await updateCalendarEvent({
        eventId: existing.data?.calendar_event_id,
        date: updateFields.booking_date || updateFields.date,
        time: updateFields.booking_time || updateFields.time,
        summary,
        description: existing.data?.reason || "",
      });
      if (cal.link) updateFields.video_link = cal.link;
      if (cal.id) updateFields.calendar_event_id = cal.id;
    }

    const { data, error } = await supabase.from("bookings").update(updateFields).eq("id", id).select();
    if (error) throw error;
    const updated = data?.[0];
    if (updated) {
      const becameCompleted = (status || "").toLowerCase() === "completed" || (updateFields.status || "").toLowerCase() === "completed";
      if (becameCompleted) {
        await sendCompletionEmail({
          to: updated.email,
          name: updated.name || updated.full_name,
        });
      } else {
        await sendUpdateEmail({
          to: updated.email,
          name: updated.name || updated.full_name,
          date: updated.booking_date || updated.date,
          time: updated.booking_time || updated.time,
          type: updated.type_label,
        });
      }
    }
    return NextResponse.json({ success: true, booking: updated });
  } catch (err) {
    return NextResponse.json({ success: false, message: err?.message || "Failed" }, { status: 500 });
  }
}
