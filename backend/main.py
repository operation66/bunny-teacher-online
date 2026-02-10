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

# MUST load env vars FIRST before anything else
load_dotenv()

import models
import schemas
import pytz
from database import engine, get_db, SessionLocal
from bunny_service import get_bunny_stats, get_bunny_libraries, get_library_monthly_stats

from financial_models import (
    Stage, Section, Subject, StageSectionSubject,
    TeacherAssignment, FinancialPeriod, SectionRevenue, TeacherPayment,
    Base as FinancialBase
)
from financial_schemas import (
    Stage as StageSchema, StageCreate, StageUpdate,
    Section as SectionSchema, SectionCreate,
    Subject as SubjectSchema, SubjectCreate,
    TeacherAssignment as TeacherAssignmentSchema,
    TeacherAssignmentCreate, TeacherAssignmentUpdate,
    TeacherAssignmentWithDetails,
    AutoMatchResponse, AutoMatchResult,
    FinancialPeriod as FinancialPeriodSchema,
    FinancialPeriodCreate, FinancialPeriodUpdate,
    SectionRevenue as SectionRevenueSchema,
    SectionRevenueCreate, SectionRevenueUpdate,
    SectionRevenueWithDetails,
    TeacherPaymentWithDetails,
    FinancialData,
    CalculatePaymentsRequest,
    CalculatePaymentsResponse
)
from financial_utils import parse_library_name, calculate_teacher_payment, calculate_section_order_percentages

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create ALL database tables on startup - BEFORE app is created
try:
    logger.info("Creating main database tables...")
    models.Base.metadata.create_all(bind=engine)
    logger.info("✅ Main tables created")
except Exception as e:
    logger.error(f"❌ Failed to create main tables: {e}")

try:
    logger.info("Creating financial database tables...")
    FinancialBase.metadata.create_all(bind=engine)
    logger.info("✅ Financial tables created")
except Exception as e:
    logger.error(f"❌ Failed to create financial tables: {e}")

# Create FastAPI app
app = FastAPI(title="Elkheta Teacher Performance Dashboard")

# CORS - hardcoded + env var
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://bunny-teacher-online.onrender.com",
    "https://bunny-teacher-online.vercel.app",
]
extra = os.getenv("ALLOWED_ORIGINS", "")
if extra:
    allowed_origins += [o.strip() for o in extra.split(",") if o.strip()]

logger.info(f"CORS allowed origins: {allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?:\/\/(localhost|127\.0\.0\.1|\S+\.vercel\.app|\S+\.onrender\.com)(:\d+)?$",
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

@app.put("/library-configs/{library_id}", response_model=schemas.LibraryConfig)
def update_library_config(
    library_id: int, 
    config: schemas.LibraryConfigUpdate, 
    db: Session = Depends(get_db)
):
    """Update library configuration"""
    
    # Get existing config
    db_config = db.query(models.LibraryConfig).filter(
        models.LibraryConfig.library_id == library_id
    ).first()
    
    if not db_config:
        raise HTTPException(
            status_code=404, 
            detail=f"Library configuration not found for library_id {library_id}"
        )
    
    # CRITICAL: Log what we're receiving (for debugging)
    logger.info("="*60)
    logger.info(f"UPDATE CONFIG - Library ID: {library_id}")
    
    # Update only provided fields
    update_data = config.dict(exclude_unset=True)
    
    for field, value in update_data.items():
        if field == "stream_api_key" and value:
            logger.info(f"Received API Key Length: {len(value)}")
            logger.info(f"Received API Key First 10 chars: {value[:10]}")
            logger.info(f"Received API Key Last 10 chars: {value[-10:]}")
        
        # Save EXACTLY as received - NO MODIFICATION
        setattr(db_config, field, value)
    
    # Update timestamp
    db_config.updated_at = datetime.utcnow()
    
    # Commit and refresh
    db.commit()
    db.refresh(db_config)
    
    # CRITICAL: Verify what was actually saved
    if 'stream_api_key' in update_data:
        saved_key = db_config.stream_api_key
        original_key = update_data['stream_api_key']
        
        logger.info(f"Saved API Key Length: {len(saved_key) if saved_key else 0}")
        logger.info(f"Keys Match: {original_key == saved_key}")
        
        if original_key != saved_key:
            logger.error("⚠️ API KEY MISMATCH!")
            logger.error(f"Expected: {original_key}")
            logger.error(f"Got: {saved_key}")
            raise HTTPException(
                status_code=500,
                detail="API key was not saved correctly"
            )
    
    logger.info("="*60)
    
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
# ============================================
# ============================================
# STAGE ENDPOINTS
# ============================================

@app.get("/stages/")
def get_stages(db: Session = Depends(get_db)):
    """Get all stages"""
    stages = db.query(Stage).order_by(Stage.display_order).all()
    return [
        {
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "display_order": s.display_order,
            "created_at": s.created_at.isoformat() if s.created_at else None
        }
        for s in stages
    ]

@app.post("/stages/")
def create_stage(stage: StageCreate, db: Session = Depends(get_db)):
    """Create a new stage"""
    try:
        logger.info(f"Creating stage with data: {stage.dict()}")
        
        existing = db.query(Stage).filter(Stage.code == stage.code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Stage with code {stage.code} already exists")
        
        db_stage = Stage(**stage.dict())
        db.add(db_stage)
        db.commit()
        db.refresh(db_stage)
        
        logger.info(f"Stage created successfully: {db_stage.id}")
        
        # Return plain dict instead of ORM object to avoid serialization error
        return {
            "id": db_stage.id,
            "code": db_stage.code,
            "name": db_stage.name,
            "display_order": db_stage.display_order,
            "created_at": db_stage.created_at.isoformat() if db_stage.created_at else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating stage: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create stage: {str(e)}")
        
@app.put("/stages/{stage_id}", response_model=StageSchema)
def update_stage(stage_id: int, stage: StageUpdate, db: Session = Depends(get_db)):
    """Update a stage"""
    db_stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not db_stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    
    for field, value in stage.dict(exclude_unset=True).items():
        setattr(db_stage, field, value)
    
    db.commit()
    db.refresh(db_stage)
    return db_stage

@app.delete("/stages/{stage_id}")
def delete_stage(stage_id: int, db: Session = Depends(get_db)):
    """Delete a stage"""
    db_stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not db_stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    
    db.delete(db_stage)
    db.commit()
    return {"message": "Stage deleted successfully"}

# ============================================
# SECTION ENDPOINTS
# ============================================

@app.get("/sections/")
def get_sections(stage_id: int = None, db: Session = Depends(get_db)):
    query = db.query(Section)
    if stage_id:
        query = query.filter(Section.stage_id == stage_id)
    sections = query.all()
    return [
        {
            "id": s.id,
            "stage_id": s.stage_id,
            "code": s.code,
            "name": s.name,
            "created_at": s.created_at.isoformat() if s.created_at else None
        }
        for s in sections
    ]

@app.post("/sections/")
def create_section(section: SectionCreate, db: Session = Depends(get_db)):
    """Create a new section"""
    try:
        db_section = Section(**section.dict())
        db.add(db_section)
        db.commit()
        db.refresh(db_section)
        return {
            "id": db_section.id,
            "stage_id": db_section.stage_id,
            "code": db_section.code,
            "name": db_section.name,
            "created_at": db_section.created_at.isoformat() if db_section.created_at else None
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/sections/{section_id}")
def delete_section(section_id: int, db: Session = Depends(get_db)):
    """Delete a section"""
    db_section = db.query(Section).filter(Section.id == section_id).first()
    if not db_section:
        raise HTTPException(status_code=404, detail="Section not found")
    
    db.delete(db_section)
    db.commit()
    return {"message": "Section deleted successfully"}

# ============================================
# SUBJECT ENDPOINTS
# ============================================

@app.get("/subjects/")
def get_subjects(db: Session = Depends(get_db)):
    subjects = db.query(Subject).all()
    return [
        {
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "is_common": s.is_common,
            "created_at": s.created_at.isoformat() if s.created_at else None
        }
        for s in subjects
    ]

@app.post("/subjects/")
def create_subject(subject: SubjectCreate, db: Session = Depends(get_db)):
    try:
        existing = db.query(Subject).filter(Subject.code == subject.code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Subject with code {subject.code} already exists")
        db_subject = Subject(**subject.dict())
        db.add(db_subject)
        db.commit()
        db.refresh(db_subject)
        return {
            "id": db_subject.id,
            "code": db_subject.code,
            "name": db_subject.name,
            "is_common": db_subject.is_common,
            "created_at": db_subject.created_at.isoformat() if db_subject.created_at else None
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/subjects/{subject_id}")
def delete_subject(subject_id: int, db: Session = Depends(get_db)):
    """Delete a subject"""
    db_subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not db_subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    db.delete(db_subject)
    db.commit()
    return {"message": "Subject deleted successfully"}

# ============================================
# TEACHER ASSIGNMENT ENDPOINTS
# ============================================

@app.get("/teacher-assignments/", response_model=List[TeacherAssignmentWithDetails])
def get_teacher_assignments(
    stage_id: int = None,
    db: Session = Depends(get_db)
):
    """Get all teacher assignments with details"""
    query = db.query(TeacherAssignment)
    if stage_id:
        query = query.filter(TeacherAssignment.stage_id == stage_id)
    
    assignments = query.all()
    
    # Add details
    result = []
    for assignment in assignments:
        stage = db.query(Stage).filter(Stage.id == assignment.stage_id).first()
        section = db.query(Section).filter(Section.id == assignment.section_id).first() if assignment.section_id else None
        subject = db.query(Subject).filter(Subject.id == assignment.subject_id).first()
        
        assignment_dict = {
            **assignment.__dict__,
            "stage_name": stage.name if stage else None,
            "section_name": section.name if section else None,
            "subject_name": subject.name if subject else None,
            "subject_is_common": subject.is_common if subject else None
        }
        result.append(TeacherAssignmentWithDetails(**assignment_dict))
    
    return result

@app.post("/teacher-assignments/", response_model=TeacherAssignmentSchema)
def create_teacher_assignment(
    assignment: TeacherAssignmentCreate,
    db: Session = Depends(get_db)
):
    """Create a new teacher assignment"""
    db_assignment = TeacherAssignment(**assignment.dict())
    db.add(db_assignment)
    db.commit()
    db.refresh(db_assignment)
    return db_assignment

@app.put("/teacher-assignments/{assignment_id}", response_model=TeacherAssignmentSchema)
def update_teacher_assignment(
    assignment_id: int,
    assignment: TeacherAssignmentUpdate,
    db: Session = Depends(get_db)
):
    """Update teacher assignment (tax rate, revenue percentage)"""
    db_assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not db_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    for field, value in assignment.dict(exclude_unset=True).items():
        setattr(db_assignment, field, value)
    
    db_assignment.updated_at = datetime.now(pytz.UTC)
    db.commit()
    db.refresh(db_assignment)
    return db_assignment

@app.delete("/teacher-assignments/{assignment_id}")
def delete_teacher_assignment(assignment_id: int, db: Session = Depends(get_db)):
    """Delete a teacher assignment"""
    db_assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not db_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    db.delete(db_assignment)
    db.commit()
    return {"message": "Assignment deleted successfully"}

@app.post("/teacher-assignments/auto-match", response_model=AutoMatchResponse)
async def auto_match_teachers(db: Session = Depends(get_db)):
    """Auto-match teachers to subjects based on library names"""
    try:
        # Get all libraries
        libraries = await get_bunny_libraries()
        
        # Get all stages, subjects
        stages = {s.code: s for s in db.query(Stage).all()}
        subjects = {s.code: s for s in db.query(Subject).all()}
        sections = {(sec.stage_id, sec.code): sec for sec in db.query(Section).all()}
        
        results = []
        matched_count = 0
        
        for lib in libraries:
            lib_id = lib.get("id")
            lib_name = lib.get("name")
            
            # Parse library name
            stage_code, section_code, subject_code = parse_library_name(lib_name)
            
            # Try to match
            if not stage_code or not subject_code:
                results.append(AutoMatchResult(
                    library_id=lib_id,
                    library_name=lib_name,
                    stage_code=stage_code,
                    section_code=section_code,
                    subject_code=subject_code,
                    matched=False,
                    message="Could not parse library name"
                ))
                continue
            
            # Find stage
            stage = stages.get(stage_code)
            if not stage:
                results.append(AutoMatchResult(
                    library_id=lib_id,
                    library_name=lib_name,
                    stage_code=stage_code,
                    section_code=section_code,
                    subject_code=subject_code,
                    matched=False,
                    message=f"Stage {stage_code} not found"
                ))
                continue
            
            # Find subject
            subject = subjects.get(subject_code)
            if not subject:
                results.append(AutoMatchResult(
                    library_id=lib_id,
                    library_name=lib_name,
                    stage_code=stage_code,
                    section_code=section_code,
                    subject_code=subject_code,
                    matched=False,
                    message=f"Subject {subject_code} not found"
                ))
                continue
            
            # Find section (if section-specific subject)
            section = None
            if section_code and not subject.is_common:
                section = sections.get((stage.id, section_code))
                if not section:
                    results.append(AutoMatchResult(
                        library_id=lib_id,
                        library_name=lib_name,
                        stage_code=stage_code,
                        section_code=section_code,
                        subject_code=subject_code,
                        matched=False,
                        message=f"Section {section_code} not found for stage {stage_code}"
                    ))
                    continue
            
            # Check if assignment already exists
            existing = db.query(TeacherAssignment).filter(
                TeacherAssignment.library_id == lib_id,
                TeacherAssignment.stage_id == stage.id,
                TeacherAssignment.subject_id == subject.id
            ).first()
            
            if existing:
                results.append(AutoMatchResult(
                    library_id=lib_id,
                    library_name=lib_name,
                    stage_code=stage_code,
                    section_code=section_code,
                    subject_code=subject_code,
                    matched=True,
                    message="Already assigned"
                ))
                matched_count += 1
                continue
            
            # Create assignment
            assignment = TeacherAssignment(
                library_id=lib_id,
                library_name=lib_name,
                stage_id=stage.id,
                section_id=section.id if section else None,
                subject_id=subject.id,
                tax_rate=0.0,
                revenue_percentage=1.0
            )
            db.add(assignment)
            
            results.append(AutoMatchResult(
                library_id=lib_id,
                library_name=lib_name,
                stage_code=stage_code,
                section_code=section_code,
                subject_code=subject_code,
                matched=True,
                message="Successfully matched"
            ))
            matched_count += 1
        
        db.commit()
        
        return AutoMatchResponse(
            total_libraries=len(libraries),
            matched=matched_count,
            unmatched=len(libraries) - matched_count,
            results=results
        )
    
    except Exception as e:
        db.rollback()
        logger.error(f"Auto-match error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# FINANCIAL PERIOD ENDPOINTS
# ============================================

@app.get("/financial-periods/", response_model=List[FinancialPeriodSchema])
def get_financial_periods(db: Session = Depends(get_db)):
    """Get all financial periods"""
    return db.query(FinancialPeriod).order_by(FinancialPeriod.year.desc(), FinancialPeriod.created_at.desc()).all()

@app.post("/financial-periods/", response_model=FinancialPeriodSchema)
def create_financial_period(period: FinancialPeriodCreate, db: Session = Depends(get_db)):
    """Create a new financial period"""
    # Check if name already exists
    existing = db.query(FinancialPeriod).filter(FinancialPeriod.name == period.name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Period with name '{period.name}' already exists")
    
    db_period = FinancialPeriod(**period.dict())
    db.add(db_period)
    db.commit()
    db.refresh(db_period)
    return db_period

@app.put("/financial-periods/{period_id}", response_model=FinancialPeriodSchema)
def update_financial_period(
    period_id: int,
    period: FinancialPeriodUpdate,
    db: Session = Depends(get_db)
):
    """Update a financial period"""
    db_period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
    if not db_period:
        raise HTTPException(status_code=404, detail="Period not found")
    
    for field, value in period.dict(exclude_unset=True).items():
        setattr(db_period, field, value)
    
    db.commit()
    db.refresh(db_period)
    return db_period

@app.delete("/financial-periods/{period_id}")
def delete_financial_period(period_id: int, db: Session = Depends(get_db)):
    """Delete a financial period"""
    db_period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
    if not db_period:
        raise HTTPException(status_code=404, detail="Period not found")
    
    db.delete(db_period)
    db.commit()
    return {"message": "Period deleted successfully"}

# ============================================
# SECTION REVENUE ENDPOINTS
# ============================================

@app.post("/section-revenues/", response_model=SectionRevenueSchema)
def create_or_update_section_revenue(
    revenue: SectionRevenueCreate,
    db: Session = Depends(get_db)
):
    """Create or update section revenue"""
    # Check if already exists
    existing = db.query(SectionRevenue).filter(
        SectionRevenue.period_id == revenue.period_id,
        SectionRevenue.stage_id == revenue.stage_id,
        SectionRevenue.section_id == revenue.section_id
    ).first()
    
    if existing:
        # Update
        existing.total_orders = revenue.total_orders
        existing.total_revenue_egp = revenue.total_revenue_egp
        existing.updated_at = datetime.now(pytz.UTC)
        db.commit()
        db.refresh(existing)
        return existing
    else:
        # Create
        db_revenue = SectionRevenue(**revenue.dict())
        db.add(db_revenue)
        db.commit()
        db.refresh(db_revenue)
        return db_revenue

# ============================================
# FINANCIAL DATA & CALCULATION ENDPOINTS
# ============================================

@app.get("/financials/{period_id}/{stage_id}", response_model=FinancialData)
def get_financial_data(
    period_id: int,
    stage_id: int,
    db: Session = Depends(get_db)
):
    """Get all financial data for a period and stage"""
    # Get period
    period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
    if not period:
        raise HTTPException(status_code=404, detail="Period not found")
    
    # Get stage
    stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    
    # Get sections for this stage
    sections = db.query(Section).filter(Section.stage_id == stage_id).all()
    
    # Get section revenues
    section_revenues = db.query(SectionRevenue).filter(
        SectionRevenue.period_id == period_id,
        SectionRevenue.stage_id == stage_id
    ).all()
    
    section_revenues_with_details = []
    for rev in section_revenues:
        section = db.query(Section).filter(Section.id == rev.section_id).first()
        rev_dict = {
            **rev.__dict__,
            "stage_name": stage.name,
            "section_name": section.name if section else None
        }
        section_revenues_with_details.append(SectionRevenueWithDetails(**rev_dict))
    
    # Get teacher assignments for this stage
    assignments = db.query(TeacherAssignment).filter(
        TeacherAssignment.stage_id == stage_id
    ).all()
    
    assignments_with_details = []
    for assignment in assignments:
        section = db.query(Section).filter(Section.id == assignment.section_id).first() if assignment.section_id else None
        subject = db.query(Subject).filter(Subject.id == assignment.subject_id).first()
        
        assignment_dict = {
            **assignment.__dict__,
            "stage_name": stage.name,
            "section_name": section.name if section else None,
            "subject_name": subject.name if subject else None,
            "subject_is_common": subject.is_common if subject else None
        }
        assignments_with_details.append(TeacherAssignmentWithDetails(**assignment_dict))
    
    # Get teacher payments
    payments = db.query(TeacherPayment).filter(
        TeacherPayment.period_id == period_id,
        TeacherPayment.stage_id == stage_id
    ).all()
    
    payments_with_details = []
    for payment in payments:
        section = db.query(Section).filter(Section.id == payment.section_id).first()
        subject = db.query(Subject).filter(Subject.id == payment.subject_id).first()
        
        payment_dict = {
            **payment.__dict__,
            "stage_name": stage.name,
            "section_name": section.name if section else None,
            "subject_name": subject.name if subject else None,
            "subject_is_common": subject.is_common if subject else None
        }
        payments_with_details.append(TeacherPaymentWithDetails(**payment_dict))
    
    return FinancialData(
        period=period,
        stage=stage,
        sections=sections,
        section_revenues=section_revenues_with_details,
        teacher_assignments=assignments_with_details,
        teacher_payments=payments_with_details
    )

@app.post("/calculate-payments/{period_id}/{stage_id}", response_model=CalculatePaymentsResponse)
async def calculate_payments(
    period_id: int,
    stage_id: int,
    db: Session = Depends(get_db)
):
    """Calculate teacher payments for a period and stage"""
    try:
        # Get period and stage
        period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not period:
            raise HTTPException(status_code=404, detail="Period not found")
        
        stage = db.query(Stage).filter(Stage.id == stage_id).first()
        if not stage:
            raise HTTPException(status_code=404, detail="Stage not found")
        
        # Get section revenues
        section_revenues = db.query(SectionRevenue).filter(
            SectionRevenue.period_id == period_id,
            SectionRevenue.stage_id == stage_id
        ).all()
        
        if not section_revenues:
            raise HTTPException(
                status_code=400,
                detail="No revenue data found. Please add revenue data first."
            )
        
        # Calculate section order percentages
        sections_data = [
            {"section_id": rev.section_id, "total_orders": rev.total_orders}
            for rev in section_revenues
        ]
        section_order_percentages = calculate_section_order_percentages(sections_data)
        
        # Get teacher assignments for this stage
        assignments = db.query(TeacherAssignment).filter(
            TeacherAssignment.stage_id == stage_id
        ).all()
        
        if not assignments:
            raise HTTPException(
                status_code=400,
                detail="No teacher assignments found. Please assign teachers first."
            )
        
        # Delete existing payments for this period/stage
        db.query(TeacherPayment).filter(
            TeacherPayment.period_id == period_id,
            TeacherPayment.stage_id == stage_id
        ).delete()
        
        # Get watch time data from historical stats
        # Map library_id to total watch time
        watch_time_map = {}
        for assignment in assignments:
            # Get total watch time from library_historical_stats
            stats = db.query(models.LibraryHistoricalStats).filter(
                models.LibraryHistoricalStats.library_id == assignment.library_id,
                models.LibraryHistoricalStats.year == period.year
            ).all()
            
            total_watch_time = sum(s.total_watch_time_seconds for s in stats)
            watch_time_map[assignment.library_id] = total_watch_time
        
        # Calculate payments
        payments_created = []
        total_payment_sum = 0.0
        
        for revenue in section_revenues:
            section = db.query(Section).filter(Section.id == revenue.section_id).first()
            
            # Get assignments for this section
            section_assignments = [
                a for a in assignments
                if (a.section_id == revenue.section_id) or  # Section-specific
                   (a.section_id is None)  # Common subject
            ]
            
            # Calculate total watch time for this section
            total_section_watch_time = sum(
                watch_time_map.get(a.library_id, 0)
                for a in section_assignments
            )
            
            for assignment in section_assignments:
                teacher_watch_time = watch_time_map.get(assignment.library_id, 0)
                
                # Get subject to check if common
                subject = db.query(Subject).filter(Subject.id == assignment.subject_id).first()
                
                # Calculate section order percentage (for common subjects)
                section_order_pct = 1.0
                if subject and subject.is_common:
                    section_order_pct = section_order_percentages.get(revenue.section_id, 1.0)
                
                # Calculate payment
                payment_calc = calculate_teacher_payment(
                    section_revenue=revenue.total_revenue_egp,
                    teacher_watch_time_seconds=teacher_watch_time,
                    total_section_watch_time_seconds=total_section_watch_time,
                    revenue_percentage=assignment.revenue_percentage,
                    tax_rate=assignment.tax_rate,
                    section_order_percentage=section_order_pct
                )
                
                # Create payment record
                payment = TeacherPayment(
                    period_id=period_id,
                    assignment_id=assignment.id,
                    library_id=assignment.library_id,
                    library_name=assignment.library_name,
                    stage_id=stage_id,
                    section_id=revenue.section_id,
                    subject_id=assignment.subject_id,
                    total_watch_time_seconds=teacher_watch_time,
                    watch_time_percentage=payment_calc['watch_time_percentage'],
                    section_total_orders=revenue.total_orders,
                    section_order_percentage=payment_calc['section_order_percentage'],
                    base_revenue=payment_calc['base_revenue'],
                    revenue_percentage_applied=payment_calc['revenue_percentage_applied'],
                    calculated_revenue=payment_calc['calculated_revenue'],
                    tax_rate_applied=payment_calc['tax_rate_applied'],
                    tax_amount=payment_calc['tax_amount'],
                    final_payment=payment_calc['final_payment']
                )
                db.add(payment)
                payments_created.append(payment)
                total_payment_sum += payment.final_payment
        
        db.commit()
        
        # Get payments with details
        payments_with_details = []
        for payment in payments_created:
            db.refresh(payment)
            section = db.query(Section).filter(Section.id == payment.section_id).first()
            subject = db.query(Subject).filter(Subject.id == payment.subject_id).first()
            
            payment_dict = {
                **payment.__dict__,
                "stage_name": stage.name,
                "section_name": section.name if section else None,
                "subject_name": subject.name if subject else None,
                "subject_is_common": subject.is_common if subject else None
            }
            payments_with_details.append(TeacherPaymentWithDetails(**payment_dict))
        
        return CalculatePaymentsResponse(
            success=True,
            message=f"Successfully calculated payments for {len(payments_created)} teachers",
            payments_calculated=len(payments_created),
            total_payment=total_payment_sum,
            payments=payments_with_details
        )
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Payment calculation error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/teacher-payments/{period_id}", response_model=List[TeacherPaymentWithDetails])
def get_teacher_payments(period_id: int, db: Session = Depends(get_db)):
    """Get all teacher payments for a period"""
    payments = db.query(TeacherPayment).filter(
        TeacherPayment.period_id == period_id
    ).all()
    
    payments_with_details = []
    for payment in payments:
        stage = db.query(Stage).filter(Stage.id == payment.stage_id).first()
        section = db.query(Section).filter(Section.id == payment.section_id).first()
        subject = db.query(Subject).filter(Subject.id == payment.subject_id).first()
        
        payment_dict = {
            **payment.__dict__,
            "stage_name": stage.name if stage else None,
            "section_name": section.name if section else None,
            "subject_name": subject.name if subject else None,
            "subject_is_common": subject.is_common if subject else None
        }
        payments_with_details.append(TeacherPaymentWithDetails(**payment_dict))
    
    return payments_with_details
