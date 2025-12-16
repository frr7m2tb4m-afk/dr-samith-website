import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ bookings: [], blocks: [] }, { status: 200 });
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  const [bookingsRes, blocksRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/bookings?select=*`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/blocks?select=*`, { headers }),
  ]);

  const bookings = bookingsRes.ok ? await bookingsRes.json() : [];
  const blocks = blocksRes.ok ? await blocksRes.json() : [];

  return NextResponse.json({ bookings, blocks });
}
