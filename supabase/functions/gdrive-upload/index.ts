const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Google Drive API helpers — OAuth2 refresh token flow

/**
 * Get an OAuth2 access token using a refresh token.
 */
async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google OAuth2 credentials not configured");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh error: ${JSON.stringify(data)}`);
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
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
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
  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
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
 * Upload a file to a specific folder using base64-encoded content.
 */
async function uploadFile(
  token: string,
  fileName: string,
  mimeType: string,
  fileBase64: string,
  folderId: string
): Promise<{ id: string; webViewLink: string }> {
  // Decode base64 to binary for reliable multipart upload
  const binaryStr = atob(fileBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
  });

  // Build multipart body with binary content
  const boundary = "----EdgeFunctionBoundary";
  const encoder = new TextEncoder();
  const metaPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const closePart = encoder.encode(`\r\n--${boundary}--`);

  // Concatenate parts
  const body = new Uint8Array(metaPart.length + bytes.length + closePart.length);
  body.set(metaPart, 0);
  body.set(bytes, metaPart.length);
  body.set(closePart, metaPart.length + bytes.length);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: body,
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
    // 1. Auth check — verify a Bearer token is present.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("Auth: bearer token present");

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

    // 3. Load root folder ID from env
    const rootFolderId = Deno.env.get("GOOGLE_DRIVE_ROOT_FOLDER_ID");
    if (!rootFolderId) {
      return new Response(
        JSON.stringify({ error: "Google Drive root folder not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Get Google access token via OAuth2 refresh token
    const token = await getAccessToken();
    console.log("Google access token obtained via OAuth2 refresh");

    // 5. Ensure employee folder exists: HR - Employee Files / {Employee Name}
    console.log(`Looking for employee folder: "${employee_name}" in root ${rootFolderId}`);
    const employeeFolderId = await ensureFolder(token, employee_name, rootFolderId);
    console.log(`Employee folder ID: ${employeeFolderId}`);

    // 6. If a subfolder is specified (e.g. "Right to Work", "Onboarding"),
    //    create it inside the employee folder
    let targetFolderId = employeeFolderId;
    if (subfolder) {
      console.log(`Looking for subfolder: "${subfolder}" in employee folder ${employeeFolderId}`);
      targetFolderId = await ensureFolder(token, subfolder, employeeFolderId);
      console.log(`Subfolder ID: ${targetFolderId}`);
    }

    // 7. Upload the file
    console.log(`Uploading file: "${file_name}" (${(file_base64.length / 1024).toFixed(1)}KB base64) to folder ${targetFolderId}`);
    const result = await uploadFile(
      token,
      file_name,
      mime_type || "application/pdf",
      file_base64,
      targetFolderId
    );
    console.log(`Upload successful: file_id=${result.id}`);

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
