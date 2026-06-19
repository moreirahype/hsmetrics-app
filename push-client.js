(function () {
  "use strict";

  function getConfig() {
    return Object.assign({ pushApiUrl: "", vapidPublicKey: "" }, window.HSBI_CONFIG || {});
  }

  function apiUrl(path) {
    return `${getConfig().pushApiUrl.replace(/\/$/, "")}${path}`;
  }

  function subscriptionIdKey(audience) {
    return `hsbi-push-subscription-${audience}`;
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from(Array.from(raw).map((char) => char.charCodeAt(0)));
  }

  function assertConfigured() {
    const config = getConfig();
    if (!config.pushApiUrl || !config.vapidPublicKey) {
      throw new Error("O servidor de notificações ainda não foi configurado.");
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      throw new Error("No iPhone, abra o app instalado pela Tela de Início para ativar notificações.");
    }
    return config;
  }

  async function requestPermission() {
    assertConfigured();
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      throw new Error("As notificações estão bloqueadas nos ajustes do aparelho.");
    }
    return (await Notification.requestPermission()) === "granted";
  }

  async function sync(audience, preferences) {
    const config = assertConfigured();
    if (!(await requestPermission())) throw new Error("Permissão de notificação não concedida.");
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey)
      });
    }
    const response = await fetch(apiUrl("/api/subscribe"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience, subscription: subscription.toJSON(), preferences })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível ativar as notificações.");
    localStorage.setItem(subscriptionIdKey(audience), result.id);
    return result;
  }

  async function update(audience, preferences) {
    const id = localStorage.getItem(subscriptionIdKey(audience));
    if (!id) return preferences.enabled === false ? { ok: true } : sync(audience, preferences);
    const response = await fetch(apiUrl("/api/preferences"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, preferences })
    });
    if (response.status === 404) {
      localStorage.removeItem(subscriptionIdKey(audience));
      return preferences.enabled === false ? { ok: true } : sync(audience, preferences);
    }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível atualizar as notificações.");
    return result;
  }

  async function test(audience, notification) {
    const id = localStorage.getItem(subscriptionIdKey(audience));
    if (!id) throw new Error("Ative pelo menos uma notificação antes de testar.");
    const response = await fetch(apiUrl("/api/test"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ id, audience }, notification))
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Falha ao enviar a notificação de teste.");
    return result;
  }

  window.HSBIPush = { requestPermission, sync, update, test };
})();
