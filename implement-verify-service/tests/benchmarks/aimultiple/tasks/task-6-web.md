# Task 6: Helpdesk Ticket System

Build a full-stack helpdesk ticket management system with JWT authentication, role-based access, and ticket lifecycle management.

## Tech Stack

- **Backend:** Python FastAPI + SQLite
- **Frontend:** React (or Vue or Svelte) + Vite
- **Auth:** JWT tokens (access tokens, no refresh)

## User Roles

### Customer
- Can create tickets
- Can view only their own tickets
- Can reply to their own tickets
- Cannot see other customers' tickets (return 404, not 403)

### Agent
- Can view all tickets
- Can assign tickets to themselves
- Can update ticket status
- Can reply to any ticket
- Can filter tickets by status

## Data Model

### User
- id (auto-generated)
- email (unique)
- password (hashed)
- role ("customer" | "agent")
- name

### Ticket
- id (auto-generated)
- subject
- description
- status ("open" | "in_progress" | "waiting_on_customer" | "resolved" | "reopened")
- priority ("low" | "medium" | "high" | "urgent")
- created_by (user id — customer)
- assigned_to (user id — agent, nullable)
- created_at (datetime)
- updated_at (datetime)

### Reply
- id (auto-generated)
- ticket_id
- user_id
- content (text)
- created_at (datetime)

## API Endpoints

### Auth
- `POST /register` — Create new user (email, password, name, role)
- `POST /login` — Returns JWT token (email, password → {access_token, token_type})

### Tickets
- `POST /tickets` — Create ticket (auth required, customer role). Body: {subject, description, priority}
- `GET /tickets` — List tickets. Customers: own tickets only. Agents: all tickets. Optional query param: `?status=open`
- `GET /tickets/{id}` — Get ticket detail with replies. Customers: 404 if not theirs. Agents: any ticket.
- `PUT /tickets/{id}/status` — Update ticket status (agent only). Body: {status}
- `PUT /tickets/{id}/assign` — Assign ticket to agent (agent only). Body: {agent_id} (use "self" for current agent)
- `POST /tickets/{id}/replies` — Add reply to ticket (auth required). Body: {content}

### Health
- `GET /health` — Returns `{"status": "ok"}` with 200

## Status Workflow

```
open → in_progress → resolved
open → in_progress → waiting_on_customer → in_progress → resolved
resolved → reopened → in_progress → resolved
```

Valid transitions:
- `open` → `in_progress`
- `in_progress` → `waiting_on_customer`, `resolved`
- `waiting_on_customer` → `in_progress`
- `resolved` → `reopened`
- `reopened` → `in_progress`

## Seed Data

On first startup, create these users if they don't exist:

| Email | Password | Role | Name |
|-------|----------|------|------|
| agent@example.com | agent123 | agent | Support Agent |
| customer@example.com | customer123 | customer | Test Customer |

## Run Commands

Backend:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

## Deliverable Structure

```
project/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── models.py (or inline)
│   ├── auth.py (or inline)
│   └── database.py (or inline)
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── App.jsx (or .vue / .svelte)
        ├── main.jsx
        └── components/
            ├── Login.jsx
            ├── TicketList.jsx
            ├── TicketDetail.jsx
            └── CreateTicket.jsx
```

## Acceptance Criteria

1. Both backend and frontend start without errors
2. Seed users can log in
3. JWT auth works on all protected endpoints
4. Customers can only see their own tickets (404 for others)
5. Agents can see all tickets and assign/update status
6. Status transitions follow the defined workflow
7. Replies are threaded per ticket
8. Frontend renders login form, ticket list, and ticket detail views
