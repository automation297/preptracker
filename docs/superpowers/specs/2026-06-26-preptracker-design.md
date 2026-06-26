# PrepTracker — Protein & Supply Tracking System
**Date:** 2026-06-26  
**Status:** Approved — ready for implementation planning

---

## Overview

A mobile-first web app for tracking proteins and supplies dropped off at a home prep kitchen. The owner (Somoarua) logs what he delivers, the prep team (Franklin and Mama Franklin) logs progress and marks items ready, and the owner confirms pickup. Browser push notifications keep everyone in sync.

---

## 1. Users & Authentication

Three fixed accounts — no self-signup. All users authenticate with a **PIN code** (6 digits).

| Name | Role | PIN login |
|------|------|-----------|
| Owner (Somoarua) | `owner` | 6-digit PIN |
| Franklin | `prep` | 6-digit PIN |
| Mama Franklin | `prep` | 6-digit PIN |

- No email required for any user
- PINs set by the owner at setup and changeable from a settings screen
- Sessions persist 30 days (same cookie approach as HuurFacil)
- 3 pre-seeded accounts in the database — no registration flow

---

## 2. Items

### Proteins (tracked by weight in kg)
1. Flank Steak
2. Chicken Breast
3. Chicken Wings
4. Chicharron / Pork Belly
5. Burger Meat / Carni Mula
6. Bacon

### Supplies (tracked by quantity + unit)
- **Seasonings** — owner names each (e.g., "Salt", "Adobo") and specifies amount (e.g., "500g", "3 bags")
- **Gloves** — quantity (e.g., "2 boxes")
- Other supplies can be added as free-text name + amount

---

## 3. Core Workflow

### Drop-off (Owner)
1. Owner taps **"New Drop-off"**
2. Selects proteins and enters weight in kg for each (e.g., Flank Steak: 100.3 kg)
3. Adds any supplies (name + amount)
4. Submits — creates a **drop-off record** with timestamp
5. Push notification sent to Franklin and Mama Franklin

### Progress Logging (Prep team)
1. Prep team sees active drop-offs on their home screen
2. Taps a protein → enters **kg processed so far** + optional note
3. Can update multiple times as work progresses
4. When fully processed → taps **"Mark Ready"**
5. Push notification sent to owner when a protein is marked Ready

### Pickup (Owner)
1. Owner sees which proteins are Ready
2. Visits Franklin's place, taps **"Confirm Pickup"** on the drop-off
3. All Ready items are marked **Picked Up**
4. Any items still In Progress remain open and carry over

### Status Flow
```
Dropped Off → In Progress → Ready → Picked Up
```

---

## 4. Inventory View

The owner sees a **live inventory** of what is currently at Franklin's place:

- Each protein: total kg dropped off (across all open batches) vs. kg processed
- Supplies: what was dropped off, still present until owner marks pickup
- Nothing disappears until the owner confirms pickup

The prep team sees the same inventory from their side — what they have to work with.

---

## 5. Screens

### Owner Screens
| Screen | Purpose |
|--------|---------|
| Home / Dashboard | Live inventory at Franklin's — proteins (kg remaining) + supplies |
| New Drop-off | Form to log proteins + supplies being delivered today |
| Drop-off History | List of all drop-offs with status badges |
| Drop-off Detail | Items in a specific drop-off, progress per protein, Confirm Pickup button |
| Settings | Change PINs, manage push notification subscriptions |

### Prep Team Screens
| Screen | Purpose |
|--------|---------|
| Home | What's at their place — proteins to process, supplies available |
| Log Progress | Tap protein → enter kg done + note → save or Mark Ready |
| History | Past completed batches |

### Shared
- PIN login screen (large keypad, mobile-friendly)
- Language toggle: Papiamento / Spanish / English

---

## 6. Push Notifications

Using VAPID web-push (same as HuurFacil).

| Trigger | Recipients | Message |
|---------|-----------|---------|
| New drop-off logged | Franklin + Mama Franklin | "New drop-off — [protein list] ready to prep" |
| Protein marked Ready | Owner | "[Protein name] is ready for pickup" |

Users subscribe to push notifications on first login. Subscription stored per user in DB.

---

## 7. Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Backend | Node.js + Express | Same as HuurFacil — familiar pattern |
| Database | PostgreSQL on Render | Persistent, relational — tracks batches, progress, users |
| Frontend | Single HTML + app.js (SPA) | Mobile-first, no install required |
| Auth | PIN + session cookie | Simple, no email needed |
| Push | VAPID / web-push | Browser push, no app store |
| Hosting | Render (web service + DB) | Same as HuurFacil |

---

## 8. Database Schema

### `users`
```sql
id, name, role (owner|prep), pin_hash, push_subscription, created_at
```

### `dropoffs`
```sql
id, created_by (user_id), dropped_at, notes, status (open|picked_up), picked_up_at
```

### `dropoff_proteins`
```sql
id, dropoff_id, protein_name, weight_kg, status (in_progress|ready), created_at
```

### `protein_logs`
```sql
id, dropoff_protein_id, logged_by (user_id), kg_done, note, logged_at
```

### `dropoff_supplies`
```sql
id, dropoff_id, name, amount, unit
```

---

## 9. Security

- PIN hashed with bcryptjs (same as HuurFacil password hashing)
- Sessions with secure cookie (HTTPS only in production)
- Role-based access: only owner can create drop-offs and confirm pickup; only prep team can log progress
- Rate limiting on PIN attempts (5 attempts per 15 min per IP)
- Helmet security headers + CSP (scriptSrcAttr unsafe-inline for onclick handlers)

---

## 10. Design

- Same design system as HuurFacil: Plus Jakarta Sans, teal/coral/mango/green tokens
- Large tap targets throughout (Mama Franklin is 70 — everything accessible)
- High-contrast status badges: 🟡 In Progress / ✅ Ready / 📦 Picked Up
- PIN entry: large number keypad (like an ATM), not a small text input
- All weights shown as `XX.X kg` (one decimal place)
