(function () {
  "use strict";

  const data = window.HSMData;
  const form = document.getElementById("authForm");
  const email = document.getElementById("authEmail");
  const password = document.getElementById("authPassword");
  const message = document.getElementById("authMessage");
  const submit = document.getElementById("authSubmit");
  const recover = document.getElementById("authRecover");
  const authSwitch = document.getElementById("authSwitch");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");
  const activationPanel = document.getElementById("activationPanel");
  const teamActivationPanel = document.getElementById("teamActivationPanel");
  const inviteStorageKey = "hsm-pending-attendant-invite";
  let mode = "signin";

  const query = new URLSearchParams(location.search);
  const inviteFromUrl = query.get("invite");
  const hasInvite = Boolean(inviteFromUrl || localStorage.getItem(inviteStorageKey));
  if (inviteFromUrl) localStorage.setItem(inviteStorageKey, inviteFromUrl);
  if (activationPanel) activationPanel.hidden = query.get("ativacao") !== "1";
  if (teamActivationPanel) teamActivationPanel.hidden = !hasInvite;

  const redirectType = data.consumeAuthRedirect ? data.consumeAuthRedirect() : null;
  if (redirectType) setMode("set-password");

  form.addEventListener("submit", submitAuth);
  recover.addEventListener("click", recoverPassword);
  if (authSwitch) authSwitch.addEventListener("click", toggleInviteMode);
  if (!redirectType && hasInvite) setMode("signup");
  if (!redirectType) redirectExistingSession();

  function setMode(nextMode) {
    mode = nextMode === "set-password" ? "set-password" : nextMode === "signup" ? "signup" : "signin";
    const isPasswordSetup = mode === "set-password";
    const isTeamSignup = mode === "signup";
    email.closest("label").hidden = isPasswordSetup;
    email.required = !isPasswordSetup;
    password.autocomplete = isPasswordSetup || isTeamSignup ? "new-password" : "current-password";
    title.textContent = isPasswordSetup
      ? "Defina sua senha"
      : isTeamSignup
        ? "Crie seu acesso da equipe"
        : hasInvite
          ? "Entre para vincular seu acesso"
          : "Acesse seu painel";
    subtitle.textContent = isPasswordSetup
      ? "Crie uma senha para ativar seu acesso ao HS Metrics."
      : isTeamSignup
        ? "Informe seu e-mail e escolha uma senha. Depois disso, você entra direto no app da equipe."
        : hasInvite
          ? "Entre com uma conta já criada para vincular este convite."
          : "Entre com o e-mail usado na compra.";
    submit.textContent = isPasswordSetup ? "Salvar senha e entrar" : isTeamSignup ? "Criar acesso e entrar" : "Entrar";
    recover.hidden = isPasswordSetup;
    recover.textContent = "Esqueci minha senha";
    if (authSwitch) {
      authSwitch.hidden = !hasInvite || isPasswordSetup;
      authSwitch.textContent = isTeamSignup ? "Já tenho senha" : "Criar meu acesso";
    }
    if (teamActivationPanel) teamActivationPanel.hidden = !hasInvite || isPasswordSetup;
    if (activationPanel && isPasswordSetup) activationPanel.hidden = true;
    setMessage("");
  }

  function toggleInviteMode() {
    if (!hasInvite) return;
    setMode(mode === "signup" ? "signin" : "signup");
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
      } else if (mode === "signup") {
        await data.signUp(email.value.trim(), password.value);
        const session = await data.getSession();
        if (!session?.access_token) {
          setMessage("Criamos seu acesso. Se chegar um e-mail de confirmação, confirme por lá e depois entre com a senha criada.", true);
          return;
        }
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
    let inviteError = null;
    if (inviteToken) {
      // Sempre limpa o token, mesmo se falhar, para não travar logins futuros.
      localStorage.removeItem(inviteStorageKey);
      try {
        await data.acceptAttendantInvite(inviteToken);
      } catch (error) {
        inviteError = error;
        console.warn("Convite não aplicado:", error && error.message);
      }
    }
    const context = await data.getContext();
    if (inviteToken && inviteError && context.role !== "attendant") throw inviteError;
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
      await data.requestPasswordReset(email.value.trim(), location.origin + location.pathname + location.search);
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
    if (authSwitch) authSwitch.disabled = loading;
    submit.textContent = loading ? "Aguarde..." : mode === "set-password" ? "Salvar senha e entrar" : mode === "signup" ? "Criar acesso e entrar" : "Entrar";
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
    if (/user already registered|already registered|already exists/i.test(value)) {
      return "Esse e-mail já tem acesso. Clique em “Já tenho senha” e entre normalmente.";
    }
    if (/owner_cannot_be_attendant/i.test(value)) {
      return "Esse link é para a atendente. Abra com o e-mail dela, não com a conta dona do painel.";
    }
    if (/invite_invalid_or_expired/i.test(value)) {
      return "Esse link da equipe expirou ou já foi usado. Gere um novo link no painel.";
    }
    return value || "Não foi possível concluir agora.";
  }
})();
