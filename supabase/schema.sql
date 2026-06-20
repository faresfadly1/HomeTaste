create table if not exists app_users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('owner', 'cook', 'customer', 'driver')),
  city text,
  country text not null default 'TR' check (country in ('TR', 'DE')),
  phone text,
  national_id text,
  profile_photo text,
  profile_cover text,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  auth_provider text not null default 'password',
  auth_meta jsonb not null default '{}'::jsonb,
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
  profile_photo text,
  cover_photo text,
  online boolean not null default false,
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
  country text,
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
  fulfillment_type text not null default 'delivery' check (fulfillment_type in ('delivery', 'pickup')),
  requires_driver boolean not null default true,
  status text not null default 'placed' check (status in ('placed', 'accepted', 'preparing', 'ready', 'driver_assigned', 'picked_up', 'out_for_delivery', 'near_you', 'delivered', 'cancelled')),
  status_history jsonb not null default '[]'::jsonb,
  payment_method text not null default 'cash',
  payment jsonb not null default '{}'::jsonb,
  delivery_address text,
  scheduled_for timestamptz,
  customer_location jsonb,
  cook_location jsonb,
  driver_location jsonb,
  location_history jsonb not null default '[]'::jsonb,
  delivery jsonb not null default '{}'::jsonb,
  route jsonb,
  eta_minutes integer,
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
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read boolean not null default false
);

create table if not exists app_sessions (
  token text primary key,
  user_id text not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
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
  skip_weeks jsonb not null default '[]'::jsonb,
  paused_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists auth_tokens (
  id text primary key,
  token text not null unique,
  user_id text references app_users(id) on delete cascade,
  email text,
  phone text,
  type text not null check (type in ('email_verification', 'phone_verification', 'password_reset', 'oauth_state')),
  meta jsonb not null default '{}'::jsonb,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  customer_id text not null references app_users(id) on delete restrict,
  cook_id text not null references cook_profiles(id) on delete restrict,
  method text not null,
  status text not null default 'held' check (status in ('pending', 'held', 'released', 'refunded', 'failed')),
  gross numeric not null default 0,
  commission_rate numeric not null default 0.15,
  commission numeric not null default 0,
  cook_payout numeric not null default 0,
  delivery_fee numeric not null default 0,
  driver_payout numeric not null default 0,
  provider text not null default 'manual',
  external_payment_id text,
  checkout_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_at timestamptz
);

alter table orders add column if not exists delivery jsonb not null default '{}'::jsonb;
alter table orders add column if not exists fulfillment_type text not null default 'delivery';
alter table orders add column if not exists requires_driver boolean not null default true;
alter table orders drop constraint if exists orders_fulfillment_type_check;
alter table orders add constraint orders_fulfillment_type_check check (fulfillment_type in ('delivery', 'pickup'));
alter table payments add column if not exists delivery_fee numeric not null default 0;
alter table payments add column if not exists driver_payout numeric not null default 0;
alter table payments add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table orders drop constraint if exists orders_status_check;
  alter table orders add constraint orders_status_check check (status in ('placed', 'accepted', 'preparing', 'ready', 'driver_assigned', 'picked_up', 'out_for_delivery', 'near_you', 'delivered', 'cancelled'));
end $$;

create table if not exists notification_devices (
  id text primary key,
  user_id text not null references app_users(id) on delete cascade,
  provider text not null check (provider in ('firebase', 'onesignal')),
  token text not null unique,
  platform text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
create index if not exists idx_notification_devices_user_id on notification_devices(user_id);
create index if not exists idx_sessions_user_id on app_sessions(user_id);
create index if not exists idx_auth_tokens_token on auth_tokens(token);
create index if not exists idx_auth_tokens_user_id on auth_tokens(user_id);
create index if not exists idx_meal_plans_cook_id on meal_plans(cook_id);
create index if not exists idx_subscriptions_customer_id on subscriptions(customer_id);
create index if not exists idx_subscriptions_cook_id on subscriptions(cook_id);
create index if not exists idx_payments_order_id on payments(order_id);
create index if not exists idx_refunds_order_id on refunds(order_id);
create index if not exists idx_social_actions_cook_id on social_actions(cook_id);
create index if not exists idx_social_actions_dish_id on social_actions(dish_id);

with duplicate_follows as (
  select id, row_number() over (
    partition by user_id, cook_id
    order by created_at desc, id desc
  ) as duplicate_number
  from social_actions
  where type = 'follow'
)
delete from social_actions
where id in (select id from duplicate_follows where duplicate_number > 1);

with duplicate_likes as (
  select id, row_number() over (
    partition by user_id, dish_id
    order by created_at desc, id desc
  ) as duplicate_number
  from social_actions
  where type = 'like'
)
delete from social_actions
where id in (select id from duplicate_likes where duplicate_number > 1);

create unique index if not exists uq_social_follow_user_cook
  on social_actions(user_id, cook_id)
  where type = 'follow';
create unique index if not exists uq_social_like_user_dish
  on social_actions(user_id, dish_id)
  where type = 'like';

alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check check (role in ('owner', 'cook', 'customer', 'driver'));
alter table app_users add column if not exists email_verified boolean not null default false;
alter table app_users add column if not exists phone_verified boolean not null default false;
alter table app_users add column if not exists auth_provider text not null default 'password';
alter table app_users add column if not exists auth_meta jsonb not null default '{}'::jsonb;
alter table app_users add column if not exists profile_photo text;
alter table app_users add column if not exists profile_cover text;
alter table app_users add column if not exists national_id text;

alter table cook_profiles add column if not exists verification jsonb not null default '{"id":"pending","address":"pending","phone":"pending","notes":""}'::jsonb;
alter table cook_profiles add column if not exists followers integer not null default 0;
alter table cook_profiles add column if not exists profile_photo text;
alter table cook_profiles add column if not exists cover_photo text;
alter table cook_profiles add column if not exists online boolean not null default false;
alter table dishes add column if not exists country text;
alter table orders add column if not exists driver_id text references app_users(id) on delete set null;
alter table orders add column if not exists payment jsonb not null default '{}'::jsonb;
alter table orders add column if not exists scheduled_for timestamptz;
alter table orders add column if not exists customer_location jsonb;
alter table orders add column if not exists cook_location jsonb;
alter table orders add column if not exists driver_location jsonb;
alter table orders add column if not exists location_history jsonb not null default '[]'::jsonb;
alter table orders add column if not exists route jsonb;
alter table orders add column if not exists eta_minutes integer;
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in ('placed', 'accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery', 'near_you', 'delivered', 'cancelled'));
alter table notifications add column if not exists data jsonb not null default '{}'::jsonb;
alter table app_sessions add column if not exists expires_at timestamptz not null default (now() + interval '7 days');
alter table payments add column if not exists external_payment_id text;
alter table payments add column if not exists checkout_url text;
alter table payments add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check check (status in ('pending', 'held', 'released', 'refunded', 'failed'));

alter table subscriptions add column if not exists skip_weeks jsonb not null default '[]'::jsonb;
alter table subscriptions add column if not exists paused_at timestamptz;

alter table app_users enable row level security;
alter table cook_profiles enable row level security;
alter table dishes enable row level security;
alter table orders enable row level security;
alter table messages enable row level security;
alter table notifications enable row level security;
alter table app_sessions enable row level security;
alter table auth_tokens enable row level security;
alter table admin_audit_log enable row level security;
alter table meal_plans enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table refunds enable row level security;
alter table social_actions enable row level security;
alter table notification_devices enable row level security;

drop policy if exists "server can manage app_users" on app_users;
drop policy if exists "server can manage cook_profiles" on cook_profiles;
drop policy if exists "server can manage dishes" on dishes;
drop policy if exists "server can manage orders" on orders;
drop policy if exists "server can manage messages" on messages;
drop policy if exists "server can manage notifications" on notifications;
drop policy if exists "server can manage app_sessions" on app_sessions;
drop policy if exists "server can manage auth_tokens" on auth_tokens;
drop policy if exists "server can manage admin_audit_log" on admin_audit_log;
drop policy if exists "server can manage meal_plans" on meal_plans;
drop policy if exists "server can manage subscriptions" on subscriptions;
drop policy if exists "server can manage payments" on payments;
drop policy if exists "server can manage refunds" on refunds;
drop policy if exists "server can manage social_actions" on social_actions;
drop policy if exists "server can manage notification_devices" on notification_devices;

create policy "server can manage app_users" on app_users for all to service_role using (true) with check (true);
create policy "server can manage cook_profiles" on cook_profiles for all to service_role using (true) with check (true);
create policy "server can manage dishes" on dishes for all to service_role using (true) with check (true);
create policy "server can manage orders" on orders for all to service_role using (true) with check (true);
create policy "server can manage messages" on messages for all to service_role using (true) with check (true);
create policy "server can manage notifications" on notifications for all to service_role using (true) with check (true);
create policy "server can manage app_sessions" on app_sessions for all to service_role using (true) with check (true);
create policy "server can manage auth_tokens" on auth_tokens for all to service_role using (true) with check (true);
create policy "server can manage admin_audit_log" on admin_audit_log for all to service_role using (true) with check (true);
create policy "server can manage meal_plans" on meal_plans for all to service_role using (true) with check (true);
create policy "server can manage subscriptions" on subscriptions for all to service_role using (true) with check (true);
create policy "server can manage payments" on payments for all to service_role using (true) with check (true);
create policy "server can manage refunds" on refunds for all to service_role using (true) with check (true);
create policy "server can manage social_actions" on social_actions for all to service_role using (true) with check (true);
create policy "server can manage notification_devices" on notification_devices for all to service_role using (true) with check (true);

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
