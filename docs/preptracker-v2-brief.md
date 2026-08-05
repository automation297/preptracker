# PREPTRACKER v2 — Build Brief (Mucho On)

**Goal:** Upgrade the existing `preptracker` (Postgres on Render) into ONE inventory + prep + spend + POS system that BOTH the Mucho On WhatsApp bot AND the cashier/kitchen app read from. One source of truth: sales, raw stock, prepped stock, consumables, monthly shopping spend, and staff hours — all connected. It gives the cashier app real POS features, best-seller insight, staff clock-in/out + payroll, and a clean monthly report to hand straight to Byron. Owner and preppers each log in and see live counts.

---

## 0. Database first (deadline)
`preptracker-db` (free Render Postgres) is suspended **2026-07-27** and deleted after a grace period. Before building anything, upgrade it to Render paid Postgres or migrate to a new Postgres. Everything below assumes a live connection string that the **bot also connects to**. Do not lose the current data.

## 1. Architecture
- Bot connects **directly to preptracker's Postgres** for inventory/prep/spend/orders/time. Keep the bot's existing state (`mucho_state.json`) as-is — only add the Postgres connection for the new features. (To merge everything into one DB instead, flag it first — default is connect, don't rewrite.)
- **Every completed order + its line items is written to Postgres** (see `orders` / `order_items` below). This is the data spine that powers best-sellers, channel breakdowns, and the Byron report.
- Reuse existing infrastructure, do not build parallels: the 86 system, `report` / `month` / `last month`, the `kitchenDone` 2-stage flow (= depletion trigger), the `/owner` dashboard (PIN-gated), driver isolation + zones + fees, accept/decline-with-reason, the 45-min change window, the promotions flow (6 types) + loyalty already scoped, the open/close schedule + `open`/`close` overrides, and reports to **+297 567 1026**.

## 2. Three inventory categories
- **Proteins (raw -> prepped):** bought raw by weight (e.g. flank steak in kg). Converted to portioned bags via the prep flow. Sales deplete the *prepped* portions.
- **Consumables:** seasoning, oil, prep bags. Bought in bulk (containers/boxes). Depleted automatically at prep time by ratio. Low alerts when a container/box runs down.
- **Direct items:** tortillas, buns, cheese, soft drinks, juice. Bought, then depleted directly at sale via the recipe map. No prep step.

## 3. Tables (extend what exists)
- `ingredients` — name, category (protein / consumable / direct), purchase_unit, portion_unit, unit_conversion, raw_qty, prepped_qty (proteins only), low_threshold.
- `purchases` — ingredient, qty, unit, total_price, vendor, date. Monthly spend log. **Price per purchase, never fixed on the item** -> price history per item per vendor.
- `menu_items` — menu with sale price.
- `recipes` (portion / bill-of-materials) — menu_item -> ingredients consumed at sale + amount each. KEY TABLE.
- `prep_ratios` — per protein: seasoning per kg, oil per kg, g per bag -> bags per kg.
- `prep_log` — protein, raw kg used, portions produced, seasoning/oil/bags consumed, prepper_id, status (ready_to_prep / done), timestamps.
- `orders` — order_no, type (walkup / pickup / delivery), source (cashier / bot / aruba_to_you / vapvap), status, payment_method, subtotal, discount, delivery_fee, total, customer ref, timestamps.
- `order_items` — order_no, menu_item, qty, modifiers, line_price. (Powers best-sellers + item mix.)
- `voids` — order_no or line, reason, amount, who, when.
- `waste_log` — dropped / spoiled / comped.
- `stock_adjustments` — monthly physical recount reset.
- `staff` — name, role, hourly_rate, active, clock-in method (shared work phone, name-based).
- `time_entries` — staff, clock_in, clock_out, date, hours (computed), source (bot / app), status (open / closed / pending_approval / approved), notes.

## 4. Recipes, portions & ratios — verify against real data, don't invent
- **Recipes / portion sizes:** the bot already handles menu items and portions, so Claude Code should **pull the recipe + portion data from wherever the bot already stores it** (repo / config / DB) instead of re-entering it. One check that matters: knowing an item's menu portion for *pricing* is not the same as knowing its *ingredient breakdown in grams* for subtracting from raw stock. If the existing data already has the gram-level amount per ingredient, use it directly. If it only has menu/pricing, confirm the ingredient amounts with Junior before wiring depletion to them — wrong amounts silently corrupt inventory.
- **Prep ratios are new:** seasoning-per-kg, oil-per-kg, and grams-per-bag per protein are introduced by the prepper calculator and are NOT part of the ordering bot. Get these from Junior (or a prep sheet) — do not guess.

## 5. Units
Purchase-unit vs. portion-unit everywhere: meat/chicken bought in **kg**, portioned in **grams**; drinks by the **case**, sold by the **can**; buns by the **pack**, sold **each**; seasoning/oil by the **container**, used in **g/ml**; bags by the **box**, used **each**. Store the conversion on each item.

## 6. Buying stock — photo / receipt entry
- Owner sends a **photo of the items or receipt** to the bot (reuse the existing image handling used for transfer proofs and promos).
- Bot identifies the items, matches them to the buy list, and **replies with a confirmation message listing what it recognized.**
- Owner confirms and provides **qty + price** for each (the bot can't reliably read weight/price/vendor off packaging; price changes by vendor and month -> always entered per purchase).
- On confirm -> stock up + purchase logged with price, vendor, date.
- Manual entry too: `buy [item] [qty] [price]`.

## 7. Prep workflow (owner <-> prepper)
**Owner view:** full inventory (raw / prepped / consumables / direct), low highlighted; watches prepped portions drain live -> knows **when to hand the next raw batch and which protein**; notified each time a batch is marked done.

**Prepper view (isolated — only their prep queue, like drivers):**
1. Logs in with their code -> sees what needs prepping + current prepped levels.
2. Weighs the raw amount, enters it (e.g. 10kg flank steak), taps **"Ready to prep."**
3. System shows the amounts for that weight: **seasoning [X]g, oil [Y]ml, portion into [N] bags at [P]g each.**
4. Does the work, taps **"Done."**
5. On Done, one transaction: raw -10kg, seasoning -X, oil -Y, bags -N, prepped +N. **Owner notified: "[Prepper] finished: 10kg flank steak -> N portions."**
6. Continues to the next prep item.

## 8. Auto-depletion summary
- **Buy** -> raw/direct stock up + spend logged.
- **Prep "Done"** -> raw -, consumables - (by ratio), prepped +.
- **Order sold** (kitchenDone) -> prepped portions + direct items - via recipe map.
- **Any item <= low_threshold** -> low-stock alert to +297 567 1026 (raw, prepped, direct, seasoning/oil/bags).
- **Prepped stock <= 0** -> auto-86 via the EXISTING 86 system; auto-returns when replenished.

## 9. Online availability (bot side)
Before confirming an item, check prepped/direct stock. If auto-86'd, the bot tells the customer it's sold out — **reuse the existing 86 messaging.** Online availability and the cashier app stay in agreement automatically.

## 10. Cashier app = real POS (feature parity)
- **Build an order:** pick items + **modifiers** (sauces — pinda/ajo/rosada, add-ons, MIX pricing, cheese options, algo-mas upsell), set qty.
- **Order type:** Walk-up / Pickup / **Delivery**. The **Delivery button** -> pick zone -> auto delivery fee -> assign driver (reuse existing driver system, zones, fees; fee goes to the driver, logged separately, NOT counted as revenue).
- **Source tag:** cashier / WhatsApp bot / Aruba To You / VapVap — every order tagged so reporting can split by channel.
- **Payment:** cash / swipe (card) / Placanet (transfer is bot-only, with proof to +297 562 9225). Record which method; show change owed. Card/swipe feeds BBO (owner-only).
- **Discounts, promos & loyalty at checkout:** apply coupon / threshold / BOGO / combo / day-time deal + loyalty redemption (reuse the promotions flow + loyalty). Logged with reason.
- **Order status lifecycle:** New -> Accepted -> Preparing -> Ready -> Out for delivery / Picked up -> Completed (ties into existing accept/decline + kitchenDone).
- **Edit / recall:** modify an active order before completion; recall & reprint a ticket.
- **Void / refund / comp:** with a reason, tracked in `voids`, excluded from net sales, shown in reports.
- **Customer receipt:** print via existing ESC/POS Bluetooth or send via WhatsApp. No BBO line (owner-only).
- **Live stock view:** remaining counts per tracked item, low highlighted, quick "log waste" action.
- **On-shift panel:** shows who's currently clocked in + their clock-in time, so at close anyone still on can be reminded to clock out. They clock out manually; closing the shift auto-clocks-out any stragglers (see section 15).
- On completion -> write `orders` + `order_items` to Postgres + deplete stock via recipe map.

## 11. Owner dashboard (/owner) — sales insight
- **Best sellers** (top items) + item mix.
- **Sales by order type** (walk-up / pickup / delivery) and **by source** (bot / cashier / Aruba To You / VapVap).
- Sales by hour and by day, average ticket, busiest nights.
- Current stock across all categories + low-stock list; prepped portions remaining per protein.
- This month's spend (total + by category + by vendor); revenue vs. ingredient cost vs. **labor cost** = gross margin.
- **Timesheet & payroll:** hours per employee this week, pay = hours x rate, and pending time corrections to approve.
- BBO owner-only; never on tickets, customer receipts, kitchen/driver/prepper screens.

## 12. End-of-day close (Z-report)
At close, one report: total sales; split by **payment method** (cash / card / Placanet); by order type; by source; total discounts / voids / comps; card total -> **BBO (owner-only)**; **cash expected vs counted -> discrepancy**. Automates the nightly number and rides on the existing shift report to +297 567 1026.

## 13. Monthly report for Byron
Rolls up the daily closes into one clean report:
- Total sales, and sales by payment method.
- **BBO (7% on card/swipe only)** ready to file.
- Total shopping spend (by category + by vendor).
- **Labor cost** (hours x rate per employee, from the timesheet).
- Voids / comps, and net.
- **Exportable as PDF** (or the existing `month` output) formatted to hand straight to Byron for BBO filing + monthly reconciliation.
Runs with the existing month-report job (1st, 9AM -> +297 567 1026). BBO stays owner-only.

## 14. New admin commands (add to existing set)
- `stock` — current levels (all categories)
- photo / receipt -> auto-adds to buy list after confirm
- `buy [item] [qty] [price]` — manual purchase
- `low` — what's running low
- `waste [item] [qty] [reason]`
- `void [order] [reason]`
- `bestsellers` / `bestsellers month`
- `close day` (or `z`) — end-of-day close
- `spend` / `spend month`
- `recount [item] [actual qty]` — physical count reset
- `[name] in` / `[name] out` — staff clock in / out (stamps current time)
- `[name] update [date] [time]` — fix a missed punch (needs owner approval)
- `approve [name] [date]` — owner approves a correction
- `[name] hours` — that employee's own hours this week
- `timesheet` / `payroll` — owner view of the week's hours + pay (runs Monday)
- `paid [name]` — mark an employee's weekly payout as paid (Wednesday record)

## 15. Staff time tracking & payroll (clock in / out)
Staff clock in and out from the **shared work phone** by texting the bot; the name in the message says who it is (so several people can share one phone). The bot already knows the open/close schedule and validates every punch against it.

**Clock in:** Nigel texts `nigel in` and it stamps the **current time** — no need to type a time. He can still type one (`nigel 6:30`); if it's within **15 minutes** of now it's accepted, otherwise it's logged and sent to the owner for approval, so a punch can't be back-dated by hours. The bot **echoes back the time it recorded** (e.g. "Clocked in: Nigel, 18:30") so a misread is caught instantly.
- Rejected if the day is closed (e.g. a closed Wednesday, unless manually opened) or the time is well outside operating hours.
- If already clocked in, it says so instead of double-punching.

**Clock out:** Nigel texts `nigel out` (stamps the current time; a typed time is optional and follows the same 15-minute rule) -> shift closed, hours computed.
- **Auto-clock-out fires when the shift is closed in the kitchen app** (the existing close-shift action) — anyone still on the clock is clocked out at that moment.
- **3:00am is a hard backstop:** if the shift is never formally closed, everyone still clocked in is auto-clocked-out at 3am so hours don't run away.

**Fix a missed punch:** `nigel update 12/06/26 18:30` submits a correction for that date/time. Dates read as **DD/MM/YY** and times as **24-hour** (Aruba standard), and the bot echoes the parsed date/time back to confirm. It goes to the **owner as pending approval**; only approved corrections count. Corrections are validated against open/close hours too (can't claim a closed day).

**Employee self-view (isolated, like drivers):** `nigel hours` shows only his own shifts + total for the week. He can review before payday and submit a correction if something's off.

**Payroll runs Monday, paid out Wednesday.** On **Monday** the owner is notified of the week's hours + pay (hours x rate) per employee, and each employee can review their own hours and submit a correction. That Monday -> Wednesday gap is the review/approval window. On **Wednesday** it's payout: the approved total is what you pay, you can mark it paid for your records, and it flows into the monthly report as labor cost. Each employee has an hourly rate in `staff` (e.g. Nigel ~13 AWG/hr). Same isolation model as drivers/preppers — everyone sees only their own hours.

## Confirm with Junior before / during build
- Which items to track per category.
- Recipes/portions: Claude Code pulls from the bot's existing data; confirm it actually has ingredient **gram amounts** (not just menu pricing) before depletion relies on it. `prep_ratios` (seasoning/kg, oil/kg, g/bag per protein) are new — get from Junior.
- Order sources to track (bot, cashier, Aruba To You, VapVap, any others).
- Which discounts/promos to expose at the cashier.
- Receipt format (print + WhatsApp?).
- Placanet confirmed cash-like (excluded from BBO); transfer stays bot-only.
- Prepper login codes; starting stock counts (raw, prepped, consumables).
- Payroll runs **Monday** (notify + review), paid out **Wednesday** — confirmed. Confirm which day the work-week starts and ends so Monday's total covers the right days.
- Staff list + hourly rates.
- Architecture: bot connects to preptracker Postgres (default) vs. merge into one DB.

---
**Clocking rules chosen (best-practice defaults):** normal punches stamp the current time (`name in` / `name out`, no typed time needed); a typed time is accepted only within 15 min of now, else it needs owner approval; corrections always need approval; dates DD/MM/YY, times 24-hour; the bot echoes every recorded time back to confirm.
