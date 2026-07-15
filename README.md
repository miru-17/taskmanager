# 📋 Task Manager

A full-stack Task Manager application built using **React, TypeScript, Node.js, Express, Prisma ORM, and PostgreSQL**. This project  supports complete CRUD functionality with server-side validation, automated testing, and a responsive user interface.

---

#  Features

- Create a new task
- View all tasks
- Update existing tasks
- Delete tasks
- Search tasks by title
- Dashboard statistics (Total, Pending, Completed)
- Server-side validation
- Loading and error handling
- Backend API tests using Jest & Supertest
- Frontend component tests using Vitest & React Testing Library

---

# Tech Stack

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- Axios
- React Hot Toast

## Backend

- Node.js
- Express.js
- TypeScript
- Prisma ORM
- PostgreSQL

## Testing

### Backend

- Jest
- Supertest

### Frontend

- Vitest
- React Testing Library

---

# Project Structure

```
taskmanager/
│
├── backend/
│   ├── prisma/
│   ├── src/
│   ├── tests/
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

---

# Prerequisites

Before running the project, make sure you have installed:

- Node.js (v18 or later)
- npm
- PostgreSQL
- Git

---

# Backend Setup

## Step 1: Clone the Repository

```bash
git clone https://github.com/miru-17/taskmanager.git
```

---

## Step 2: Navigate to the Project

```bash
cd taskmanager
```

---

## Step 3: Go to Backend

```bash
cd backend
```

---

## Step 4: Install Dependencies

```bash
npm install
```

---

## Step 5: Configure Environment Variables

Create a file named:

```
.env
```

Copy the contents from:

```
.env.example
```

Example:

```env
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/taskmanager?schema=public"

PORT=3000
```

Replace:

```
your_password
```

with your PostgreSQL password.

---

## Step 6: Run Prisma Migration

```bash
npx prisma migrate dev
```

---

## Step 7: Generate Prisma Client

```bash
npx prisma generate
```

---

## Step 8: Start the Backend

```bash
npm run dev
```

Backend will run at:

```
http://localhost:3000
```

---

# 💻 Frontend Setup

Open another terminal.

---

## Step 1

```bash
cd frontend
```

---

## Step 2

```bash
npm install
```

---

## Step 3

```bash
npm run dev
```

Frontend will run at:

```
http://localhost:5173
```

Open:

```
http://localhost:5173
```

---

# 🗄️ Database

This project uses PostgreSQL.

Prisma manages the database schema and migrations.

Run the following command whenever the schema changes:

```bash
npx prisma migrate dev
```

---

# 🧪 Running Tests

## Backend Tests

Navigate to backend:

```bash
cd backend
```

Run:

```bash
npm test
```

---

## Frontend Tests

Navigate to frontend:

```bash
cd frontend
```

Run:

```bash
npx vitest run
```

---

# 📡 API Endpoints

## Get All Tasks

```
GET /tasks
```

---

## Get Task by ID

```
GET /tasks/:id
```

---

## Create Task

```
POST /tasks
```

Example Request

```json
{
  "title": "Complete Assignment",
  "description": "Finish internship project",
  "status": "TODO",
  "dueDate": "2026-07-25"
}
```

---

## Update Task

```
PUT /tasks/:id
```

---

## Delete Task

```
DELETE /tasks/:id
```

---

# ✅ Validation

The backend validates:

- Title cannot be empty
- Due date cannot be in the past
- Status must be one of:

```
TODO
IN_PROGRESS
DONE
```

Invalid input returns:

```
400 Bad Request
```

with a clear error message.

---

# 📊 Testing Coverage

### Backend

- Get all tasks
- Get task by ID
- Create task
- Update task
- Delete task
- Invalid title validation
- Invalid status validation
- Invalid task ID (404)

### Frontend

- Home page rendering
- Task creation
- Task editing
- Task deletion
- Component rendering

---


# 👩‍💻 Author

**Mirudhula Kathirvel**

Full Stack Task Manager

---

