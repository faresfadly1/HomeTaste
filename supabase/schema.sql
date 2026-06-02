create table if not exists app_users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('owner', 'cook', 'customer', 'driver')),
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
  verification jsonb not null default '{"id":"pending","address":"pending","phone":"pending","notes":""}'::jsonb,
  status text not null default 'pending' check (status in ('approved', 'pending', 'rejected', 'suspended')),
  rating numeric not null default 5,
  reviews integer not null default 0,
  followers integer not null default 0,
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
  driver_id text references app_users(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  delivery_fee numeric not null default 0,
  service_fee numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'placed' check (status in ('placed', 'accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery', 'near_you', 'delivered', 'cancelled')),
  status_history jsonb not null default '[]'::jsonb,
  payment_method text not null default 'cash',
  payment jsonb not null default '{}'::jsonb,
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

create table if not exists meal_plans (
  id text primary key,
  cook_id text not null references cook_profiles(id) on delete cascade,
  name text not null,
  meals_per_week integer not null default 5 check (meals_per_week > 0),
  price numeric not null default 1500 check (price >= 0),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id text primary key,
  customer_id text not null references app_users(id) on delete cascade,
  cook_id text not null references cook_profiles(id) on delete restrict,
  plan_id text not null references meal_plans(id) on delete restrict,
  meals_per_week integer not null,
  price numeric not null,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  next_delivery_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  customer_id text not null references app_users(id) on delete restrict,
  cook_id text not null references cook_profiles(id) on delete restrict,
  method text not null,
  status text not null default 'held' check (status in ('held', 'released', 'refunded', 'failed')),
  gross numeric not null default 0,
  commission_rate numeric not null default 0.15,
  commission numeric not null default 0,
  cook_payout numeric not null default 0,
  provider text not null default 'manual',
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create table if not exists refunds (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  customer_id text not null references app_users(id) on delete cascade,
  reason text not null check (reason in ('not_delivered', 'spoiled', 'wrong_order', 'missing_item')),
  details text,
  status text not null default 'pending' check (status in ('pending', 'reviewed')),
  outcome text check (outcome in ('full', 'half', 'none')),
  amount numeric not null default 0,
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists social_actions (
  id text primary key,
  user_id text not null references app_users(id) on delete cascade,
  cook_id text references cook_profiles(id) on delete cascade,
  dish_id text references dishes(id) on delete cascade,
  type text not null check (type in ('follow', 'like', 'comment', 'photo')),
  text text,
  photo text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cook_profiles_user_id on cook_profiles(user_id);
create index if not exists idx_dishes_cook_id on dishes(cook_id);
create index if not exists idx_orders_customer_id on orders(customer_id);
create index if not exists idx_orders_cook_id on orders(cook_id);
create index if not exists idx_orders_driver_id on orders(driver_id);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_messages_order_id on messages(order_id);
create index if not exists idx_notifications_user_id on notifications(user_id);
create index if not exists idx_sessions_user_id on app_sessions(user_id);
create index if not exists idx_meal_plans_cook_id on meal_plans(cook_id);
create index if not exists idx_subscriptions_customer_id on subscriptions(customer_id);
create index if not exists idx_subscriptions_cook_id on subscriptions(cook_id);
create index if not exists idx_payments_order_id on payments(order_id);
create index if not exists idx_refunds_order_id on refunds(order_id);
create index if not exists idx_social_actions_cook_id on social_actions(cook_id);
create index if not exists idx_social_actions_dish_id on social_actions(dish_id);

alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check check (role in ('owner', 'cook', 'customer', 'driver'));

alter table cook_profiles add column if not exists verification jsonb not null default '{"id":"pending","address":"pending","phone":"pending","notes":""}'::jsonb;
alter table cook_profiles add column if not exists followers integer not null default 0;
alter table orders add column if not exists driver_id text references app_users(id) on delete set null;
alter table orders add column if not exists payment jsonb not null default '{}'::jsonb;
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in ('placed', 'accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery', 'near_you', 'delivered', 'cancelled'));

alter table app_users enable row level security;
alter table cook_profiles enable row level security;
alter table dishes enable row level security;
alter table orders enable row level security;
alter table messages enable row level security;
alter table notifications enable row level security;
alter table app_sessions enable row level security;
alter table admin_audit_log enable row level security;
alter table meal_plans enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table refunds enable row level security;
alter table social_actions enable row level security;

drop policy if exists "server can manage app_users" on app_users;
drop policy if exists "server can manage cook_profiles" on cook_profiles;
drop policy if exists "server can manage dishes" on dishes;
drop policy if exists "server can manage orders" on orders;
drop policy if exists "server can manage messages" on messages;
drop policy if exists "server can manage notifications" on notifications;
drop policy if exists "server can manage app_sessions" on app_sessions;
drop policy if exists "server can manage admin_audit_log" on admin_audit_log;
drop policy if exists "server can manage meal_plans" on meal_plans;
drop policy if exists "server can manage subscriptions" on subscriptions;
drop policy if exists "server can manage payments" on payments;
drop policy if exists "server can manage refunds" on refunds;
drop policy if exists "server can manage social_actions" on social_actions;

create policy "server can manage app_users" on app_users for all to service_role using (true) with check (true);
create policy "server can manage cook_profiles" on cook_profiles for all to service_role using (true) with check (true);
create policy "server can manage dishes" on dishes for all to service_role using (true) with check (true);
create policy "server can manage orders" on orders for all to service_role using (true) with check (true);
create policy "server can manage messages" on messages for all to service_role using (true) with check (true);
create policy "server can manage notifications" on notifications for all to service_role using (true) with check (true);
create policy "server can manage app_sessions" on app_sessions for all to service_role using (true) with check (true);
create policy "server can manage admin_audit_log" on admin_audit_log for all to service_role using (true) with check (true);
create policy "server can manage meal_plans" on meal_plans for all to service_role using (true) with check (true);
create policy "server can manage subscriptions" on subscriptions for all to service_role using (true) with check (true);
create policy "server can manage payments" on payments for all to service_role using (true) with check (true);
create policy "server can manage refunds" on refunds for all to service_role using (true) with check (true);
create policy "server can manage social_actions" on social_actions for all to service_role using (true) with check (true);

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
