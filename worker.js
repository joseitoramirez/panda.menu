/**
 * Cloudflare Worker — Proxy seguro para GitHub API
 * El token vive aquí como secreto, NUNCA en el frontend.
 *
 * Variables de entorno requeridas (Cloudflare Dashboard → Settings → Variables):
 *   GH_TOKEN  → tu Personal Access Token de GitHub (tipo secreto/encriptado)
 */

const GH_REPO = "joseitoramirez/panda.menu";
const GH_FILE = "products.json";
const GH_API  = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE}`;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {

    /* Pre-flight CORS */
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    /* Solo aceptamos POST */
    if (request.method !== "POST") {
      return json({ error: "Método no permitido" }, 405);
    }

    /* Cuerpo esperado: { products: [...], message: "..." } */
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }

    const { products, message = "Actualizar menú" } = body;
    if (!Array.isArray(products)) {
      return json({ error: "products debe ser un array" }, 400);
    }

    const ghHeaders = {
      Authorization:  `token ${env.GH_TOKEN}`,
      Accept:         "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent":   "panda-menu-worker/1.0",
    };

    /* 1 — Obtener SHA actual del archivo (necesario para actualizarlo) */
    let sha;
    try {
      const r = await fetch(GH_API, { headers: ghHeaders });
      if (r.ok) {
        const d = await r.json();
        sha = d.sha;
      } else if (r.status !== 404) {
        const e = await r.json().catch(() => ({}));
        return json({ error: `GitHub SHA error ${r.status}: ${e.message || ""}` }, r.status);
      }
    } catch (e) {
      return json({ error: "No se pudo conectar con GitHub: " + e.message }, 502);
    }

    /* 2 — Guardar archivo */
    const payload = {
      message,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(products, null, 2)))),
      ...(sha ? { sha } : {}),
    };

    try {
      const r = await fetch(GH_API, {
        method:  "PUT",
        headers: ghHeaders,
        body:    JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        if (r.status === 401) return json({ error: "Token inválido (401)" }, 401);
        if (r.status === 403) return json({ error: "Sin permisos (403)" }, 403);
        if (r.status === 404) return json({ error: "Repositorio no encontrado (404)" }, 404);
        return json({ error: `GitHub ${r.status}: ${data.message || ""}` }, r.status);
      }

      return json({ ok: true, commit: data.commit?.sha }, 200);

    } catch (e) {
      return json({ error: "Error al guardar: " + e.message }, 502);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
