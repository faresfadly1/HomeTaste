# HomeTaste Flutter Mobile Readiness Plan

## Goal

Build a Flutter customer, cook, and driver app on top of the existing HomeTaste API without duplicating business logic.

## Phase 1: Shared API Contract

- Use the Railway API as the single backend: authentication, orders, payments, notifications, tracking, subscriptions, refunds, and social actions.
- Keep secrets on the backend only. Flutter receives public config such as API base URL, Mapbox public token, Google Maps browser/mobile keys, Firebase config, and OneSignal app ID.
- Add typed Dart models for `User`, `Cook`, `Dish`, `Order`, `Payment`, `Notification`, `MealPlan`, `Subscription`, and `Refund`.

## Phase 2: App Foundations

- Flutter package structure:
  - `lib/app.dart`
  - `lib/core/api_client.dart`
  - `lib/core/auth_store.dart`
  - `lib/features/auth`
  - `lib/features/browse`
  - `lib/features/orders`
  - `lib/features/driver`
  - `lib/features/cook`
  - `lib/features/profile`
- Suggested packages:
  - `dio` for HTTP
  - `flutter_secure_storage` for session token storage
  - `go_router` for navigation
  - `riverpod` for state
  - `firebase_messaging` or `onesignal_flutter` for push
  - `google_maps_flutter`, `mapbox_maps_flutter`, or `flutter_map` for live tracking

## Phase 3: Customer App

- Email/password and Google login.
- Browse cooks and dishes.
- Cart and scheduled order checkout.
- Hosted payment handoff for Stripe, iyzico, or PayTR checkout URLs.
- My Orders with live tracking, refund requests, chat, and reorder.
- Meal plan dashboard: active plan, pause, resume, skip week, cancel.
- Social: follow cook, like dishes, comments, photo shares.

## Phase 4: Driver App

- Available orders list.
- Accept order.
- Background/foreground driver location update to `/api/orders/:id/location`.
- Navigation handoff to Google Maps, Apple Maps, or in-app map.
- Status buttons: picked up, on the way, near you, delivered.
- Daily earnings from payment/order data.

## Phase 5: Cook App

- Cook dashboard: revenue, ratings, orders, followers, popular dishes.
- Accept order, cooking, ready.
- Manage dishes, availability, meal plans.
- Verification status for ID, address, and phone.

## Phase 6: Push And Maps

- Register each mobile device with `/api/notifications/devices`.
- Send push events for order accepted, food ready, driver near, delivered, refund reviewed, and new delivery available.
- Render live route from `order.route.polyline`, `order.driverLocation`, `order.customerLocation`, `order.etaMinutes`, and `order.locationHistory`.

## Release Checklist

- Rotate any previously public credentials.
- Run the latest `supabase/schema.sql`.
- Configure Railway variables for payment, push, and maps.
- Add iOS/Android bundle IDs to Google OAuth and push providers.
- Test payment sandbox flows before switching provider accounts to live mode.
