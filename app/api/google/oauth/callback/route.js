import { NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ success: false, message: "Missing code" }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!clientId || !clientSecret || !redirectUri || !supabaseUrl || !supabaseKey) {
    return NextResponse.json({ success: false, message: "Missing env" }, { status: 500 });
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens?.refresh_token) {
      return NextResponse.json({
        success: false,
        message: "No refresh_token returned. Re-run with prompt=consent",
      }, { status: 400 });
    }

    // Upsert refresh token into Supabase table oauth_tokens
    const res = await fetch(`${supabaseUrl}/rest/v1/oauth_tokens`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ provider: "google", refresh_token: tokens.refresh_token }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, message: text || "Failed to store token" }, { status: 500 });
    }

    return new NextResponse(
      `<html><body><p>Google connected. You can close this window.</p></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ success: false, message: err?.message || "OAuth error" }, { status: 500 });
  }
}
