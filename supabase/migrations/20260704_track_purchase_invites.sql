alter table public.pending_entitlements
  add column if not exists invitation_sent_at timestamptz;
