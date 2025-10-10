// netlify/functions/content.js
export default async (req, context) => {
  const {
    GH_TOKEN,     // GitHub PAT (fine-grained)
    GH_OWNER,     // z.B. "seeglanzevent-lgtm"
    GH_REPO,      // z.B. "huette-landing"
    GH_BRANCH = "main",
    ADMIN_PASSWORD,
    ALLOWED_ORIGIN // optional: z.B. "https://deine-seite.netlify.app"
  } = process.env;

  const FILE_PATH = "content/content.json";
  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${FILE_PATH}`;

  const allowOrigin = (origin) =>
    ALLOWED_ORIGIN ? ALLOWED_ORIGIN : (origin || "*");

  const send = (status, body, headers = {}) => ({
    statusCode: status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": allowOrigin(req.headers?.origin),
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      ...headers,
    },
    body: JSON.stringify(body, null, 2),
  });

  if (req.method === "OPTIONS") return send(204, {});

  const ghFetch = (url, init = {}) =>
    fetch(url, {
      ...init,
      headers: {
        "authorization": `Bearer ${GH_TOKEN}`,
        "user-agent": "seeglanzevent-cms",
        "accept": "application/vnd.github+json",
        ...(init.headers || {}),
      },
    });

  try {
    if (req.method === "GET") {
      const r = await ghFetch(`${api}?ref=${encodeURIComponent(GH_BRANCH)}`);
      if (r.status === 404) {
        // Datei existiert noch nicht → leeres Grundobjekt
        return send(200, { content: { hero:{}, kontakt:{}, galerie:[] }, sha: null });
      }
      if (!r.ok) return send(r.status, { error: "GitHub GET failed", details: await r.text() });
      const data = await r.json();
      const content = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
      return send(200, { content, sha: data.sha });
    }

    if (req.method === "POST") {
      const body = await req.json();
      if (!body || body.password !== ADMIN_PASSWORD) return send(401, { error: "Unauthorized" });
      if (!body.content || typeof body.content !== "object") return send(400, { error: "Missing content object" });

      // aktuelle SHA besorgen (wenn nicht mitgegeben)
      let sha = body.sha ?? null;
      if (!sha) {
        const r0 = await ghFetch(`${api}?ref=${encodeURIComponent(GH_BRANCH)}`);
        if (r0.ok) sha = (await r0.json()).sha;
      }

      const newContent = JSON.stringify(body.content, null, 2);
      const payload = {
        message: `chore(cms): update content.json`,
        content: Buffer.from(newContent, "utf8").toString("base64"),
        branch: GH_BRANCH,
        ...(sha ? { sha } : {}), // sha nur senden, wenn vorhanden
      };

      const r = await ghFetch(api, { method: "PUT", body: JSON.stringify(payload) });
      if (!r.ok) return send(r.status, { error: "GitHub PUT failed", details: await r.text() });
      const d = await r.json();
      return send(200, { ok: true, commit: d.commit?.sha || null });
    }

    return send(405, { error: "Method not allowed" });
  } catch (e) {
    return send(500, { error: "Server error", details: String(e) });
  }
};
