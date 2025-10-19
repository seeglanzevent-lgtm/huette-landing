// netlify/functions/content.js  (Runtime v2 – liefert Response)
const FILE_PATH = "content/content.json";

const json = (data, { status = 200, headers = {} } = {}, origin, ALLOWED_ORIGIN) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": ALLOWED_ORIGIN || origin || "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      ...headers,
    },
  });

const ghFetch = (url, GH_TOKEN, init = {}) =>
  fetch(url, {
    ...init,
    headers: {
      "authorization": `Bearer ${GH_TOKEN}`,
      "user-agent": "seeglanzevent-cms",
      "accept": "application/vnd.github+json",
      ...(init.headers || {}),
    },
  });

export default async (request, context) => {
  const {
    GH_TOKEN,
    GH_OWNER,
    GH_REPO,
    GH_BRANCH = "main",
    ADMIN_PASSWORD,
    ALLOWED_ORIGIN,
  } = process.env;

  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${FILE_PATH}`;
  const origin = request.headers.get("origin") || "";

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response("", {
      status: 204,
      headers: {
        "access-control-allow-origin": ALLOWED_ORIGIN || origin || "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      },
    });
  }

  try {
    if (request.method === "GET") {
      const r = await ghFetch(`${api}?ref=${encodeURIComponent(GH_BRANCH)}`, GH_TOKEN);
      if (r.status === 404) {
        return json({ content: { hero: {}, kontakt: {}, galerie: [] }, sha: null }, {}, origin, ALLOWED_ORIGIN);
      }
      if (!r.ok) return json({ error: "GitHub GET failed", details: await r.text() }, { status: r.status }, origin, ALLOWED_ORIGIN);
      const data = await r.json();
      const content = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
      return json({ content, sha: data.sha }, {}, origin, ALLOWED_ORIGIN);
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (!body || body.password !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, { status: 401 }, origin, ALLOWED_ORIGIN);
      if (!body.content || typeof body.content !== "object") return json({ error: "Missing content object" }, { status: 400 }, origin, ALLOWED_ORIGIN);

      // aktuelle SHA besorgen, falls nicht mitgeliefert
      let sha = body.sha ?? null;
      if (!sha) {
        const r0 = await ghFetch(`${api}?ref=${encodeURIComponent(GH_BRANCH)}`, GH_TOKEN);
        if (r0.ok) sha = (await r0.json()).sha;
      }

      const payload = {
        message: `chore(cms): update content.json`,
        content: Buffer.from(JSON.stringify(body.content, null, 2), "utf8").toString("base64"),
        branch: GH_BRANCH,
        ...(sha ? { sha } : {}),
      };

      const r = await ghFetch(api, GH_TOKEN, { method: "PUT", body: JSON.stringify(payload) });
      if (!r.ok) return json({ error: "GitHub PUT failed", details: await r.text() }, { status: r.status }, origin, ALLOWED_ORIGIN);
      const d = await r.json();
      return json({ ok: true, commit: d.commit?.sha || null }, {}, origin, ALLOWED_ORIGIN);
    }

    return json({ error: "Method not allowed" }, { status: 405 }, origin, ALLOWED_ORIGIN);
  } catch (e) {
    return json({ error: "Server error", details: String(e) }, { status: 500 }, origin, ALLOWED_ORIGIN);
  }
};
