import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64url } from "https://deno.land/std@0.208.0/encoding/base64url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Google Drive API helpers

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

/**
 * Create a signed JWT for Google service account authentication.
 */
async function createSignedJwt(sa: ServiceAccount, scopes: string[]): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  // Import the RSA private key
  const pemContents = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = base64url(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Get an OAuth2 access token using the service account JWT.
 */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const jwt = await createSignedJwt(sa, [
    "https://www.googleapis.com/auth/drive.file",
  ]);

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

/**
 * Search for a folder by name inside a parent folder.
 */
async function findFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

/**
 * Create a folder inside a parent folder.
 */
async function createFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Create folder error: ${JSON.stringify(data)}`);
  return data.id;
}

/**
 * Find or create a folder, returning its ID.
 */
async function ensureFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const existing = await findFolder(token, name, parentId);
  if (existing) return existing;
  return await createFolder(token, name, parentId);
}

/**
 * Upload a file (as bytes) to a specific folder.
 */
async function uploadFile(
  token: string,
  fileName: string,
  mimeType: string,
  fileBytes: Uint8Array,
  folderId: string
): Promise<{ id: string; webViewLink: string }> {
  // Use multipart upload
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
  });

  const boundary = "----EdgeFunctionBoundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n`;

  // Convert file bytes to base64
  const base64Data = btoa(String.fromCharCode(...fileBytes));

  const fullBody = body + base64Data + `\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: fullBody,
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(`Upload error: ${JSON.stringify(data)}`);
  return { id: data.id, webViewLink: data.webViewLink };
}

// ---- Main handler ----

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await callerClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Parse request
    const {
      employee_name,
      file_name,
      file_base64,
      mime_type,
      subfolder,
      source_app,
    } = await req.json();

    if (!employee_name || !file_name || !file_base64) {
      return new Response(
        JSON.stringify({ error: "employee_name, file_name, and file_base64 are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Load service account credentials from env
    const saJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!saJson) {
      return new Response(
        JSON.stringify({ error: "Google service account not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const sa: ServiceAccount = JSON.parse(saJson);

    const rootFolderId = Deno.env.get("GOOGLE_DRIVE_ROOT_FOLDER_ID");
    if (!rootFolderId) {
      return new Response(
        JSON.stringify({ error: "Google Drive root folder not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Get Google access token
    const token = await getAccessToken(sa);

    // 5. Ensure employee folder exists: HR - Employee Files / {Employee Name}
    const employeeFolderId = await ensureFolder(token, employee_name, rootFolderId);

    // 6. If a subfolder is specified (e.g. "Right to Work", "Training", "Contracts"),
    //    create it inside the employee folder
    let targetFolderId = employeeFolderId;
    if (subfolder) {
      targetFolderId = await ensureFolder(token, subfolder, employeeFolderId);
    }

    // 7. Upload the file
    const fileBytes = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
    const result = await uploadFile(
      token,
      file_name,
      mime_type || "application/pdf",
      fileBytes,
      targetFolderId
    );

    return new Response(
      JSON.stringify({
        success: true,
        file_id: result.id,
        web_view_link: result.webViewLink,
        employee_folder_id: employeeFolderId,
        source_app: source_app || "rtw-checker",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
