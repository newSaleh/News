/*
 * ============================================================
 *  Cloudflare Worker: مزامنة إعدادات "الملخص اليومي" بين الأجهزة
 * ============================================================
 * الصفحة (index.html) ثابتة على GitHub Pages ولا تحتوي أي توكن سرّي.
 * هذا الـ Worker هو الوسيط الوحيد الذي يحمل GitHub Token الحقيقي
 * (كسرّ محفوظ داخل Cloudflare، لا يظهر أبدًا في كود الموقع)، ويقرأ/يكتب
 * الإعدادات في Gist خاص بك على GitHub نيابة عن الصفحة.
 *
 * النشر (مرة واحدة فقط):
 *   1. ثبّت Wrangler (أداة Cloudflare سطر الأوامر):
 *        npm install -g wrangler
 *   2. سجّل الدخول بحسابك على Cloudflare (مجاني):
 *        wrangler login
 *   3. من داخل مجلد worker/ نفّذ:
 *        wrangler deploy
 *      سيعطيك رابطًا مثل: https://daily-summary-sync.YOUR-SUBDOMAIN.workers.dev
 *   4. أنشئ Gist خاص (Secret) فارغ على https://gist.github.com يحتوي ملفًا
 *      باسم daily-summary-settings.json ومحتواه {} ، وانسخ معرّف الـ Gist
 *      من رابطه (الجزء الأخير من الرابط).
 *   5. أنشئ GitHub Personal Access Token بصلاحية "gist" فقط (وليس صلاحية
 *      كاملة على مستودعاتك) من:
 *        https://github.com/settings/tokens?type=beta
 *   6. اضبط أسرار الـ Worker (لن تظهر لأحد بعد ذلك، وتُدار من Cloudflare فقط):
 *        wrangler secret put GITHUB_TOKEN     # التوكن من الخطوة 5
 *        wrangler secret put GIST_ID          # معرّف الـ Gist من الخطوة 4
 *        wrangler secret put SYNC_SECRET      # كلمة سر من اختيارك (أي نص)
 *   7. ضع رابط الـ Worker (من الخطوة 3) في index.html داخل المتغير
 *      SYNC_WORKER_URL، ونفس كلمة السر في SYNC_SECRET هناك.
 *
 * بعدها ستتزامن كل إضافة/حذف (مواضيع، مصادر، مسلسلات، تفضيل الترجمة)
 * تلقائيًا بين كل الأجهزة التي تفتح الصفحة بنفس رابط الـ Worker.
 */

const GIST_FILENAME = "daily-summary-settings.json";

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Secret",
  };
}

async function readGist(env) {
  const res = await fetch(`https://api.github.com/gists/${env.GIST_ID}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "daily-summary-sync-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const gist = await res.json();
  const file = gist.files && gist.files[GIST_FILENAME];
  return file ? file.content : "{}";
}

async function writeGist(env, content) {
  const res = await fetch(`https://api.github.com/gists/${env.GIST_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "daily-summary-sync-worker",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (request.method === "GET") {
      try {
        const content = await readGist(env);
        return new Response(content, { headers: { ...headers, "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: "تعذّر قراءة الإعدادات" }), {
          status: 502,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    }

    if (request.method === "PUT") {
      const secret = request.headers.get("X-Sync-Secret");
      if (!env.SYNC_SECRET || secret !== env.SYNC_SECRET) {
        return new Response(JSON.stringify({ error: "غير مصرّح" }), {
          status: 401,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      const body = await request.text();
      try {
        JSON.parse(body); // تحقق أن الجسم JSON صالح قبل حفظه
      } catch {
        return new Response(JSON.stringify({ error: "بيانات غير صالحة" }), {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      try {
        await writeGist(env, body);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "تعذّر حفظ الإعدادات" }), {
          status: 502,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Method not allowed", { status: 405, headers });
  },
};
