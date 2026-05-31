create table if not exists app_users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('owner', 'cook', 'customer')),
  city text,
  country text not null default 'TR' check (country in ('TR', 'DE')),
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists cook_profiles (
  id text primary key,
  user_id text references app_users(id) on delete set null,
  name text not null,
  cuisine text not null,
  city text not null,
  bio text,
  verified boolean not null default false,
  status text not null default 'pending' check (status in ('approved', 'pending', 'rejected', 'suspended')),
  rating numeric not null default 5,
  reviews integer not null default 0,
  availability text,
  response_time text,
  created_at timestamptz not null default now()
);

create table if not exists dishes (
  id text primary key,
  cook_id text not null references cook_profiles(id) on delete cascade,
  name text not null,
  description text,
  price numeric not null check (price >= 0),
  prep_minutes integer not null default 30,
  image text,
  tags jsonb not null default '[]'::jsonb,
  available boolean not null default true,
  featured boolean not null default false
);

create table if not exists orders (
  id text primary key,
  customer_id text not null references app_users(id) on delete restrict,
  cook_id text not null references cook_profiles(id) on delete restrict,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  delivery_fee numeric not null default 0,
  service_fee numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'placed' check (status in ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled')),
  status_history jsonb not null default '[]'::jsonb,
  payment_method text not null default 'cash',
  delivery_address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  from_user_id text not null references app_users(id) on delete cascade,
  to_cook_id text references cook_profiles(id) on delete set null,
  to_user_id text references app_users(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  user_id text references app_users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  read boolean not null default false
);

create table if not exists app_sessions (
  token text primary key,
  user_id text not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id text references app_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_cook_profiles_user_id on cook_profiles(user_id);
create index if not exists idx_dishes_cook_id on dishes(cook_id);
create index if not exists idx_orders_customer_id on orders(customer_id);
create index if not exists idx_orders_cook_id on orders(cook_id);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_messages_order_id on messages(order_id);
create index if not exists idx_notifications_user_id on notifications(user_id);
create index if not exists idx_sessions_user_id on app_sessions(user_id);

alter table app_users enable row level security;
alter table cook_profiles enable row level security;
alter table dishes enable row level security;
alter table orders enable row level security;
alter table messages enable row level security;
alter table notifications enable row level security;
alter table app_sessions enable row level security;
alter table admin_audit_log enable row level security;

drop policy if exists "server can manage app_users" on app_users;
drop policy if exists "server can manage cook_profiles" on cook_profiles;
drop policy if exists "server can manage dishes" on dishes;
drop policy if exists "server can manage orders" on orders;
drop policy if exists "server can manage messages" on messages;
drop policy if exists "server can manage notifications" on notifications;
drop policy if exists "server can manage app_sessions" on app_sessions;
drop policy if exists "server can manage admin_audit_log" on admin_audit_log;

create policy "server can manage app_users" on app_users for all to service_role using (true) with check (true);
create policy "server can manage cook_profiles" on cook_profiles for all to service_role using (true) with check (true);
create policy "server can manage dishes" on dishes for all to service_role using (true) with check (true);
create policy "server can manage orders" on orders for all to service_role using (true) with check (true);
create policy "server can manage messages" on messages for all to service_role using (true) with check (true);
create policy "server can manage notifications" on notifications for all to service_role using (true) with check (true);
create policy "server can manage app_sessions" on app_sessions for all to service_role using (true) with check (true);
create policy "server can manage admin_audit_log" on admin_audit_log for all to service_role using (true) with check (true);
