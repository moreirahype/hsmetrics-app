window.HSBI_CONFIG = {
  backend: "supabase",
  apiUrl: "",
  supabaseUrl: "https://szhpfircnpazmbhiuypc.supabase.co",
  supabasePublishableKey: "sb_publishable_eesxJKeMaRyIGE6Vohhghg_wqKClqfD",
  enforceSubscription: true,
  checkoutUrls: {
    start: "https://pay.cakto.com.br/h4r62s7_952771",
    pro: "https://pay.cakto.com.br/oixhyin",
    scale: "https://pay.cakto.com.br/tqkptgd"
  },
  // Backend de Web Push (repositório hsmetrics-push na Vercel).
  // Confirme a URL do deploy na Vercel; a chave pública VAPID é a mesma do .env do projeto.
  pushApiUrl: "https://hsmetrics-push.vercel.app",
  vapidPublicKey: "BIONXeSdJHmIO-KPwxP9WVO7RAbZv5FuKzJm3VeKhJ1ZJ28TURClK4QeJfVgZOCvJHDWsUMueL9ZY8ZngzFQpxI",
  metaTaxRate: 0.1383,
  rowsPerPage: 10,
  autoRefreshMinutes: 15,
  retentionDays: 730,
  currencyRates: {
    BRL: 1
  }
};
