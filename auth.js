(function () {
  "use strict";

  const data = window.HSMData;
  const form = document.getElementById("authForm");
  const email = document.getElementById("authEmail");
  const password = document.getElementById("authPassword");
  const name = document.getElementById("authName");
  const message = document.getElementById("authMessage");
  const submit = document.getElementById("authSubmit");
  const recover = document.getElementById("authRecover");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");
  const inviteStorageKey = "hsm-pending-attendant-invite";
  let mode = "signin";

  const inviteFromUrl = new URLSearchParams(location.search).get("invite");
  if (inviteFromUrl) localStorage.setItem(inviteStorageKey, inviteFromUrl);

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.authMode));
  });
  form.addEventListener("submit", submitAuth);
  recover.addEventListener("click", recoverPassword);
  redirectExistingSession();

  function setMode(nextMode) {
    mode = nextMode === "signup" ? "signup" : "signin";
    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
      const active = button.dataset.authMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".signup-only").forEach((element) => { element.hidden = mode !== "signup"; });
    password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    title.textContent = mode === "signup" ? "Crie seu acesso" : "Acesse seu painel";
    subtitle.textContent = mode === "signup" ? "Comece a organizar sua operação em um único lugar." : "Entre para acompanhar sua operação.";
    submit.textContent = mode === "signup" ? "Criar conta" : "Entrar";
    recover.hidden = mode === "signup";
    setMessage("");
  }

  async function redirectExistingSession() {
    try {
      const session = await data.getSession();
      if (session?.access_token) await enterApp();
    } catch {
      // The form remains available when an old session cannot be restored.
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setMessage("");
    if (!email.validity.valid) return setMessage("Informe um e-mail válido.");
    if (password.value.length < 8) return setMessage("Use uma senha com pelo menos 8 caracteres.");
    setLoading(true);
    try {
      const result = mode === "signup"
        ? await data.signUp(email.value.trim(), password.value, name.value.trim())
        : await data.signIn(email.value.trim(), password.value);
      if (!result.access_token) {
        setMessage("Conta criada. Confirme o e-mail para continuar.", true);
        return;
      }
      await enterApp();
    } catch (error) {
      setMessage(translateError(error.message));
    } finally {
      setLoading(false);
    }
  }

  async function enterApp() {
    const query = new URLSearchParams(location.search);
    const inviteToken = query.get("invite") || localStorage.getItem(inviteStorageKey) || "";
    if (inviteToken) {
      await data.acceptAttendantInvite(inviteToken);
      localStorage.removeItem(inviteStorageKey);
    }
    const context = await data.getContext();
    const next = query.get("next");
    if (next && next.startsWith("/")) {
      location.replace(next);
      return;
    }
    location.replace(context.role === "attendant" ? "./k9v2m7q4/" : "./x7p4r9m2/");
  }

  async function recoverPassword() {
    if (!email.validity.valid) {
      setMessage("Informe seu e-mail primeiro.");
      email.focus();
      return;
    }
    setLoading(true);
    try {
      await data.requestPasswordReset(email.value.trim(), location.origin + location.pathname);
      setMessage("Enviamos as instruções de recuperação para seu e-mail.", true);
    } catch (error) {
      setMessage(translateError(error.message));
    } finally {
      setLoading(false);
    }
  }

  function setLoading(loading) {
    submit.disabled = loading;
    submit.textContent = loading ? "Aguarde..." : mode === "signup" ? "Criar conta" : "Entrar";
  }

  function setMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle("is-success", success);
  }

  function translateError(text) {
    const value = String(text || "");
    if (/invalid login credentials/i.test(value)) return "E-mail ou senha incorretos.";
    if (/user already registered/i.test(value)) return "Este e-mail ja possui uma conta.";
    if (/email not confirmed/i.test(value)) return "Confirme seu e-mail antes de entrar.";
    return value || "Não foi possível concluir agora.";
  }
})();
