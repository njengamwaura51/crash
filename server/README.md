# Crash Game — Authoritative Backend Server

A secure, real-time Node.js backend for the Crash (Aviator-style) game.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| Language | TypeScript |
| HTTP | Express 4 |
| WebSocket | Socket.io 4 |
| Database | MongoDB + Mongoose |
| Auth | JWT (jsonwebtoken) |
| Payments | lipana.dev |
| Security | helmet, cors, express-rate-limit, HMAC-SHA256 |

## Directory Layout

```
server/
├── src/
│   ├── engine/
│   │   └── GameEngine.ts       # Authoritative game loop + provably-fair RNG
│   ├── models/
│   │   ├── User.ts             # Player account
│   │   ├── Bet.ts              # Individual bet record
│   │   ├── Round.ts            # Game round (seeds + crash point)
│   │   └── Transaction.ts      # Deposit / withdrawal ledger
│   ├── middleware/
│   │   └── auth.ts             # JWT verification (HTTP + WebSocket)
│   ├── routes/
│   │   ├── auth.ts             # POST /api/auth/register|login
│   │   ├── payment.ts          # POST /api/payment/deposit|withdraw|webhook
│   │   └── game.ts             # GET/POST /api/game/*, /api/my-info, /api/balance
│   ├── services/
│   │   └── lipana.ts           # lipana.dev API + webhook signature verification
│   ├── socket/
│   │   └── handlers.ts         # Socket.io event bridge (engine ↔ clients)
│   └── index.ts                # Entry point
├── .env.example                # Required environment variables
├── package.json
└── tsconfig.json
```

## Setup

```bash
cd server
cp .env.example .env
# Edit .env with your MongoDB URI, JWT secret, and Lipana credentials
npm install
npm run dev        # Development (ts-node-dev with hot-reload)
npm run build      # Compile TypeScript → dist/
npm start          # Run compiled output
```

## Environment Variables

See `.env.example` for all required and optional variables.

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 5000) |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | At least 64 random characters |
| `LIPANA_API_KEY` | Yes | lipana.dev API key |
| `LIPANA_WEBHOOK_SECRET` | Yes | lipana.dev webhook signing secret |
| `CORS_ORIGINS` | No | Comma-separated frontend origins |

## Game Loop

```
BET (5 s) ──► PLAYING (ticking) ──► GAMEEND (3 s) ──► BET …
```

### Provably Fair Algorithm

The crash point is derived **before** the BET phase starts using HMAC-SHA256:

```
serverSeed  = crypto.randomBytes(32)          # secret until GAMEEND
clientSeed  = String(roundId)                 # public

hash = HMAC-SHA256(serverSeed, clientSeed)
h    = first 32 bits of hash

if h % 25 == 0:  crashPoint = 1.00            # 4% house edge
else:            crashPoint = max(1, floor(99 × 2³²  / (2³² − h)) / 100)
```

The `serverSeed` is stored in MongoDB and revealed on `GAMEEND` so players can verify the result independently.

## REST API

### Auth
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | `{userName, password, currency?}` | Create account |
| POST | `/api/auth/login` | `{userName, password}` | Get JWT token |

### Game
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/my-info` | ✓ | Get my bet history |
| GET | `/api/game/seed/:roundId` | ✓ | Verify a completed round |
| GET | `/api/game/history` | — | Last 30 crash points |
| GET | `/api/balance` | ✓ | Current balance |

### Payments
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/payment/deposit` | ✓ | Initiate STK Push |
| POST | `/api/payment/withdraw` | ✓ | Initiate B2C withdrawal |
| POST | `/api/payment/webhook` | — (HMAC) | lipana.dev callback |

## WebSocket Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `enterRoom` | `{token}` | Authenticate and sync state |
| `playBet` | `{betAmount, target, type, auto}` | Place a bet |
| `cashOut` | `{type, endTarget}` | Cash out |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `gameState` | `{GameState, currentNum, time, currentSecondNum}` | Phase updates |
| `bettedUserInfo` | `BettedUser[]` | Live bet table |
| `myInfo` | `UserType` | User data on login |
| `myBetState` | partial `UserType` | After bet placed |
| `history` | `number[]` | Last 30 crash points |
| `finishGame` | partial `UserType` | After cashout / round end |
| `getBetLimits` | `{max, min}` | On connect |
| `error` | `{index, message}` | Error notification |
| `success` | `string` | Success notification |
