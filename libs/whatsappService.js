const normalizeIndianWhatsAppNumber = value => {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return `91${digits}`;
  if (/^91\d{10}$/.test(digits)) return digits;
  return null;
};

const configured = () => Boolean(
  process.env.WHATSAPP_ACCESS_TOKEN &&
  process.env.WHATSAPP_PHONE_NUMBER_ID &&
  process.env.WHATSAPP_API_VERSION &&
  process.env.WHATSAPP_STATUS_TEMPLATE
);

export const sendOrderStatusWhatsApp = async order => {
  if (order?.whatsappOptIn !== true) {
    return { sent: false, reason: "customer_not_opted_in" };
  }

  if (!configured()) {
    return { sent: false, reason: "whatsapp_not_configured" };
  }

  const to = normalizeIndianWhatsAppNumber(order.user_phone);
  if (!to) {
    return { sent: false, reason: "invalid_customer_number" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(process.env.WHATSAPP_API_VERSION)}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template: {
            name: process.env.WHATSAPP_STATUS_TEMPLATE,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
            components: [{
              type: "body",
              parameters: [
                { type: "text", text: String(order.orderId || "") },
                { type: "text", text: String(order.status || "") },
                { type: "text", text: `INR ${Number(order.total || 0).toFixed(2)}` },
              ],
            }],
          },
        }),
        signal: controller.signal,
      }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("WhatsApp status notification failed", {
        orderId: order.orderId,
        statusCode: response.status,
        errorCode: payload?.error?.code || null,
      });
      return { sent: false, reason: "provider_rejected", statusCode: response.status };
    }

    return { sent: true, messageId: payload?.messages?.[0]?.id || null };
  } catch (error) {
    console.error("WhatsApp status notification failed", {
      orderId: order?.orderId,
      reason: error?.name === "AbortError" ? "timeout" : "network_error",
    });
    return { sent: false, reason: error?.name === "AbortError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timeout);
  }
};

export { normalizeIndianWhatsAppNumber };
