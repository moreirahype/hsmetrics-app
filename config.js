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
  affiliateInviteUrl: "https://app.cakto.com.br/affiliate/invite/4d4bbae9-5af8-458d-abda-bb4aa53bc0b9",
  pushApiUrl: "https://hsmetrics-push.vercel.app",
  vapidPublicKey: "BB_2CgUXqA5RQ96MC49un2HzvAcMPYUSmFGGm1f5ycFyBZXKYP3xlf9gy5FbZBTjzuIaQjFqhbtaX9Fl6tvC_hA",
  metaTaxRate: 0.1383,
  rowsPerPage: 10,
  autoRefreshMinutes: 15,
  retentionDays: 730,
  currencyRates: {
    BRL: 1
  }
};
