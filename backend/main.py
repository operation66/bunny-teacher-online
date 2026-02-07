from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile, Form
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import hashlib
import io
import random
import logging
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
import os
from dotenv import load_dotenv

import models
import schemas
import pytz
from database import engine, get_db, SessionLocal
from bunny_service import get_bunny_stats, get_bunny_libraries, get_library_monthly_stats

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Elkheta Teacher Performance Dashboard")

load_dotenv()
# Allow localhost in dev and optionally additional origins from env
dev_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
extra_origins = os.getenv("ALLOWED_ORIGINS", "").split(",") if os.getenv("ALLOWED_ORIGINS") else []
allowed_origins = dev_origins + [o.strip() for o in extra_origins if o.strip()]

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^http:\/\/(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Upsert Teachers from Bunny libraries
@app.post("/teachers/upsert-from-bunny/", response_model=schemas.UpsertTeachersResponse)
async def upsert_teachers_from_bunny(db: Session = Depends(get_db)):
    """Ensure a Teacher exists for every Bunny library, preferring names from LibraryConfig."""
    try:
        # Try to fetch libraries from Bunny.net
        libraries = await get_bunny_libraries()

        # Fallback to LibraryConfig if Bunny API is unavailable
        if not libraries:
            config_items = db.query(models.LibraryConfig).all()
            libraries = [{"id": cfg.library_id, "name": cfg.library_name} for cfg in config_items]

        # Build authoritative names from LibraryConfig
        config_names = {cfg.library_id: cfg.library_name for cfg in db.query(models.LibraryConfig).all()}

        results: List[schemas.UpsertResult] = []
        created = updated = unchanged = failed = 0

        for lib in libraries:
            lib_id = lib.get("id")
            lib_name = lib.get("name")
            display_name = config_names.get(lib_id) or lib_name or f"Library {lib_id}"

            try:
                teacher = db.query(models.Teacher).filter(models.Teacher.bunny_library_id == lib_id).first()
                if teacher:
                    if teacher.name != display_name:
                        teacher.name = display_name
                        action = "updated"
                        updated += 1
                    else:
                        action = "unchanged"
                        unchanged += 1
                else:
                    teacher = models.Teacher(name=display_name, bunny_library_id=lib_id)
                    db.add(teacher)
                    action = "created"
                    created += 1

                results.append(schemas.UpsertResult(
                    bunny_library_id=lib_id,
                    name=display_name,
                    action=action,
                    success=True,
                    message="OK"
                ))
            except Exception as e:
                logger.error(f"Teacher upsert failed for library {lib_id}: {str(e)}")
                failed += 1
                results.append(schemas.UpsertResult(
                    bunny_library_id=lib_id,
                    name=display_name,
                    action="error",
                    success=False,
                    message=f"Failed to upsert library {lib_id}",
                    error=str(e)
                ))

        # Attempt a flush to catch any remaining issues before commit
        try:
            pending_new = list(db.new)
            if pending_new:
                try:
                    logger.warning(f"Pending new objects before commit: {[type(o).__name__ for o in pending_new]}")
                except Exception:
                    pass
            db.flush()
        except Exception as flush_err:
            logger.error(f"Flush error before commit: {flush_err}")
            # Remove any problematic new instances from the session
            try:
                for obj in list(db.new):
                    try:
                        db.expunge(obj)
                    except Exception:
                        pass
            except Exception:
                pass
            db.rollback()
        
        # Validate pending new objects to prevent NULL insertions
        try:
            for obj in list(db.new):
                try:
                    if isinstance(obj, models.LibraryConfig):
                        if getattr(obj, "library_id", None) is None or getattr(obj, "library_name", None) is None:
                            logger.error("Expunging invalid LibraryConfig before commit: "
                                         f"library_id={getattr(obj, 'library_id', None)}, "
                                         f"library_name={getattr(obj, 'library_name', None)})")
                            db.expunge(obj)
                except Exception:
                    # Defensive: continue if any attribute access fails
                    pass
        except Exception as precommit_err:
            logger.error(f"Pre-commit validation error: {precommit_err}")

        # Detach all objects to avoid flushing invalid pending instances
        try:
            db.expunge_all()
        except Exception as detach_err:
            logger.warning(f"Failed to expunge all before commit: {detach_err}")
        db.commit()

        return schemas.UpsertTeachersResponse(
            success=True,
            total_libraries=len(libraries),
            created=created,
            updated=updated,
            unchanged=unchanged,
            failed=failed,
            results=results
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Error upserting teachers from Bunny libraries: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to upsert teachers: {str(e)}")

# Bunny.net API endpoints
@app.get("/bunny-libraries/", response_model=List[schemas.BunnyLibrary])
async def fetch_bunny_libraries(db: Session = Depends(get_db)):
    """
    Fetch all libraries from Bunny.net (names and IDs only)
    """
    try:
        # Try to get real data from Bunny.net
        libraries = await get_bunny_libraries()
        
        # Convert to the expected format (prefer LibraryConfig name if present)
        formatted_libraries = []
        for library in libraries:
            lib_id = library.get("id")
            lib_name = library.get("name")
            try:
                cfg = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == lib_id).first()
                if cfg and cfg.library_name:
                    lib_name = cfg.library_name
            except Exception:
                pass

            formatted_libraries.append({
                "id": lib_id,
                "name": lib_name,
                "video_views": 0,  # Default value, will be updated when stats are fetched
                "total_watch_time_seconds": 0  # Default value, will be updated when stats are fetched
            })
        
        # If API fails, return mock data for demonstration
        if not formatted_libraries:
            logger.warning("Bunny.net API unavailable, returning mock data")
            mock_libraries = [
                {"id": 26972, "name": "(0LD)S1-MATH-EN--Shady Elsharkawy (FAWZY)", "video_views": 0, "total_watch_time_seconds": 0},
                {"id": 27845, "name": "S2-PHYSICS-AR--Ahmed Hassan", "video_views": 0, "total_watch_time_seconds": 0},
                {"id": 28156, "name": "S3-CHEMISTRY-EN--Sarah Mohamed", "video_views": 0, "total_watch_time_seconds": 0},
                {"id": 29234, "name": "S1-BIOLOGY-AR--Omar Ali", "video_views": 0, "total_watch_time_seconds": 0},
                {"id": 30567, "name": "S2-MATH-EN--Fatima Ahmed", "video_views": 0, "total_watch_time_seconds": 0}
            ]
            return mock_libraries
        
        # Return real data if available
        return formatted_libraries
        
    except Exception as e:
        logger.error(f"Error in fetch_bunny_libraries: {str(e)}")
        # Return mock data as fallback
        mock_libraries = [
            {"id": 26972, "name": "(0LD)S1-MATH-EN--Shady Elsharkawy (FAWZY)", "video_views": 0, "total_watch_time_seconds": 0},
            {"id": 27845, "name": "S2-PHYSICS-AR--Ahmed Hassan", "video_views": 0, "total_watch_time_seconds": 0},
            {"id": 28156, "name": "S3-CHEMISTRY-EN--Sarah Mohamed", "video_views": 0, "total_watch_time_seconds": 0},
            {"id": 29234, "name": "S1-BIOLOGY-AR--Omar Ali", "video_views": 0, "total_watch_time_seconds": 0},
            {"id": 30567, "name": "S2-MATH-EN--Fatima Ahmed", "video_views": 0, "total_watch_time_seconds": 0}
        ]
        return mock_libraries

@app.post("/bunny-libraries/sync-stats/")
async def sync_library_stats(request: dict, db: Session = Depends(get_db)):
    """
    Fetch and sync monthly statistics for selected libraries (views and watch time only)
    """
    try:
        library_ids = request.get("library_ids", [])
        month = request.get("month", datetime.now().month)
        year = request.get("year", datetime.now().year)

        if not library_ids:
            raise HTTPException(status_code=400, detail="No library IDs provided")

        synced_libraries = []

        for library_id in library_ids:
            try:
                # Get accurate stats from Stream API
                stats_data = await get_library_monthly_stats(library_id, month, year, db)

                # Only use real API data - no mock data fallback
                if not stats_data or "error" in stats_data:
                    logger.error(f"Failed to get stats for library {library_id} - skipping")
                    continue

                # Use the real stats from Bunny.net (use the canonical keys)
                views = stats_data.get("total_views", 0)
                watch_time_seconds = stats_data.get("total_watch_time_seconds", 0)
                last_updated = stats_data.get("last_updated")

                # Find or create teacher record (prefer configured library name)
                teacher = db.query(models.Teacher).filter(models.Teacher.bunny_library_id == library_id).first()
                if not teacher:
                    cfg = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
                    display_name = (cfg.library_name if cfg and cfg.library_name else f"Library {library_id}")

                    teacher = models.Teacher(
                        name=display_name,
                        bunny_library_id=library_id
                    )
                    db.add(teacher)
                    db.commit()
                    db.refresh(teacher)

                # Create or update monthly stats (consistent keys)
                existing_stat = db.query(models.MonthlyStats).filter(
                    models.MonthlyStats.teacher_id == teacher.id,
                    models.MonthlyStats.month == month,
                    models.MonthlyStats.year == year
                ).first()

                if existing_stat:
                    existing_stat.video_views = views
                    existing_stat.total_watch_time_seconds = watch_time_seconds
                else:
                    new_stat = models.MonthlyStats(
                        teacher_id=teacher.id,
                        month=month,
                        year=year,
                        video_views=views,
                        total_watch_time_seconds=watch_time_seconds
                    )
                    db.add(new_stat)

                synced_libraries.append({
                    "library_id": library_id,
                    "views": views,
                    "watch_time_seconds": watch_time_seconds,
                    "last_updated": last_updated
                })

            except Exception as e:
                logger.error(f"Error syncing stats for library {library_id}: {str(e)}")
                # continue syncing remaining libraries
                continue

        db.commit()

        return {
            "message": f"Successfully synced statistics for {len(synced_libraries)} libraries",
            "count": len(synced_libraries),
            "synced_libraries": synced_libraries
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Error in sync_library_stats: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error syncing statistics: {str(e)}")

# Health check endpoints
@app.get("/teachers/", response_model=List[schemas.Teacher])
def read_teachers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    teachers = db.query(models.Teacher).offset(skip).limit(limit).all()
    return teachers

@app.get("/teachers/{teacher_id}", response_model=schemas.Teacher)
def read_teacher(teacher_id: int, db: Session = Depends(get_db)):
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if db_teacher is None:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return db_teacher

# -----------------------------
# Users and Authentication
# -----------------------------

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def verify_password(password: str, password_hash: str) -> bool:
    try:
        return hash_password(password) == password_hash
    except Exception:
        return False

@app.get("/users/", response_model=List[schemas.User])
def get_users(db: Session = Depends(get_db)):
    return db.query(models.User).all()

@app.post("/users/", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    db_user = models.User(
        email=user.email,
        password_hash=hash_password(user.password),
        allowed_pages=user.allowed_pages,
        is_active=user.is_active if user.is_active is not None else True,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.put("/users/{user_id}", response_model=schemas.User)
def update_user(user_id: int, update: schemas.UserUpdate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if update.email is not None:
        # Check unique email
        other = db.query(models.User).filter(models.User.email == update.email, models.User.id != user_id).first()
        if other:
            raise HTTPException(status_code=400, detail="Email already in use")
        db_user.email = update.email
    if update.password:
        db_user.password_hash = hash_password(update.password)
    if update.allowed_pages is not None:
        db_user.allowed_pages = update.allowed_pages
    if update.is_active is not None:
        db_user.is_active = update.is_active
    db.commit()
    db.refresh(db_user)
    return db_user

@app.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(db_user)
    db.commit()
    return {"success": True}

@app.post("/auth/login", response_model=schemas.LoginResponse)
def login(req: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == req.email).first()
    if not user or not user.is_active or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return schemas.LoginResponse(
        success=True,
        message="Login successful",
        user_id=user.id,
        email=user.email,
        allowed_pages=user.allowed_pages or [],
    )

@app.get("/teachers/{teacher_id}/monthly-stats", response_model=List[schemas.MonthlyStats])
def get_teacher_monthly_stats(teacher_id: int, db: Session = Depends(get_db)):
    """Get all monthly stats for a specific teacher"""
    # First check if teacher exists
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if db_teacher is None:
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    # Get all stats for this teacher, ordered by year and month (most recent first)
    stats = db.query(models.MonthlyStats).filter(
        models.MonthlyStats.teacher_id == teacher_id
    ).order_by(
        models.MonthlyStats.year.desc(),
        models.MonthlyStats.month.desc()
    ).all()
    
    return stats

# Report upload endpoints
@app.post("/upload-quality-report/", response_model=schemas.ExcelUploadResponse)
async def upload_quality_report(
    teacher_id: int = Form(...),
    month: int = Form(...),
    year: int = Form(...),
    file: UploadFile = File(...)
):
    return await process_report_upload(teacher_id, month, year, "quality", file)

@app.post("/upload-student-report/", response_model=schemas.ExcelUploadResponse)
async def upload_student_report(
    teacher_id: int = Form(...),
    month: int = Form(...),
    year: int = Form(...),
    file: UploadFile = File(...)
):
    return await process_report_upload(teacher_id, month, year, "student", file)

@app.post("/upload-operations-report/", response_model=schemas.ExcelUploadResponse)
async def upload_operations_report(
    teacher_id: int = Form(...),
    month: int = Form(...),
    year: int = Form(...),
    file: UploadFile = File(...)
):
    return await process_report_upload(teacher_id, month, year, "operations", file)

async def process_report_upload(teacher_id: int, month: int, year: int, report_type: str, file: UploadFile):
    """Helper function to process report uploads"""
    db = next(get_db())
    
    # Validate teacher exists
    teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    # Validate month and year
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Month must be between 1 and 12")
    if year < 2000 or year > 2100:
        raise HTTPException(status_code=400, detail="Year must be between 2000 and 2100")
    
    try:
        # Import pandas only when needed
        import pandas as pd
        import numpy as np
        
        # Helper: normalize column names for flexible matching
        def normalize(col: str) -> str:
            return str(col).strip().lower().replace(" ", "_").replace("-", "_")

        # Helper: find first matching column by aliases (case/space insensitive)
        def find_column(df: pd.DataFrame, aliases):
            norm_map = {normalize(c): c for c in df.columns}
            for alias in aliases:
                key = normalize(alias)
                if key in norm_map:
                    return norm_map[key]
            return None

        # Helper: coerce a numeric value from dataframe cell
        def coerce_number(val):
            try:
                if val is None or (isinstance(val, float) and np.isnan(val)):
                    return None
                return float(val)
            except Exception:
                # Try parsing string numbers
                try:
                    return float(str(val).strip())
                except Exception:
                    return None

        # Helper: coerce boolean from common representations
        def coerce_bool(val):
            if isinstance(val, (bool, np.bool_)):
                return bool(val)
            s = str(val).strip().lower()
            if s in {"true", "t", "yes", "y", "1", "on"}:
                return True
            if s in {"false", "f", "no", "n", "0", "off"}:
                return False
            # Fallback: non-empty string or positive number
            try:
                num = float(s)
                return num != 0.0
            except Exception:
                return bool(s)
        
        # Read Excel file
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        # Normalize empty dataframe quickly
        if df is None or df.shape[0] == 0:
            raise HTTPException(status_code=400, detail="Excel file is empty or has no rows")
        
        if report_type == "quality":
            # Process quality report
            score_col = find_column(df, ["score", "quality_score", "rating"])  
            if not score_col:
                raise HTTPException(status_code=400, detail="Quality report must contain a 'score' column (aliases: quality_score, rating)")
            score_val = coerce_number(df[score_col].iloc[0])
            if score_val is None:
                raise HTTPException(status_code=400, detail="Quality score value is missing or invalid")

            summary_col = find_column(df, ["summary", "quality_summary", "notes", "comment"])  
            summary_val = None
            if summary_col:
                try:
                    summary_val = str(df[summary_col].iloc[0])
                except Exception:
                    summary_val = None

            quality_report = models.QualityReport(
                teacher_id=teacher_id,
                month=month,
                year=year,
                quality_score=score_val,
                quality_summary=summary_val
            )
            db.add(quality_report)
            
        elif report_type == "student":
            # Process student report
            score_col = find_column(df, ["score", "student_score", "feedback_score", "rating"])  
            if not score_col:
                raise HTTPException(status_code=400, detail="Student report must contain a 'score' column (aliases: student_score, feedback_score, rating)")
            score_val = coerce_number(df[score_col].iloc[0])
            if score_val is None:
                raise HTTPException(status_code=400, detail="Student score value is missing or invalid")

            summary_col = find_column(df, ["summary", "student_feedback_summary", "notes", "comment"])  
            summary_val = None
            if summary_col:
                try:
                    summary_val = str(df[summary_col].iloc[0])
                except Exception:
                    summary_val = None

            student_report = models.StudentReport(
                teacher_id=teacher_id,
                month=month,
                year=year,
                student_feedback_score=score_val,
                student_feedback_summary=summary_val
            )
            db.add(student_report)
            
        elif report_type == "operations":
            # Process operations report
            schedule_col = find_column(df, ["on_schedule", "on schedule", "onschedule", "is_on_schedule", "on_time", "schedule"])  
            if not schedule_col:
                raise HTTPException(status_code=400, detail="Operations report must contain an 'on_schedule' column (aliases: on schedule, onschedule, is_on_schedule, on_time)")
            schedule_val = coerce_bool(df[schedule_col].iloc[0])

            attitude_col = find_column(df, ["attitude_summary", "attitude", "summary", "notes", "comment"])  
            attitude_val = None
            if attitude_col:
                try:
                    attitude_val = str(df[attitude_col].iloc[0])
                except Exception:
                    attitude_val = None

            operations_report = models.OperationsReport(
                teacher_id=teacher_id,
                month=month,
                year=year,
                operations_on_schedule=schedule_val,
                operations_attitude_summary=attitude_val
            )
            db.add(operations_report)
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Successfully processed {report_type} report for teacher {teacher_id}",
            "teacher_id": teacher_id,
            "month": month,
            "year": year,
            "report_type": report_type
        }
        
    except HTTPException as e:
        db.rollback()
        # Re-raise validation errors directly
        raise e
    except Exception as e:
        db.rollback()
        # Provide clearer error with type
        msg = f"{type(e).__name__}: {str(e)}" if str(e) else type(e).__name__
        raise HTTPException(status_code=500, detail=f"Error processing Excel file: {msg}")

# Upload history endpoint
@app.get("/upload-history/{teacher_id}", response_model=List[schemas.UploadHistory])
def get_upload_history(teacher_id: int, db: Session = Depends(get_db)):
    """Get upload history for a specific teacher"""
    teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    history = []
    
    # Get quality reports
    quality_reports = db.query(models.QualityReport).filter(
        models.QualityReport.teacher_id == teacher_id
    ).all()
    for report in quality_reports:
        history.append({
            "id": report.id,
            "teacher_name": teacher.name,
            "report_type": "quality",
            "month": report.month,
            "year": report.year,
            "uploaded_at": report.uploaded_at
        })
    
    # Get student reports
    student_reports = db.query(models.StudentReport).filter(
        models.StudentReport.teacher_id == teacher_id
    ).all()
    for report in student_reports:
        history.append({
            "id": report.id,
            "teacher_name": teacher.name,
            "report_type": "student",
            "month": report.month,
            "year": report.year,
            "uploaded_at": report.uploaded_at
        })
    
    # Get operations reports
    operations_reports = db.query(models.OperationsReport).filter(
        models.OperationsReport.teacher_id == teacher_id
    ).all()
    for report in operations_reports:
        history.append({
            "id": report.id,
            "teacher_name": teacher.name,
            "report_type": "operations",
            "month": report.month,
            "year": report.year,
            "uploaded_at": report.uploaded_at
        })
    
    # Sort by upload date (most recent first)
    history.sort(key=lambda x: x["uploaded_at"], reverse=True)
    
    return history

# Dashboard data endpoints
@app.get("/dashboard-data/")
def get_dashboard_data(
    teacher_id: int,
    month: int,
    year: int,
    report_types: str,  # Comma-separated list: "quality,student,operations"
    db: Session = Depends(get_db)
):
    """Get dashboard data for specific teacher, month, year and report types"""
    teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    requested_types = [t.strip() for t in report_types.split(",")]
    dashboard_data = {
        "teacher_name": teacher.name,
        "month": month,
        "year": year,
        "monthly_stats": None,
        "reports": {}
    }
    
    # Get monthly stats
    monthly_stats = db.query(models.MonthlyStats).filter(
        models.MonthlyStats.teacher_id == teacher_id,
        models.MonthlyStats.month == month,
        models.MonthlyStats.year == year
    ).first()
    
    if monthly_stats:
        dashboard_data["monthly_stats"] = {
            "video_views": monthly_stats.video_views,
            "bandwidth_gb": monthly_stats.bandwidth_gb
        }
    
    # Get requested reports
    if "quality" in requested_types:
        quality_report = db.query(models.QualityReport).filter(
            models.QualityReport.teacher_id == teacher_id,
            models.QualityReport.month == month,
            models.QualityReport.year == year
        ).first()
        if quality_report:
            dashboard_data["reports"]["quality"] = {
                "score": quality_report.quality_score,
                "summary": quality_report.quality_summary,
                "uploaded_at": quality_report.uploaded_at
            }
    
    if "student" in requested_types:
        student_report = db.query(models.StudentReport).filter(
            models.StudentReport.teacher_id == teacher_id,
            models.StudentReport.month == month,
            models.StudentReport.year == year
        ).first()
        if student_report:
            dashboard_data["reports"]["student"] = {
                "score": student_report.student_feedback_score,
                "summary": student_report.student_feedback_summary,
                "uploaded_at": student_report.uploaded_at
            }
    
    if "operations" in requested_types:
        operations_report = db.query(models.OperationsReport).filter(
            models.OperationsReport.teacher_id == teacher_id,
            models.OperationsReport.month == month,
            models.OperationsReport.year == year
        ).first()
        if operations_report:
            dashboard_data["reports"]["operations"] = {
                "on_schedule": operations_report.operations_on_schedule,
                "attitude_summary": operations_report.operations_attitude_summary,
                "uploaded_at": operations_report.uploaded_at
            }
    
    return dashboard_data

# Library Configuration endpoints
@app.get("/library-configs/", response_model=List[schemas.LibraryConfig])
def get_library_configs(db: Session = Depends(get_db)):
    """Get all library configurations"""
    return db.query(models.LibraryConfig).all()

@app.get("/library-configs/{library_id}", response_model=schemas.LibraryConfig)
def get_library_config(library_id: int, db: Session = Depends(get_db)):
    """Get configuration for a specific library"""
    config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Library configuration not found")
    return config

@app.post("/library-configs/", response_model=schemas.LibraryConfig)
def create_library_config(config: schemas.LibraryConfigCreate, db: Session = Depends(get_db)):
    """Create or update library configuration"""
    # Check if config already exists
    existing_config = db.query(models.LibraryConfig).filter(
        models.LibraryConfig.library_id == config.library_id
    ).first()
    
    if existing_config:
        # Update existing config
        existing_config.library_name = config.library_name
        existing_config.stream_api_key = config.stream_api_key
        existing_config.is_active = config.is_active
        existing_config.updated_at = datetime.now()
        db.commit()
        db.refresh(existing_config)
        return existing_config
    else:
        # Create new config
        db_config = models.LibraryConfig(**config.dict())
        db.add(db_config)
        db.commit()
        db.refresh(db_config)
        return db_config

from datetime import datetime

@app.put("/library-configs/{library_id}")
def update_library_config(library_id: int, config: schemas.LibraryConfigUpdate, db: Session = Depends(get_db)):
    db_config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    
    # Update the fields
    for key, value in config.dict(exclude_unset=True).items():
        setattr(db_config, key, value)
    
    # IMPORTANT: Add this line to update the timestamp
    db_config.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(db_config)
    return db_config
    
    """Update library configuration"""
    db_config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    if not db_config:
        raise HTTPException(status_code=404, detail="Library configuration not found")
    
    # Update only provided fields
    update_data = config.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_config, field, value)
    
    db_config.updated_at = datetime.now()
    db.commit()
    db.refresh(db_config)
    return db_config

@app.delete("/library-configs/{library_id}")
def delete_library_config(library_id: int, db: Session = Depends(get_db)):
    """Delete library configuration"""
    db_config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    if not db_config:
        raise HTTPException(status_code=404, detail="Library configuration not found")
    
    db.delete(db_config)
    db.commit()
    return {"message": "Library configuration deleted successfully"}

@app.post("/library-configs/sync-from-bunny/")
async def sync_library_configs_from_bunny(db: Session = Depends(get_db)):
    """Sync library configurations from Bunny.net API"""
    try:
        # Fetch libraries from Bunny.net
        libraries = await get_bunny_libraries()
        logger.info(f"Fetched {len(libraries)} libraries from Bunny.net API")

        synced_count = 0
        updated_count = 0

        # Use a direct engine transaction and raw SQL only to avoid ORM flush issues
        from database import engine
        from sqlalchemy import text as sql_text

        with engine.begin() as conn:
            # Process live Bunny libraries
            for library in libraries:
                # Support both capitalized and lowercase keys; get_bunny_libraries returns lowercase
                lib_id = library.get("id") if "id" in library else library.get("Id")
                lib_name = library.get("name") if "name" in library else library.get("Name")

                # Validate and normalize
                if lib_id is None:
                    logger.warning(f"Skipping library with null ID: {library}")
                    continue
                try:
                    lib_id = int(lib_id)
                except (TypeError, ValueError):
                    logger.warning(f"Skipping library with non-integer ID '{lib_id}': {library}")
                    continue
                if not lib_name:
                    lib_name = f"Library {lib_id}"
                lib_name = str(lib_name)

                # Upsert behavior: update name if exists, otherwise insert
                exists = conn.execute(
                    sql_text("SELECT 1 FROM library_configs WHERE library_id = :library_id"),
                    {"library_id": lib_id}
                ).fetchone()

                if exists:
                    # Update only if name changed
                    result = conn.execute(
                        sql_text(
                            "UPDATE library_configs SET library_name = :library_name, updated_at = CURRENT_TIMESTAMP "
                            "WHERE library_id = :library_id AND library_name != :library_name"
                        ),
                        {"library_id": lib_id, "library_name": lib_name}
                    )
                    if result.rowcount:
                        updated_count += 1
                else:
                    conn.execute(
                        sql_text(
                            "INSERT OR IGNORE INTO library_configs (library_id, library_name, stream_api_key, is_active, created_at, updated_at) "
                            "VALUES (:library_id, :library_name, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                        ),
                        {"library_id": lib_id, "library_name": lib_name}
                    )
                    synced_count += 1

            # Also ensure configs exist for libraries present in historical stats
            stats_rows = conn.execute(
                sql_text("SELECT DISTINCT library_id, library_name FROM library_historical_stats")
            ).fetchall()

            for row in stats_rows:
                hist_id = row[0]
                hist_name = row[1]
                if hist_id is None:
                    continue
                try:
                    hist_id = int(hist_id)
                except (TypeError, ValueError):
                    continue
                hist_name = str(hist_name or f"Library {hist_id}")

                exists = conn.execute(
                    sql_text("SELECT 1 FROM library_configs WHERE library_id = :library_id"),
                    {"library_id": hist_id}
                ).fetchone()

                if not exists:
                    conn.execute(
                        sql_text(
                            "INSERT OR IGNORE INTO library_configs (library_id, library_name, stream_api_key, is_active, created_at, updated_at) "
                            "VALUES (:library_id, :library_name, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                        ),
                        {"library_id": hist_id, "library_name": hist_name}
                    )
                    synced_count += 1

        return {
            "message": f"Sync complete: created {synced_count}, updated {updated_count}",
            "created": synced_count,
            "updated": updated_count
        }

    except Exception as e:
        logger.error(f"Error syncing library configs: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to sync library configurations: {str(e)}")

@app.get("/")
def read_root():
    return {"message": "Welcome to Elkheta Teacher Performance Dashboard API"}


@app.post("/bunny-libraries/raw-api-response/")
async def get_raw_api_response(request: dict, db: Session = Depends(get_db)):
    """
    Get raw API response from Bunny.net Stream API to investigate available fields
    """
    try:
        library_id = request.get("library_id")
        start_date = request.get("start_date")
        end_date = request.get("end_date")
        
        if not library_id or not start_date or not end_date:
            raise HTTPException(status_code=400, detail="Missing required parameters")
        
        # Import here to avoid circular imports
        import httpx
        import os
        from dotenv import load_dotenv
        
        load_dotenv()
        BUNNY_STREAM_API_KEY = os.getenv("BUNNY_STREAM_API_KEY")
        
        if not BUNNY_STREAM_API_KEY:
            raise HTTPException(status_code=500, detail="API key not configured")
        
        headers = {
            "AccessKey": BUNNY_STREAM_API_KEY,
            "Content-Type": "application/json"
        }
        
        params = {
            "dateFrom": start_date,
            "dateTo": end_date,
            "hourly": "false"
        }
        
        async with httpx.AsyncClient(verify=True, timeout=30.0) as client:
             response = await client.get(
                 f"https://video.bunnycdn.com/library/{library_id}/statistics",
                 headers=headers,
                 params=params
             )
             
             if response.status_code == 200:
                 return response.json()
             else:
                 raise HTTPException(status_code=response.status_code, detail=response.text)
                
    except Exception as e:
        logger.error(f"Error getting raw API response: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Historical Stats endpoints
@app.post("/historical-stats/batch-fetch/", response_model=schemas.BatchFetchResponse)
async def batch_fetch_library_stats(request: schemas.BatchFetchRequest, db: Session = Depends(get_db)):
    """
    Fetch monthly statistics for multiple libraries and store in database
    """
    try:
        results = []
        successful_fetches = 0
        failed_fetches = 0
        skipped_fetches = 0

        for library_id in request.library_ids:
            try:
                # Check if data already exists for this library/month/year
                existing_stats = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id == library_id,
                    models.LibraryHistoricalStats.month == request.month,
                    models.LibraryHistoricalStats.year == request.year
                ).first()

                # Get fresh stats from Bunny service
                stats_data = await get_library_monthly_stats(library_id, request.month, request.year, db)

                # Prefer authoritative name from LibraryConfig if available
                try:
                    cfg = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
                    display_name = (cfg.library_name if cfg and cfg.library_name else stats_data.get("library_name", f"Library {library_id}"))
                except Exception:
                    display_name = stats_data.get("library_name", f"Library {library_id}")

                if existing_stats:
                    # Update existing record
                    existing_stats.total_views = stats_data.get("total_views", 0)
                    existing_stats.total_watch_time_seconds = stats_data.get("total_watch_time_seconds", 0)
                    existing_stats.bandwidth_gb = stats_data.get("bandwidth_gb", 0.0)
                    existing_stats.views_chart = stats_data.get("views_chart", {})
                    existing_stats.watch_time_chart = stats_data.get("watch_time_chart", {})
                    existing_stats.bandwidth_chart = stats_data.get("bandwidth_chart", {})
                    existing_stats.library_name = display_name
                    existing_stats.fetch_date = datetime.now(pytz.UTC)
                    existing_stats.updated_at = datetime.now(pytz.UTC)

                    db.commit()
                    db.refresh(existing_stats)

                    results.append(schemas.LibraryFetchStatus(
                        library_id=library_id,
                        library_name=display_name,
                        status="success",
                        success=True,
                        message="Updated existing data",
                        data=existing_stats
                    ))
                    successful_fetches += 1
                else:
                    # Create new record
                    new_stats = models.LibraryHistoricalStats(
                        library_id=library_id,
                        library_name=display_name,
                        month=request.month,
                        year=request.year,
                        total_views=stats_data.get("total_views", 0),
                        total_watch_time_seconds=stats_data.get("total_watch_time_seconds", 0),
                        bandwidth_gb=stats_data.get("bandwidth_gb", 0.0),
                        views_chart=stats_data.get("views_chart", {}),
                        watch_time_chart=stats_data.get("watch_time_chart", {}),
                        bandwidth_chart=stats_data.get("bandwidth_chart", {}),
                        fetch_date=datetime.now(pytz.UTC),
                        is_synced=False
                    )

                    db.add(new_stats)
                    db.commit()
                    db.refresh(new_stats)

                    results.append(schemas.LibraryFetchStatus(
                        library_id=library_id,
                        library_name=display_name,
                        status="success",
                        success=True,
                        message="Fetched new data",
                        data=new_stats
                    ))
                    successful_fetches += 1

            except Exception as e:
                logger.error(f"Failed to fetch stats for library {library_id}: {str(e)}")
                results.append(schemas.LibraryFetchStatus(
                    library_id=library_id,
                    library_name=f"Library {library_id}",
                    status="error",
                    success=False,
                    message=f"Failed to fetch: {str(e)}",
                    error=str(e)
                ))
                failed_fetches += 1

        return schemas.BatchFetchResponse(
            success=successful_fetches > 0,
            message=f"Fetched stats for {successful_fetches}/{len(request.library_ids)} libraries",
            total_libraries=len(request.library_ids),
            successful_fetches=successful_fetches,
            failed_fetches=failed_fetches,
            skipped_fetches=skipped_fetches,
            results=results
        )

    except Exception as e:
        logger.error(f"Batch fetch error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))        


@app.post("/historical-stats/sync/", response_model=schemas.SyncResponse)
async def sync_historical_stats(request: schemas.SyncRequest, db: Session = Depends(get_db)):
    """
    Mark historical stats as synced to Libraries page
    IMPROVED: Better error messages and debugging
    """
    try:
        # IMPROVED: Debug logging to see what's being requested
        logger.info("="*60)
        logger.info("SYNC TO LIBRARIES PAGE - REQUEST RECEIVED")
        logger.info(f"Library IDs: {request.library_ids}")
        logger.info(f"Month: {request.month}")
        logger.info(f"Year: {request.year}")
        logger.info("="*60)
        
        results = []
        synced_libraries = 0
        failed_syncs = 0
        already_synced = 0

        # IMPROVED: Better query logic
        query = db.query(models.LibraryHistoricalStats)
        
        if request.library_ids:
            query = query.filter(
                models.LibraryHistoricalStats.library_id.in_(request.library_ids),
                models.LibraryHistoricalStats.month == request.month,
                models.LibraryHistoricalStats.year == request.year
            )
        else:
            # If no specific libraries, sync all unsynced stats for this month/year
            query = query.filter(
                models.LibraryHistoricalStats.month == request.month,
                models.LibraryHistoricalStats.year == request.year,
                models.LibraryHistoricalStats.is_synced == False
            )

        stats_to_sync = query.all()
        
        # IMPROVED: Better error message if nothing found
        if len(stats_to_sync) == 0:
            logger.warning("NO STATS FOUND TO SYNC!")
            
            # Check if data exists but with different month/year
            if request.library_ids:
                any_stats = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id.in_(request.library_ids)
                ).all()
                
                if len(any_stats) == 0:
                    error_msg = (
                        f"No stats found for libraries {request.library_ids}. "
                        "Please fetch stats first using the Fetch Stats page."
                    )
                    logger.error(error_msg)
                    raise HTTPException(status_code=404, detail=error_msg)
                else:
                    available_periods = list(set([(s.month, s.year) for s in any_stats]))
                    error_msg = (
                        f"No stats found for month={request.month}, year={request.year}. "
                        f"Available periods: {available_periods}. "
                        "Make sure you're syncing the same month/year you fetched."
                    )
                    logger.error(error_msg)
                    raise HTTPException(status_code=404, detail=error_msg)
            else:
                error_msg = (
                    f"No unsynced stats found for month={request.month}, year={request.year}. "
                    "Either stats haven't been fetched yet, or they're already synced."
                )
                logger.warning(error_msg)
                raise HTTPException(status_code=404, detail=error_msg)

        logger.info(f"Found {len(stats_to_sync)} stats to sync")

        # Process each stat
        for stats in stats_to_sync:
            try:
                # IMPROVED: Allow re-syncing (remove the skip for already synced)
                # Always sync, update timestamp
                stats.is_synced = True
                stats.sync_date = datetime.now(pytz.UTC)
                stats.updated_at = datetime.now(pytz.UTC)

                # IMPROVED: Ensure Teacher record exists with correct name
                try:
                    teacher = db.query(models.Teacher).filter(
                        models.Teacher.bunny_library_id == stats.library_id
                    ).first()
                    
                    # Get authoritative name from LibraryConfig
                    cfg = db.query(models.LibraryConfig).filter(
                        models.LibraryConfig.library_id == stats.library_id
                    ).first()
                    display_name = (
                        cfg.library_name if cfg and cfg.library_name 
                        else stats.library_name or f"Library {stats.library_id}"
                    )

                    if teacher:
                        # Update name if different
                        if teacher.name != display_name:
                            logger.info(f"Updating teacher name: {teacher.name} → {display_name}")
                            teacher.name = display_name
                    else:
                        # Create new teacher
                        logger.info(f"Creating new teacher: {display_name}")
                        teacher = models.Teacher(
                            name=display_name,
                            bunny_library_id=stats.library_id
                        )
                        db.add(teacher)
                        
                except Exception as teacher_err:
                    logger.error(f"Teacher upsert failed for library {stats.library_id}: {str(teacher_err)}")
                    # Continue anyway - sync will still work

                results.append(schemas.LibrarySyncStatus(
                    library_id=stats.library_id,
                    library_name=stats.library_name,
                    status="synced",
                    success=True,
                    message=f"Synced successfully - {stats.total_views} views, {stats.total_watch_time_seconds} seconds"
                ))
                synced_libraries += 1
                
                logger.info(f"✓ Synced library {stats.library_id}: {stats.library_name}")

            except Exception as e:
                logger.error(f"Failed to sync library {stats.library_id}: {str(e)}")
                results.append(schemas.LibrarySyncStatus(
                    library_id=stats.library_id,
                    library_name=stats.library_name,
                    status="error",
                    success=False,
                    message=f"Sync failed: {str(e)}",
                    error=str(e)
                ))
                failed_syncs += 1

        # Commit all changes
        db.commit()
        
        logger.info("="*60)
        logger.info("SYNC COMPLETE")
        logger.info(f"Successfully synced: {synced_libraries}")
        logger.info(f"Failed: {failed_syncs}")
        logger.info("="*60)

        return schemas.SyncResponse(
            success=synced_libraries > 0,
            message=f"Synced {synced_libraries} libraries to Libraries page",
            total_libraries=len(stats_to_sync),
            synced_libraries=synced_libraries,
            failed_syncs=failed_syncs,
            already_synced=already_synced,
            results=results
        )

    except HTTPException:
        # Re-raise HTTP exceptions (like 404 errors above)
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Sync error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@app.get("/historical-stats/libraries/", response_model=List[schemas.LibraryWithHistory])
async def get_libraries_with_history(
    with_stats_only: bool = False,
    db: Session = Depends(get_db)
):
    """
    Get all libraries with their historical statistics for Libraries page
    """
    try:
        # Get all unique libraries from historical stats
        libraries_query = db.query(
            models.LibraryHistoricalStats.library_id,
            models.LibraryHistoricalStats.library_name
        ).distinct()
        
        if with_stats_only:
            libraries_query = libraries_query.filter(models.LibraryHistoricalStats.is_synced == True)
        
        unique_libraries = libraries_query.all()
        
        # If no historical data exists, get from Bunny API
        if not unique_libraries and not with_stats_only:
            bunny_libraries = await get_bunny_libraries()
            result = []
            for lib in bunny_libraries:
                result.append(schemas.LibraryWithHistory(
                    library_id=lib.get("id"),
                    library_name=lib.get("name"),
                    has_stats=False,
                    monthly_data=[],
                    last_updated=None
                ))
            return result
        
        # Build a map of authoritative names from LibraryConfig
        config_names = {cfg.library_id: cfg.library_name for cfg in db.query(models.LibraryConfig).all()}

        result = []
        for lib_id, lib_name in unique_libraries:
            # Ensure a corresponding Teacher exists or has the correct display name
            try:
                teacher = db.query(models.Teacher).filter(models.Teacher.bunny_library_id == lib_id).first()
                cfg_name = config_names.get(lib_id)
                preferred_name = cfg_name if cfg_name else lib_name
                if teacher:
                    if preferred_name and teacher.name != preferred_name:
                        teacher.name = preferred_name
                else:
                    db.add(models.Teacher(name=preferred_name or f"Library {lib_id}", bunny_library_id=lib_id))
                # Flush updates now so subsequent queries see them
                db.flush()
            except Exception as upsert_err:
                logger.error(f"Teacher upsert during history retrieval failed for library {lib_id}: {str(upsert_err)}")
            # Get all monthly data for this library
            monthly_stats = db.query(models.LibraryHistoricalStats).filter(
                models.LibraryHistoricalStats.library_id == lib_id,
                models.LibraryHistoricalStats.is_synced == True if with_stats_only else True
            ).order_by(
                models.LibraryHistoricalStats.year.desc(),
                models.LibraryHistoricalStats.month.desc()
            ).all()
            
            monthly_data = []
            last_updated = None
            latest_name = lib_name
            
            for stats in monthly_stats:
                monthly_data.append(schemas.MonthlyData(
                    month=stats.month,
                    year=stats.year,
                    total_views=stats.total_views,
                    total_watch_time_seconds=stats.total_watch_time_seconds,
                    bandwidth_gb=stats.bandwidth_gb,
                    fetch_date=stats.fetch_date
                ))
                
                if not last_updated or stats.fetch_date > last_updated:
                    last_updated = stats.fetch_date
                    # Track the most recent name seen in synced stats
                    if stats.library_name:
                        latest_name = stats.library_name
            
            result.append(schemas.LibraryWithHistory(
                library_id=lib_id,
                library_name=config_names.get(lib_id) or latest_name or lib_name or f"Library {lib_id}",
                has_stats=len(monthly_data) > 0,
                monthly_data=monthly_data,
                last_updated=last_updated
            ))
        
        return result
        
    except Exception as e:
        logger.error(f"Get libraries with history error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
