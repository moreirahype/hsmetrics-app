(function () {
  "use strict";

  const data = window.HSMData;
  const config = window.HSBI_CONFIG || {};
  const message = document.getElementById("subscriptionMessage");
  const signOutButton = document.getElementById("signOutButton");

  document.querySelectorAll("[data-checkout]").forEach((link) => {
    const plan = link.dataset.checkout;
    const checkoutUrl = config.checkoutUrls?.[plan];
    if (!checkoutUrl) {
      link.setAttribute("aria-disabled", "true");
      link.addEventListener("click", (event) => event.preventDefault());
      return;
    }
    link.href = checkoutUrl;
    link.target = "_blank";
    link.rel = "noopener";
  });

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      await data.signOut();
    } finally {
      location.replace("./");
    }
  });

  loadSubscription();

  async function loadSubscription() {
    try {
      const session = await data.getSession();
      if (!session?.access_token) {
        location.replace(`./?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      const context = await data.getContext();
      const subscription = context.subscription;
      if (!subscription) return;
      document.querySelector(`[data-plan="${subscription.plan}"]`)?.classList.add("is-current");
      if (subscription.status === "active") {
        message.textContent = `Seu plano ${capitalize(subscription.plan)} está ativo. Você pode trocar de plano usando o mesmo e-mail da conta.`;
      } else {
        message.textContent = "Sua assinatura ainda não está ativa. Escolha um plano e use no checkout o mesmo e-mail cadastrado no HS Metrics.";
      }
    } catch (error) {
      message.textContent = error?.message || "Não foi possível consultar sua assinatura agora.";
    }
  }

  function capitalize(value) {
    const text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
})();
