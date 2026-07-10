(function () {
  "use strict";

  const data = window.HSMData;
  const form = document.getElementById("authForm");
  const email = document.getElementById("authEmail");
  const password = document.getElementById("authPassword");
  const message = document.getElementById("authMessage");
  const submit = document.getElementById("authSubmit");
  const recover = document.getElementById("authRecover");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");
  const activationPanel = document.getElementById("activationPanel");
  const inviteStorageKey = "hsm-pending-attendant-invite";
  let mode = "signin";

  const query = new URLSearchParams(location.search);
  const inviteFromUrl = query.get("invite");
  if (inviteFromUrl) localStorage.setItem(inviteStorageKey, inviteFromUrl);
  if (activationPanel) activationPanel.hidden = query.get("ativacao") !== "1";

  const redirectType = data.consumeAuthRedirect ? data.consumeAuthRedirect() : null;
  if (redirectType) setMode("set-password");

  form.addEventListener("submit", submitAuth);
  recover.addEventListener("click", recoverPassword);
  if (!redirectType) redirectExistingSession();

  function setMode(nextMode) {
    mode = nextMode === "set-password" ? "set-password" : "signin";
    const isPasswordSetup = mode === "set-password";
    email.closest("label").hidden = isPasswordSetup;
    email.required = !isPasswordSetup;
    password.autocomplete = isPasswordSetup ? "new-password" : "current-password";
    title.textContent = isPasswordSetup ? "Defina sua senha" : "Acesse seu painel";
    subtitle.textContent = isPasswordSetup
      ? "Crie uma senha para ativar seu acesso ao HS Metrics."
      : "Entre com o e-mail usado na compra.";
    submit.textContent = isPasswordSetup ? "Salvar senha e entrar" : "Entrar";
    recover.hidden = isPasswordSetup;
    if (activationPanel && isPasswordSetup) activationPanel.hidden = true;
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
    if (mode !== "set-password" && !email.validity.valid) return setMessage("Informe um e-mail válido.");
    if (password.value.length < 8) return setMessage("Use uma senha com pelo menos 8 caracteres.");
    setLoading(true);
    try {
      if (mode === "set-password") {
        await data.updatePassword(password.value);
      } else {
        await data.signIn(email.value.trim(), password.value);
      }
      await enterApp();
    } catch (error) {
      setMessage(translateError(error.message));
    } finally {
      setLoading(false);
    }
  }

  async function enterApp() {
    const inviteToken = query.get("invite") || localStorage.getItem(inviteStorageKey) || "";
    if (inviteToken) {
      // Sempre limpa o token, mesmo se falhar, para não travar logins futuros.
      localStorage.removeItem(inviteStorageKey);
      try {
        await data.acceptAttendantInvite(inviteToken);
      } catch (error) {
        // Convite inválido/expirado ou dono abrindo o próprio link não deve
        // impedir o acesso: apenas seguimos para o painel normal.
        console.warn("Convite não aplicado:", error && error.message);
      }
    }
    const context = await data.getContext();
    const next = query.get("next");
    if (next && next.startsWith("/")) {
      location.replace(next);
      return;
    }
    location.replace(context.role === "attendant" ? "./equipe/" : "./painel/");
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
      setMessage("Enviamos um link para você definir uma nova senha.", true);
    } catch (error) {
      setMessage(translateError(error.message));
    } finally {
      setLoading(false);
    }
  }

  function setLoading(loading) {
    submit.disabled = loading;
    recover.disabled = loading;
    submit.textContent = loading ? "Aguarde..." : mode === "set-password" ? "Salvar senha e entrar" : "Entrar";
    recover.textContent = loading ? "Aguarde..." : "Esqueci minha senha";
  }

  function setMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle("is-success", success);
  }

  function translateError(text) {
    const value = String(text || "");
    if (/invalid login credentials/i.test(value)) return "E-mail ou senha incorretos.";
    if (/email not confirmed/i.test(value)) return "Confirme seu e-mail antes de entrar.";
    if (/same password/i.test(value)) return "Escolha uma senha diferente da anterior.";
    if (/email rate limit exceeded/i.test(value)) {
      return "Limite temporário de envio de e-mails atingido. Aguarde alguns minutos e use apenas o link mais recente que chegar.";
    }
    return value || "Não foi possível concluir agora.";
  }
})();
