-- My Guest: esquema inicial para Supabase
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Utilizador',
  role text not null default 'operator' check (role in ('admin','operator')),
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  venue text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  guest_name text not null,
  guest_email text,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references public.profiles(id)
);

create table if not exists public.scan_logs (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  operator text,
  result text not null check (result in ('ACEITE','RECUSADO'))
);

create index if not exists invitations_event_id_idx on public.invitations(event_id);
create index if not exists invitations_token_idx on public.invitations(token);
create index if not exists scan_logs_scanned_at_idx on public.scan_logs(scanned_at desc);

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,role)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)),'operator')
  on conflict(id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.invitations enable row level security;
alter table public.scan_logs enable row level security;

create policy "Users can read own profile" on public.profiles
for select to authenticated using (id=auth.uid());
create policy "Admins can read all profiles" on public.profiles
for select to authenticated using (public.current_user_role()='admin');

create policy "Authenticated users can view events" on public.events
for select to authenticated using (true);
create policy "Admins manage events" on public.events
for all to authenticated using (public.current_user_role()='admin')
with check (public.current_user_role()='admin');

create policy "Admins manage invitations" on public.invitations
for all to authenticated using (public.current_user_role()='admin')
with check (public.current_user_role()='admin');
create policy "Operators can read invitations for validation" on public.invitations
for select to authenticated using (public.current_user_role() in ('admin','operator'));

create policy "Admins read scan logs" on public.scan_logs
for select to authenticated using (public.current_user_role()='admin');
create policy "Authenticated users can add scan logs" on public.scan_logs
for insert to authenticated with check (public.current_user_role() in ('admin','operator'));

create or replace function public.validate_invitation(p_token uuid,p_operator text default 'Operador')
returns table(valid boolean,guest_name text,message text)
language plpgsql security definer set search_path=public
as $$
declare v_inv public.invitations%rowtype;
begin
  if auth.uid() is null or public.current_user_role() not in ('admin','operator') then
    raise exception 'Sem autorização para validar convites.';
  end if;

  select * into v_inv from public.invitations where token=p_token for update;
  if not found then
    return query select false,null::text,'Convite inválido ou não encontrado.';
    return;
  end if;

  if v_inv.used_at is not null then
    insert into public.scan_logs(invitation_id,operator,result)
    values(v_inv.id,p_operator,'RECUSADO');
    return query select false,v_inv.guest_name,'Este convite já foi utilizado.';
    return;
  end if;

  update public.invitations set used_at=now(),used_by=auth.uid() where id=v_inv.id;
  insert into public.scan_logs(invitation_id,operator,result)
  values(v_inv.id,p_operator,'ACEITE');
  return query select true,v_inv.guest_name,'Entrada autorizada.';
end;
$$;

revoke all on function public.validate_invitation(uuid,text) from public;
grant execute on function public.validate_invitation(uuid,text) to authenticated;

-- IMPORTANTE: depois de criar o primeiro utilizador em Authentication > Users,
-- promova-o a administrador executando no SQL Editor:
-- update public.profiles set role='admin', full_name='Administrador' where id='UUID_DO_UTILIZADOR';
