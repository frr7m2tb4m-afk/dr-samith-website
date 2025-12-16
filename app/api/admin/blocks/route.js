import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("blocks").select("*").order("block_date", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ success: true, blocks: data || [] });
  } catch (err) {
    return NextResponse.json({ success: false, message: err?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const block_date = body.date;
    const block_window = body.window || null;
    const scope = body.scope || "day";
    if (!block_date) {
      return NextResponse.json({ success: false, message: "date is required" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("blocks").insert({ block_date, block_window, scope });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, message: err?.message || "Failed" }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json();
    const { id, date, window, scope } = body;
    if (!id) return NextResponse.json({ success: false, message: "id required" }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("blocks")
      .update({ block_date: date, block_window: window || null, scope: scope || "day" })
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, message: err?.message || "Failed" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return NextResponse.json({ success: false, message: "id required" }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("blocks").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, message: err?.message || "Failed" }, { status: 500 });
  }
}
