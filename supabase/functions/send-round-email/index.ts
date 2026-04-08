// Supabase Edge Function: send-round-email
// Sends a round summary email to all logged-in players after submission.
// Requires RESEND_API_KEY secret set in Supabase dashboard.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = "Lloyds Game <noreply@resend.dev>"; // Free tier uses resend.dev domain

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { round_id, summary_text, course_name, date } = await req.json();

    if (!round_id) {
      return new Response(JSON.stringify({ error: "round_id required" }), { status: 400 });
    }

    // Use service role to look up player emails
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get all players in this round who have a linked user_id
    const { data: roundPlayers } = await supabase
      .from("round_players")
      .select("user_id, display_name, final_amount")
      .eq("round_id", round_id)
      .not("user_id", "is", null);

    if (!roundPlayers || roundPlayers.length === 0) {
      return new Response(JSON.stringify({ message: "No linked players to email" }), {
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Get emails from profiles
    const userIds = roundPlayers.map((rp: any) => rp.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, display_name")
      .in("id", userIds);

    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ message: "No profiles with emails found" }), {
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Build per-player email content
    const playerAmounts: Record<string, number> = {};
    for (const rp of roundPlayers) {
      playerAmounts[rp.user_id] = rp.final_amount || 0;
    }

    // Build HTML email
    const dateStr = date ? new Date(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Today";

    let scoresHtml = "";
    for (const rp of roundPlayers) {
      const profile = profiles.find((p: any) => p.id === rp.user_id);
      const name = rp.display_name || profile?.display_name || "Player";
      const amt = rp.final_amount || 0;
      const amtColor = amt > 0 ? "#22c55e" : amt < 0 ? "#ef4444" : "#888";
      const amtStr = amt === 0 ? "Even" : amt > 0 ? `+$${amt}` : `-$${Math.abs(amt)}`;
      scoresHtml += `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:${amtColor};font-weight:700;text-align:right;">${amtStr}</td>
        </tr>`;
    }

    const htmlBody = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;background:#fff;">
        <div style="background:#1b5e20;padding:24px;text-align:center;border-radius:12px 12px 0 0;">
          <h1 style="color:white;margin:0;font-size:22px;">&#9971; Round Summary</h1>
          <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">${course_name || "Golf Course"} &mdash; ${dateStr}</p>
        </div>
        <div style="padding:20px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f5f5f5;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;color:#666;">Player</th>
                <th style="padding:8px 12px;text-align:right;font-size:12px;text-transform:uppercase;color:#666;">Result</th>
              </tr>
            </thead>
            <tbody>
              ${scoresHtml}
            </tbody>
          </table>
          ${summary_text ? `<pre style="background:#f9f9f9;padding:16px;border-radius:8px;font-size:13px;line-height:1.5;white-space:pre-wrap;margin-top:20px;border:1px solid #eee;">${summary_text}</pre>` : ""}
          <p style="text-align:center;color:#999;font-size:11px;margin-top:24px;">Sent by Lloyds Game</p>
        </div>
      </div>`;

    // Send email to each player individually
    const emailPromises = profiles
      .filter((p: any) => p.email)
      .map((p: any) => {
        const playerAmt = playerAmounts[p.id] || 0;
        const subject = playerAmt > 0
          ? `You won $${playerAmt} at ${course_name || "golf"} &#127937;`
          : playerAmt < 0
          ? `Round results: ${course_name || "golf"}`
          : `Round results: ${course_name || "golf"} - Even`;

        return fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [p.email],
            subject,
            html: htmlBody,
          }),
        });
      });

    const results = await Promise.allSettled(emailPromises);
    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return new Response(
      JSON.stringify({ sent, failed, total: profiles.length }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  } catch (err) {
    console.error("send-round-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
});
