# Bunny Teacher Dashboard - Setup Instructions

## Backend Setup (✅ Complete)

The backend is already running on `http://localhost:8000`

- FastAPI server with SQLite database
- All endpoints are available
- Database will be created automatically

## Frontend Setup (Node.js Required)

### Step 1: Install Node.js

1. Download Node.js from: https://nodejs.org/
2. Install the LTS version (recommended)
3. Restart your terminal/command prompt after installation

### Step 2: Install Frontend Dependencies

```bash
cd d:\bunny-teacher\frontend
npm install react react-dom react-router-dom recharts
```

### Step 3: Start Frontend Development Server

```bash
npm start
```

The frontend will be available at `http://localhost:3000`

## Application Features

### Available Pages:
- **Teachers List** (`/`) - View all teachers
- **Add Teacher** (`/add-teacher`) - Add new teacher
- **Data Upload** (`/upload`) - Upload Excel reports
- **Teacher Profile** (`/teacher/:id`) - Individual teacher performance
- **Teacher Comparison** (`/compare`) - Compare two teachers

### Backend API Endpoints:
- `GET /teachers` - List all teachers
- `POST /teachers` - Create new teacher
- `GET /teachers/{id}` - Get teacher details
- `PUT /teachers/{id}` - Update teacher
- `DELETE /teachers/{id}` - Delete teacher
- `GET /teachers/{id}/reports` - Get teacher's monthly reports
- `POST /upload-excel` - Upload Excel report
- `POST /fetch-monthly-data` - Trigger Bunny.net data fetch

## Database

The application uses SQLite database (`elkheta_dashboard.db`) which will be created automatically in the backend directory.

## Next Steps

1. Install Node.js
2. Run the frontend setup commands above
3. Access the application at `http://localhost:3000`
4. The backend API documentation is available at `http://localhost:8000/docs`