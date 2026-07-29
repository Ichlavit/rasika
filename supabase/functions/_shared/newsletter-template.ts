type NewsletterItem = {
  title?: string;
  summary?: string;
  url?: string;
  image_url?: string;
  link_key?: string;
};

type NewsletterContent = {
  edition_label?: string;
  eyebrow?: string;
  headline?: string;
  intro?: string;
  articles?: NewsletterItem[];
  services?: NewsletterItem[];
  linkedin_url?: string;
  linkedin_link_key?: string;
};

type RenderOptions = {
  campaignKey: string;
  content: NewsletterContent;
  recipientToken?: string;
  unsubscribeUrl: string;
  siteUrl?: string;
  testMode?: boolean;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function trackedUrl(
  rawUrl: string,
  campaignKey: string,
  linkKey: string,
  recipientToken?: string,
) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("utm_source", "rasika_insights");
    url.searchParams.set("utm_medium", "email");
    url.searchParams.set("utm_campaign", campaignKey);
    url.searchParams.set("ck", linkKey);
    if (recipientToken) url.searchParams.set("rc", recipientToken);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function contentBlock(
  item: NewsletterItem,
  kind: "article" | "service",
  campaignKey: string,
  recipientToken?: string,
) {
  const url = trackedUrl(
    String(item.url || "https://www.rasika.cl/"),
    campaignKey,
    String(item.link_key || kind),
    recipientToken,
  );
  const label = kind === "article" ? "Leer artículo" : "Conocer el servicio";
  const eyebrow = kind === "article" ? "Ideas para llevar a la práctica" : "Solución Rasika";

  return `
    <tr>
      <td style="padding:0 28px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:#1e2226;border:1px solid #343a40;border-radius:8px;overflow:hidden;">
          <tr>
            <td>
              <a href="${escapeHtml(url)}" style="text-decoration:none;">
                <img src="${escapeHtml(item.image_url)}" width="584" alt="" style="display:block;width:100%;max-width:584px;height:auto;border:0;" />
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <p style="margin:0 0 10px;color:#88d6e0;font-size:12px;line-height:1.4;font-weight:700;text-transform:uppercase;">${eyebrow}</p>
              <h2 style="margin:0 0 12px;color:#ffffff;font-size:22px;line-height:1.3;font-weight:800;">${escapeHtml(item.title)}</h2>
              <p style="margin:0 0 20px;color:#c5cbd3;font-size:15px;line-height:1.7;">${escapeHtml(item.summary)}</p>
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-radius:6px;background:#5ea6b0;">
                    <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;color:#071013;text-decoration:none;font-size:14px;font-weight:800;">${label}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

export function renderNewsletterHtml(options: RenderOptions) {
  const siteUrl = (options.siteUrl || "https://www.rasika.cl").replace(/\/$/, "");
  const content = options.content || {};
  const articles = Array.isArray(content.articles) ? content.articles.slice(0, 2) : [];
  const services = Array.isArray(content.services) ? content.services.slice(0, 2) : [];
  const linkedinUrl = trackedUrl(
    String(content.linkedin_url || "https://www.linkedin.com/"),
    options.campaignKey,
    String(content.linkedin_link_key || "social-linkedin"),
    options.recipientToken,
  );
  const previewNotice = options.testMode
    ? `<tr><td style="padding:10px 28px;background:#26343a;color:#bcecf2;font-size:12px;line-height:1.5;text-align:center;">Vista de prueba. No corresponde a un envío de campaña.</td></tr>`
    : "";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Rasika Insights</title>
  </head>
  <body style="margin:0;padding:0;background:#0a0c0e;color:#e5e7eb;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Ideas y soluciones para equipos de capacitación que quieren llevar la IA a la práctica.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#0a0c0e;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:separate;background:#111417;border:1px solid #2b3035;border-radius:8px;overflow:hidden;">
            ${previewNotice}
            <tr>
              <td style="padding:30px 28px 20px;border-bottom:1px solid #2b3035;">
                <a href="${siteUrl}" style="text-decoration:none;color:#ffffff;">
                  <img src="${siteUrl}/images/svg/rasika_logo.svg" width="154" alt="Rasika Producciones" style="display:block;width:154px;max-width:100%;height:auto;border:0;" />
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:40px 28px 30px;">
                <p style="margin:0 0 12px;color:#88d6e0;font-size:12px;line-height:1.4;font-weight:700;text-transform:uppercase;">${escapeHtml(content.eyebrow || "Rasika Insights")} · ${escapeHtml(content.edition_label || "Nueva edición")}</p>
                <h1 style="margin:0 0 18px;color:#ffffff;font-size:34px;line-height:1.16;font-weight:800;">${escapeHtml(content.headline || "Aprendizaje, tecnología y producción")}</h1>
                <p style="margin:0;color:#c5cbd3;font-size:17px;line-height:1.7;">${escapeHtml(content.intro)}</p>
              </td>
            </tr>
            <tr><td style="padding:0 28px 18px;"><p style="margin:0;color:#ffffff;font-size:18px;font-weight:800;">Dos lecturas seleccionadas</p></td></tr>
            ${articles.map((item) => contentBlock(item, "article", options.campaignKey, options.recipientToken)).join("")}
            <tr><td style="padding:12px 28px 18px;"><p style="margin:0;color:#ffffff;font-size:18px;font-weight:800;">Dos formas de llevarlo a la práctica</p></td></tr>
            ${services.map((item) => contentBlock(item, "service", options.campaignKey, options.recipientToken)).join("")}
            <tr>
              <td style="padding:8px 28px 32px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#151b1e;border:1px solid #33545a;border-radius:8px;">
                  <tr>
                    <td style="padding:26px;text-align:center;">
                      <h2 style="margin:0 0 9px;color:#ffffff;font-size:21px;line-height:1.3;">Sigamos la conversación</h2>
                      <p style="margin:0 0 20px;color:#aeb6c0;font-size:14px;line-height:1.6;">Publicamos ideas, casos y nuevas formas de diseñar experiencias de aprendizaje.</p>
                      <table role="presentation" cellspacing="0" cellpadding="0" align="center">
                        <tr><td style="border-radius:6px;background:#5ea6b0;"><a href="${escapeHtml(linkedinUrl)}" style="display:inline-block;padding:12px 18px;color:#071013;text-decoration:none;font-size:14px;font-weight:800;">Seguir a Rasika en LinkedIn</a></td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 28px;background:#0f1214;border-top:1px solid #2b3035;text-align:center;">
                <p style="margin:0 0 10px;color:#7f8995;font-size:12px;line-height:1.6;">Rasika Producciones · Santiago de Chile</p>
                <p style="margin:0;color:#7f8995;font-size:12px;line-height:1.6;">Este correo informa sobre artículos, servicios y eventos de Rasika.</p>
                <p style="margin:10px 0 0;font-size:12px;"><a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#88d6e0;text-decoration:underline;">Cancelar suscripción</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderNewsletterText(options: RenderOptions) {
  const content = options.content || {};
  const sections = [
    `${content.eyebrow || "Rasika Insights"} · ${content.edition_label || "Nueva edición"}`,
    content.headline || "Aprendizaje, tecnología y producción",
    content.intro || "",
    ...(content.articles || []).slice(0, 2).map((item) => `${item.title}\n${item.summary}\n${item.url}`),
    ...(content.services || []).slice(0, 2).map((item) => `${item.title}\n${item.summary}\n${item.url}`),
    `LinkedIn: ${content.linkedin_url || "https://www.linkedin.com/"}`,
    `Cancelar suscripción: ${options.unsubscribeUrl}`,
  ];
  return sections.filter(Boolean).join("\n\n");
}
