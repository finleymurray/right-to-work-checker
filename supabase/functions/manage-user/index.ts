import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  "https://rtw.immersivecore.network",
  "https://people.immersivecore.network",
  "https://training.immersivecore.network",
  "https://immersivecore.network",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use service role client for all server-side operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller by extracting JWT and validating via admin client
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(jwt);
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Invalid authentication", detail: authError?.message }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (profileError || callerProfile?.role !== "manager") {
      return new Response(JSON.stringify({ error: "Only managers can manage users" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, user_id, role } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prevent managers from modifying themselves
    if (user_id === caller.id) {
      return new Response(JSON.stringify({ error: "You cannot modify your own account" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_role") {
      if (!role || !["manager", "staff"].includes(role)) {
        return new Response(JSON.stringify({ error: "Role must be 'manager' or 'staff'" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update profile role
      const { error: updateError } = await adminClient
        .from("profiles")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", user_id);

      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Also update user_metadata so the trigger stays consistent
      await adminClient.auth.admin.updateUserById(user_id, {
        user_metadata: { role },
      });

      return new Response(JSON.stringify({ success: true, message: `Role updated to ${role}` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      // Nullify FK references in tables that reference auth.users(id)
      // so the cascade from auth.users deletion doesn't fail on constraints
      await adminClient.from("audit_log").update({ user_id: null }).eq("user_id", user_id);
      await adminClient.from("rtw_records").update({ created_by: null }).eq("created_by", user_id);
      await adminClient.from("deleted_records").update({ deleted_by: null }).eq("deleted_by", user_id);
      await adminClient.from("onboarding_records").update({ created_by: null }).eq("created_by", user_id);
      await adminClient.from("training_sessions").update({ trainer_id: null }).eq("trainer_id", user_id);
      await adminClient.from("training_sessions").update({ created_by: null }).eq("created_by", user_id);
      await adminClient.from("training_assessments").update({ assessor_id: null }).eq("assessor_id", user_id);
      await adminClient.from("training_assessments").update({ created_by: null }).eq("created_by", user_id);
      await adminClient.from("training_modules").update({ created_by: null }).eq("created_by", user_id);

      // Delete from auth (cascades to profiles via ON DELETE CASCADE)
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(user_id);

      if (deleteError) {
        return new Response(JSON.stringify({ error: deleteError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, message: "User deleted" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'update_role' or 'delete'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
