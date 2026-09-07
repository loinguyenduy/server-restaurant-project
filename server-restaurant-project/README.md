# Royal Restaurant — Backend API

The backend engine for **Royal Restaurant**, a full-stack restaurant ordering and operational management system. This repository contains the RESTful API, relational database models, business logic services, transaction boundaries, PayOS payment processing, automated cron jobs, and real-time WebSocket communication via Socket.IO.

---

## Project Overview

The Royal Restaurant backend coordinates operations between diners, front-of-house service staff, kitchen staff, and restaurant managers:

- **Order & Floor Orchestration:** Manages dine-in table lifecycles, takeaway orders, and active dining sessions with concurrency controls.
- **Transactional Stock Integrity:** Implements pessimistic row-level locking and audit-logged stock movements to help prevent inventory race conditions and negative balances.
- **Kitchen Display Coordination:** Dispatches kitchen tickets grouped by preparation batches, synchronizing dish completion across terminals in real time.
- **Payment Processing & Lifecycle:** Generates PayOS payment links and processes signature-verified webhook notifications with idempotent order settlement.
- **Automated Operations:** Executes background scheduled tasks for expired order cleanup, stock restoration, and stale reservation cancellations.

---

## Live Demo & Related Repositories

- **Live Application:** [https://royal-restaurant-nine.vercel.app/](https://royal-restaurant-nine.vercel.app/)
- **Frontend Repository:** [https://github.com/loinguyenduy/client-restaurant-project](https://github.com/loinguyenduy/client-restaurant-project)
- **Backend Repository:** [https://github.com/loinguyenduy/server-restaurant-project](https://github.com/loinguyenduy/server-restaurant-project)

---

## Demo Accounts

The following credentials can be used to authenticate against the backend via the frontend client:

| Role | Email | Password | Direct Login Link | Operational Scope |
|---|---|---|---|---|
| **Customer** | `customer.demo@royalrestaurant.com` | `123456` | [Customer Sign In](https://royal-restaurant-nine.vercel.app/login) | Public catalog, cart, orders, reservations, reviews |
| **Staff** | `staff.demo@royalrestaurant.com` | `123456` | [Staff & Admin Portal](https://royal-restaurant-nine.vercel.app/portal/login) | POS terminal, table seating, Kitchen Display, shift attendance |
| **Admin** | `admin.demo@royalrestaurant.com` | `123456` | [Staff & Admin Portal](https://royal-restaurant-nine.vercel.app/portal/login) | Analytics dashboard, inventory movements, menu, user roles |

> **Note:** These accounts are intended for evaluation purposes. Demo records may be reset or modified periodically.

---

## Backend Architecture

The codebase adheres to a classic layered architectural pattern:

```
[ Client Request / Webhook ]
            │
            ▼
┌───────────────────────────────┐
│         Route Layer           │  Endpoint definitions, route parameters, middleware mounting
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│       Middleware Layer        │  JWT verification, DB active check, RBAC, Multer file parsing
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│       Controller Layer        │  HTTP request parsing, DTO extraction, JSON response formatting
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│        Service Layer          │  Business rules, DB transactions, row locks, post-commit events
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│     Sequelize ORM & Models    │  Model schemas, associations, validations, query builders
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│         MySQL Database        │  Persistent relational storage (Single Source of Truth)
└───────────────────────────────┘
```

- **Routes (`routes/`):** Define REST endpoints mounted under `/api/v1/` and apply security middleware.
- **Middleware (`middleware/`):** Handles access token extraction, decodes claims, verifies user status from the database, and enforces role boundaries.
- **Controllers (`controllers/`):** Keep HTTP concerns separate from domain logic; delegates execution to services and standardizes API responses (`{ EC, EM, DT }`).
- **Services (`services/`):** The core business layer. Manages Sequelize transactions, pessimistic database locks, stock audit trails, external integrations, and post-commit Socket.IO broadcasts.
- **Models (`models/`):** Defines database tables, constraints, and relational associations.
- **Database:** MySQL acts as the authoritative source of truth.

---

## Authentication & Authorization

Authentication is implemented using a dual-token JWT architecture:

1. **Access Token:** Short-lived JWT (`JWT_ACCESS_EXPIRES_IN`, e.g., 10h) sent in the HTTP `Authorization: Bearer <token>` header for stateless route authorization.
2. **Refresh Token:** Long-lived JWT (`JWT_REFRESH_EXPIRES_IN`, e.g., 7d) stored in an `httpOnly`, `SameSite` browser cookie, inaccessible to client-side scripts.
3. **Database Active Verification:** On protected endpoints, the auth middleware decodes the token and validates that the user exists in MySQL with `is_active === true`, ensuring deactivated accounts are immediately locked out without waiting for token expiration.
4. **Role-Based Access Control (RBAC):** Users are assigned one of three roles: `customer`, `staff`, or `admin`. Administrative users are protected in logic from demotion or deactivation.
5. **Password Security:** Passwords are hashed using `bcryptjs` with salt rounds prior to persistence.

---

## Core Restaurant Workflows

```
                           ┌─────────────────────────┐
                           │    Customer or Waiter   │
                           │   Creates Order Ticket  │
                           └────────────┬────────────┘
                                        │
                       ┌────────────────┴────────────────┐
                       ▼                                 ▼
             [ Dine-In Workflow ]              [ Takeaway Workflow ]
           Table Assigned & Occupied             Pickup ETA Estimated
                       │                                 │
                       ├─────────────────────────────────┤
                       ▼
        ┌─────────────────────────────┐
        │  BEGIN DATABASE TRANSACTION │
        │  • Lock Product Rows        │
        │  • Verify & Deduct Stock    │
        │  • Create Order & Items     │
        │  • Log StockMovement Audit  │
        │  COMMIT TRANSACTION         │
        └──────────────┬──────────────┘
                       │
                       ▼
         Post-Commit Socket.IO Signal
                       │
                       ▼
        ┌─────────────────────────────┐
        │    Kitchen Display (KDS)    │
        │  Grouped by Batch ID        │
        │  confirmed → prep → ready   │
        └──────────────┬──────────────┘
                       │
                       ▼
        ┌─────────────────────────────┐
        │       POS Table Checkout    │
        │  • Require Batches Ready    │
        │  • PayOS QR / Cash Settle   │
        │  • Release Table & Complete │
        └─────────────────────────────┘
```

---

## Transactions & Data Integrity

Data integrity in restaurant operations is critical due to concurrent orders competing for finite stock and dining tables.

### ACID Transactions & Pessimistic Row Locking
Core multi-record mutating workflows are wrapped inside managed Sequelize transactions (`sequelize.transaction()`):
- **Stock Validation & Deduction:** Uses `transaction.LOCK.UPDATE` to lock target product rows during order placement. This serializes concurrent read-and-decrement operations, helping prevent race conditions and negative inventory.
- **Stock Audit Trail (`StockMovement`):** Every stock increment or decrement writes an immutable `StockMovement` record with `stock_before`, `stock_after`, `change_quantity`, movement type (`deduct`, `restock`, `cancel`, `adjustment`), and actor reference.
- **Post-Commit Real-Time Emission:** To prevent ghost events in the UI, Socket.IO signals are **never** emitted inside open database transactions. Events are dispatched exclusively after `await transaction.commit()` succeeds. If an error triggers a rollback, no events are sent.

---

## Reservation & Table Lifecycle

The system manages restaurant floor capacity with state-enforced transitions:

- **Table States:** `available` → `reserved` → `occupied`
- **Reservation States:** `pending` → `confirmed` → `seated` → `completed` (or `cancelled`)
- **Capacity & Time Collision Checks:** Prior to booking, the backend verifies table guest capacity and checks for overlapping active reservations within standard dining windows.
- **Seating & Table Locking:** When a reservation is marked `seated`, the corresponding table is atomically locked and transitioned to `occupied`.
- **Automatic Expiration:** An automated cron job cancels pending reservations when customers fail to arrive past the grace period (`NO_SHOW_GRACE_MINUTES = 15`).

---

## POS & Kitchen Display System

- **Kitchen Batches (`kitchen_batch_id`):** Orders placed via POS or customer checkout generate unique kitchen batches. When additional dishes are ordered for an active table, they form an `added` batch, allowing kitchen staff to track cooking progress independently without resetting tickets already in progress.
- **Dine-In Settlement Safety:** The POS checkout service enforces that all kitchen batches associated with an order must be marked `ready` before cashier payment can proceed.
- **Table Release:** Completing checkout settles the order bill, records payment history, and immediately frees the table back to `available`.

---

## Payment Integration (PayOS)

Online payments are integrated through the **PayOS Node.js SDK** (`@payos/node`):

1. **Order Code Generation:** Generates unique integer payment codes derived from timestamps and entropy within safe integer boundaries.
2. **Signature-Verified Webhooks:** Incoming webhooks from PayOS are verified using `payOSInstance.webhooks.verify(req.body)` to confirm checksum authenticity.
3. **Idempotent Webhook Processing:** Webhooks inspect current database states before altering records. Duplicate or out-of-sequence delivery attempts are acknowledged safely without double-crediting orders.
4. **Stale Payment Invalidation:** When an unpaid PayOS order expires or is switched to cash, the server actively requests cancellation of the external payment link on PayOS.

---

## Inventory Management

- **Automatic Deduction:** Product stock is deducted during order creation.
- **Automatic Restoration:** When orders are cancelled manually by staff or timed out by background jobs, stock is restored with corresponding audit logs.
- **Low Stock Signals:** Stock changes trigger `product:availability_changed` socket broadcasts to update customer menus and disable out-of-stock items in real time.

---

## Real-Time Communication (Socket.IO)

The backend runs a Socket.IO WebSocket server integrated with the HTTP service:

- **Handshake Authentication:** The Socket.IO connection middleware extracts JWT access tokens from `socket.handshake.auth.token`, decodes identity, verifies the user in MySQL, and registers the connection into appropriate role rooms.
- **Room Scoping:**
  - `public:menu`: Open to all guests for live menu stock and dish availability invalidations.
  - `user:${userId}`: Scoped to specific authenticated customers for personal order and reservation updates.
  - `role:staff` and `role:admin`: Dedicated operational rooms for live table, order, and reservation notices.
  - `kitchen`: Dedicated channel for Kitchen Display order batches and cooking transitions.

---

## Background Jobs (Cron)

Background schedules are handled via `node-cron`:

| Schedule | Expression | Description |
|---|---|---|
| **Expired Order Cleanup** | `*/15 * * * *` (Every 15 min) | Finds pending PayOS orders older than `PAYOS_ORDER_TIMEOUT_MINUTES` (default 30 min), cancels the PayOS payment link, marks the order `cancelled`, restores inventory stock, and emits real-time cancellation events. |
| **Stale Reservation Cleanup** | `*/5 * * * *` (Every 5 min) | Scans for `pending` reservations older than the reservation time by 15 minutes (`NO_SHOW_GRACE_MINUTES`), marks them `cancelled`, and updates operational screens. |

---

## External Integrations

| Provider / Service | Package / Protocol | Operational Purpose |
|---|---|---|
| **PayOS** | `@payos/node` v2.0.5 | Vietnamese digital banking QR payments & webhook verification |
| **Cloudinary** | `cloudinary` v1.41 / `multer-storage-cloudinary` | Cloud image hosting for menu items and dish photography |
| **MySQL** | `mysql2` v3.16 / `sequelize` v6.37 | Primary relational database storage |
| **Socket.IO** | `socket.io` v4.8 | Low-latency bi-directional operational event delivery |

---

## Technology Stack

| Category | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | v18+ | JavaScript server-side execution environment |
| **Module System** | ES Modules (`"type": "module"`) | Native | Standard JavaScript import/export syntax |
| **Web Framework** | Express.js | ^5.2.1 | HTTP routing, request handling, and middleware pipeline |
| **Database & ORM** | MySQL / Sequelize | ^6.37.7 | Relational schema definitions, queries, transactions, and model synchronization |
| **MySQL Driver** | mysql2 | ^3.16.1 | MySQL database connection pooling and execution |
| **Authentication** | jsonwebtoken / bcryptjs | ^9.0.3 / ^3.0.3 | JWT generation/verification and salted password hashing |
| **Payment Gateway** | @payos/node | ^2.0.5 | PayOS payment link generation and signed webhook processing |
| **Media & Uploads** | Cloudinary / Multer | ^1.41.3 / ^2.0.2 | Multipart form handling and image uploading to CDN |
| **Real-Time** | Socket.IO | ^4.8.3 | WebSocket server with room-based pub/sub broadcasting |
| **Job Scheduling** | node-cron | ^4.2.1 | In-process periodic task scheduler |
| **Utilities** | cookie-parser, cors, dotenv, moment, qs | Latest stable | Cookie handling, CORS origin security, date math, parsing |

---

## Database Architecture

The relational schema is organized into distinct functional domains:

```
[ User ] ────────────┬──< [ Attendance ]
                     ├──< [ Order ] ───< [ OrderItem ] ───> [ Product ] ───> [ Category ]
                     │        │                 │                  │
                     │        │                 └── (batch_id)     └──< [ StockMovement ]
                     │        │
                     │        ├──< [ OrderStatusHistory ]
                     │        └─── [ Review ]
                     │
                     ├──< [ Reservation ] ───> [ Table ]
                     │                             │
                     │                             └──< [ Order ] (dine-in session)
                     └─── [ Cart ] ───< [ CartItem ]
```

- **Identity & Attendance:** `User`, `Attendance`
- **Product Catalog:** `Category`, `Product`
- **Floor Management:** `Table`, `Reservation`
- **Ordering & Cooking:** `Order`, `OrderItem`, `OrderStatusHistory`
- **Shopping Cart:** `Cart`, `CartItem`
- **Inventory & Auditing:** `StockMovement`
- **Engagement & Loyalty:** `Review`, `Coupon`, `UserCoupon`

---

## Environment Variables

Configure backend environment variables in `.env` based on `.env.example`:

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Application environment (`development` or `production`) |
| `PORT` | No | HTTP server listening port (defaults to `8080`) |
| `CLIENT_URL` | Yes | Allowed frontend origin(s), comma-separated (e.g., `https://royal-restaurant-nine.vercel.app`) |
| `MYSQL_URL` | Optional | Full connection URI (e.g., Railway connection string) |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Yes (if no `MYSQL_URL`) | MySQL connection host, port, and database name |
| `DB_USER`, `DB_PASSWORD` | Yes (if no `MYSQL_URL`) | Database credentials |
| `JWT_ACCESS_SECRET` | Yes | Long random secret key for signing access tokens |
| `JWT_REFRESH_SECRET` | Yes | Distinct secret key for signing refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | No | Token lifetime (e.g., `10h`) |
| `JWT_REFRESH_EXPIRES_IN` | No | Refresh token lifetime (e.g., `7d`) |
| `COOKIE_REFRESH_MAX_AGE` | No | Refresh cookie max age in milliseconds (e.g., `604800000`) |
| `CLOUDINARY_NAME`, `_KEY`, `_SECRET` | Yes | Cloudinary credentials for product image uploads |
| `PAYOS_CLIENT_ID`, `_API_KEY`, `_CHECKSUM_KEY` | Yes | PayOS merchant credentials |
| `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL` | Yes | Redirect URLs after payment completion or cancellation |
| `PAYOS_ORDER_TIMEOUT_MINUTES` | No | Timeout duration before expiring unpaid PayOS orders (default: `30`) |
| `LOW_STOCK_THRESHOLD` | No | Threshold for triggering low stock notices (default: `5`) |

---

## Local Setup

### Prerequisites
- Node.js (v18+)
- MySQL Server (v8.0+ recommended)

### Installation Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/loinguyenduy/server-restaurant-project.git
   cd server-restaurant-project
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up the database:**
   Create an empty MySQL database named `royal_restaurant`:
   ```sql
   CREATE DATABASE royal_restaurant CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

4. **Configure environment settings:**
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` with your local database credentials and test keys.*

5. **Seed initial sample data (optional):**
   ```bash
   node seed.js
   ```

6. **Start the development server:**
   ```bash
   npm run dev
   ```
   *The server will start listening on the configured `PORT` (default `8080`), automatically synchronize Sequelize tables, and initialize cron jobs.*

7. **Production execution:**
   ```bash
   npm start
   ```

---

## Testing & Quality Assurance

- **Automated Test Coverage:** Automated test coverage is currently limited (`package.json` does not configure an automated test suite).
- **Verification Method:** Core workflows were verified through manual integration testing, database inspection, and live operational simulation.

---

## Deployment

The backend is structured as a standard Node.js application suitable for deployment on platforms such as Railway, Render, or a VPS:

- Supports direct database connection strings via `MYSQL_URL` or discrete host/port parameters.
- Enforces strict CORS headers based on the configured `CLIENT_URL`.
- Exposes a lightweight `/health` endpoint for uptime checks.

---

## Known Limitations

- **Automated Test Coverage:** Automated test coverage is currently limited; core workflows were verified through manual integration testing, database inspection, and live operational simulation.
- **Database Migrations:** Table schemas are maintained via `sequelize.sync()`; a formal migration history is not actively utilized.
- **Payment Sandbox Dependency:** Payment testing relies on the external PayOS sandbox environment.

---

## Related Repositories

- **Frontend Client:** [client-restaurant-project](https://github.com/loinguyenduy/client-restaurant-project)
- **Live Deployment:** [Royal Restaurant Application](https://royal-restaurant-nine.vercel.app/)
