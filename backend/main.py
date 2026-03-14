from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile, Form
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import logging
from passlib.context import CryptContext
from jose import jwt, JWTError
from fastapi.security import OAuth2PasswordBearer
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
    TeacherProfile as TeacherProfileModel, CalculationAudit, PaymentFinalization,
    LibraryExclusion,
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
    CalculatePaymentsResponse,
    TeacherProfile as TeacherProfileSchema,
    TeacherProfileCreate, TeacherProfileUpdate,
    AutoLinkResponse, UnlinkedAssignment,
    CalculationAuditSummary, AcknowledgeAuditRequest,
    FinalizationPreviewResponse, FinalizationPreviewRow,
    SubmitFinalizationRequest, FinalizationRecord,
    ReportConfig, ReportResponse, ReportRow, ReportColumnConfig,
    DashboardSummaryResponse, DashboardKPIs, PeriodStageCell,
    TeacherRankingRow, DashboardComparisonRequest, DashboardComparisonResponse,
    DashboardComparisonRow,
)
from financial_utils import parse_library_name, calculate_teacher_payment, calculate_section_order_percentages

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create ALL database tables on startup
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

try:
    logger.info("Checking for missing columns in financial tables...")
    from sqlalchemy import text as sql_text

    with engine.begin() as conn:
        result = conn.execute(sql_text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='financial_periods' AND column_name='months'"
        )).fetchone()
        if not result:
            logger.info("Adding 'months' column to financial_periods...")
            conn.execute(sql_text("ALTER TABLE financial_periods ADD COLUMN months JSON"))
            logger.info("✅ Added months column")

        result = conn.execute(sql_text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='teacher_payments' AND column_name='monthly_watch_breakdown'"
        )).fetchone()
        if not result:
            logger.info("Adding 'monthly_watch_breakdown' column to teacher_payments...")
            conn.execute(sql_text("ALTER TABLE teacher_payments ADD COLUMN monthly_watch_breakdown JSON"))
            logger.info("✅ Added monthly_watch_breakdown column")

        result = conn.execute(sql_text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='users' AND column_name='token_version'"
        )).fetchone()
        if not result:
            logger.info("Adding 'token_version' column to users...")
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1"))
            logger.info("✅ Added token_version column")

        result = conn.execute(sql_text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='teacher_assignments' AND column_name='teacher_profile_id'"
        )).fetchone()
        if not result:
            logger.info("Adding 'teacher_profile_id' column to teacher_assignments...")
            conn.execute(sql_text(
                "ALTER TABLE teacher_assignments ADD COLUMN teacher_profile_id INTEGER "
                "REFERENCES teacher_profiles(id) ON DELETE SET NULL"
            ))
            logger.info("✅ Added teacher_profile_id column")

result = conn.execute(sql_text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='teacher_assignments' AND column_name='updated_at'"
        )).fetchone()
        if not result:
            logger.info("Adding 'updated_at' column to teacher_assignments...")
            conn.execute(sql_text(
                "ALTER TABLE teacher_assignments ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE"
            ))
            logger.info("✅ Added teacher_assignments.updated_at column")

        # library_exclusions table
        result = conn.execute(sql_text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_name='library_exclusions'"
        )).fetchone()
        if not result:
            logger.info("Creating library_exclusions table...")
            conn.execute(sql_text("""
                CREATE TABLE library_exclusions (
                    id SERIAL PRIMARY KEY,
                    period_id INTEGER NOT NULL REFERENCES financial_periods(id) ON DELETE CASCADE,
                    stage_id  INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
                    library_id INTEGER NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    CONSTRAINT uq_exclusion UNIQUE (period_id, stage_id, library_id)
                )
            """))
            logger.info("✅ Created library_exclusions table")

    logger.info("✅ Financial table migrations complete")
    
except Exception as e:
    logger.error(f"❌ Migration error (non-fatal): {e}")

# Create FastAPI app
app = FastAPI(title="Elkheta Teacher Performance Dashboard")

@app.on_event("startup")
async def startup_event():
    try:
        logger.info("🚀 Startup: Pre-warming Bunny libraries cache...")
        libs = await get_bunny_libraries()
        logger.info(f"✅ Startup cache ready: {len(libs)} libraries loaded")
    except Exception as e:
        logger.warning(f"⚠️ Startup cache pre-warm failed (non-fatal): {e}")
        
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi
    schema = get_openapi(title=app.title, version="0.1.0", routes=app.routes)
    schema["components"]["securitySchemes"] = {
        "BearerAuth": {"type": "http", "scheme": "bearer"}
    }
    for path in schema["paths"].values():
        for method in path.values():
            method["security"] = [{"BearerAuth": []}]
    app.openapi_schema = schema
    return schema

app.openapi = custom_openapi

# CORS
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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ============================================
# USERS AND AUTHENTICATION
# ============================================

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)
# JWT Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def create_access_token_for_user(user: models.User):
    return create_access_token(data={
        "sub": str(user.id),
        "ver": user.token_version
    })
    
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        token_ver = payload.get("ver")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise credentials_exception
    # If token has a version, validate it matches current
    if token_ver is not None and user.token_version != token_ver:
        raise credentials_exception
    return user
    
def hash_password(password: str) -> str:
    import bcrypt
    raw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode("utf-8")
    
def verify_password(password: str, password_hash: str) -> bool:
    try:
        import bcrypt
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        try:
            return _pwd_context.verify(password, password_hash)
        except Exception:
            return False

# ============================================
# TEACHERS
# ============================================

@app.post("/teachers/upsert-from-bunny/", response_model=schemas.UpsertTeachersResponse)
async def upsert_teachers_from_bunny(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        libraries = await get_bunny_libraries()

        if not libraries:
            config_items = db.query(models.LibraryConfig).all()
            libraries = [{"id": cfg.library_id, "name": cfg.library_name} for cfg in config_items]

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
                    bunny_library_id=lib_id, name=display_name,
                    action=action, success=True, message="OK"
                ))
            except Exception as e:
                logger.error(f"Teacher upsert failed for library {lib_id}: {str(e)}")
                failed += 1
                results.append(schemas.UpsertResult(
                    bunny_library_id=lib_id, name=display_name,
                    action="error", success=False,
                    message=f"Failed to upsert library {lib_id}", error=str(e)
                ))

        db.commit()

        return schemas.UpsertTeachersResponse(
            success=True, total_libraries=len(libraries),
            created=created, updated=updated, unchanged=unchanged, failed=failed, results=results
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Error upserting teachers from Bunny libraries: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


@app.get("/teachers/", response_model=List[schemas.Teacher])
def read_teachers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Teacher).offset(skip).limit(limit).all()


@app.get("/teachers/{teacher_id}", response_model=schemas.Teacher)
def read_teacher(teacher_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if db_teacher is None:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return db_teacher


@app.get("/teachers/{teacher_id}/monthly-stats", response_model=List[schemas.MonthlyStats])
def get_teacher_monthly_stats(teacher_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if db_teacher is None:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return db.query(models.MonthlyStats).filter(
        models.MonthlyStats.teacher_id == teacher_id
    ).order_by(models.MonthlyStats.year.desc(), models.MonthlyStats.month.desc()).all()


# ============================================
# BUNNY LIBRARIES
# ============================================

@app.get("/bunny-libraries/", response_model=List[schemas.BunnyLibrary])
async def fetch_bunny_libraries(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        libraries = await get_bunny_libraries()
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
            formatted_libraries.append({"id": lib_id, "name": lib_name, "video_views": 0, "total_watch_time_seconds": 0})

        if not formatted_libraries:
            logger.warning("Bunny.net API unavailable, returning empty list")
            return []
        return formatted_libraries

    except Exception as e:
        logger.error(f"Error in fetch_bunny_libraries: {str(e)}")
        return []

@app.post("/bunny-libraries/sync-stats/")
async def sync_library_stats(request: dict, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        library_ids = request.get("library_ids", [])
        month = request.get("month", datetime.now().month)
        year = request.get("year", datetime.now().year)

        if not library_ids:
            raise HTTPException(status_code=400, detail="No library IDs provided")

        synced_libraries = []

        for library_id in library_ids:
            try:
                stats_data = await get_library_monthly_stats(library_id, month, year, db)
                if not stats_data or "error" in stats_data:
                    logger.error(f"Failed to get stats for library {library_id} - skipping")
                    continue

                views = stats_data.get("total_views", 0)
                watch_time_seconds = stats_data.get("total_watch_time_seconds", 0)
                last_updated = stats_data.get("last_updated")

                teacher = db.query(models.Teacher).filter(models.Teacher.bunny_library_id == library_id).first()
                if not teacher:
                    cfg = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
                    display_name = (cfg.library_name if cfg and cfg.library_name else f"Library {library_id}")
                    teacher = models.Teacher(name=display_name, bunny_library_id=library_id)
                    db.add(teacher)
                    db.flush()   # assigns the ID without committing

                existing_stat = db.query(models.MonthlyStats).filter(
                    models.MonthlyStats.teacher_id == teacher.id,
                    models.MonthlyStats.month == month,
                    models.MonthlyStats.year == year
                ).first()

                if existing_stat:
                    existing_stat.video_views = views
                    existing_stat.total_watch_time_seconds = watch_time_seconds
                else:
                    db.add(models.MonthlyStats(
                        teacher_id=teacher.id, month=month, year=year,
                        video_views=views, total_watch_time_seconds=watch_time_seconds
                    ))

                synced_libraries.append({"library_id": library_id, "views": views,
                                         "watch_time_seconds": watch_time_seconds, "last_updated": last_updated})
            except Exception as e:
                logger.error(f"Error syncing stats for library {library_id}: {str(e)}")
                continue

        db.commit()
        return {"message": f"Successfully synced statistics for {len(synced_libraries)} libraries",
                "count": len(synced_libraries), "synced_libraries": synced_libraries}

    except Exception as e:
        db.rollback()
        logger.error(f"Error in sync_library_stats: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")

@app.post("/bunny-libraries/raw-api-response/")
async def get_raw_api_response(request: dict, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        library_id = request.get("library_id")
        start_date = request.get("start_date")
        end_date = request.get("end_date")

        if not library_id or not start_date or not end_date:
            raise HTTPException(status_code=400, detail="Missing required parameters")

        import httpx
        BUNNY_STREAM_API_KEY = os.getenv("BUNNY_STREAM_API_KEY")
        if not BUNNY_STREAM_API_KEY:
            raise HTTPException(status_code=500, detail="API key not configured")

        headers = {"AccessKey": BUNNY_STREAM_API_KEY, "Content-Type": "application/json"}
        params = {"dateFrom": start_date, "dateTo": end_date, "hourly": "false"}

        async with httpx.AsyncClient(verify=True, timeout=30.0) as client:
            response = await client.get(
                f"https://video.bunnycdn.com/library/{library_id}/statistics",
                headers=headers, params=params
            )
            if response.status_code == 200:
                return response.json()
            else:
                raise HTTPException(status_code=response.status_code, detail=response.text)

    except Exception as e:
        logger.error(f"Error getting raw API response: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")



@app.get("/users/", response_model=List[schemas.User])
def get_users(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.User).all()


@app.post("/users/", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    existing = db.query(models.User).filter(models.User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    db_user = models.User(
        email=user.email, password_hash=hash_password(user.password),
        allowed_pages=user.allowed_pages,
        is_active=user.is_active if user.is_active is not None else True,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@app.put("/users/{user_id}", response_model=schemas.User)
def update_user(user_id: int, update: schemas.UserUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if update.email is not None:
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
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
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
        
    access_token = create_access_token_for_user(user)
    
    return schemas.LoginResponse(
        success=True, message="Login successful",
        user_id=user.id, email=user.email, allowed_pages=user.allowed_pages or [],
        access_token=access_token, token_type="bearer"
    )

@app.post("/users/{user_id}/force-logout")
def force_logout_user(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    db_user.token_version = (db_user.token_version or 1) + 1
    db.commit()
    return {"success": True, "message": f"User {db_user.email} has been logged out"}
    
# ============================================
# LIBRARY CONFIGURATIONS
# ============================================

@app.get("/library-configs/", response_model=List[schemas.LibraryConfig])
def get_library_configs(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.LibraryConfig).all()


@app.get("/library-configs/{library_id}", response_model=schemas.LibraryConfig)
def get_library_config(library_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Library configuration not found")
    return config


@app.post("/library-configs/", response_model=schemas.LibraryConfig)
def create_library_config(config: schemas.LibraryConfigCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    existing_config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == config.library_id).first()
    if existing_config:
        existing_config.library_name = config.library_name
        existing_config.stream_api_key = config.stream_api_key
        existing_config.is_active = config.is_active
        existing_config.updated_at = datetime.now()
        db.commit()
        db.refresh(existing_config)
        return existing_config
    else:
        db_config = models.LibraryConfig(**config.dict())
        db.add(db_config)
        db.commit()
        db.refresh(db_config)
        return db_config

@app.put("/library-configs/{library_id}", response_model=schemas.LibraryConfig)
def update_library_config(library_id: int, config: schemas.LibraryConfigUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    if not db_config:
        raise HTTPException(status_code=404, detail=f"Library configuration not found for library_id {library_id}")

    logger.info("=" * 60)
    logger.info(f"UPDATE CONFIG - Library ID: {library_id}")

    update_data = config.dict(exclude_unset=True)

    if 'stream_api_key' in update_data and update_data['stream_api_key']:
        original_key = str(update_data['stream_api_key']).strip()
        update_data['stream_api_key'] = original_key
        logger.info(f"Received API Key Length: {len(original_key)}")

    for field, value in update_data.items():
        setattr(db_config, field, value)

    db_config.updated_at = datetime.utcnow()

    try:
        db.commit()
        db.refresh(db_config)
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Database commit failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save configuration: {str(e)}")

    logger.info(f"✅ Configuration saved successfully")
    logger.info("=" * 60)

    return db_config


@app.delete("/library-configs/{library_id}")
def delete_library_config(library_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    if not db_config:
        raise HTTPException(status_code=404, detail="Library configuration not found")
    db.delete(db_config)
    db.commit()
    return {"message": "Library configuration deleted successfully"}


@app.post("/library-configs/sync-from-bunny/")
async def sync_library_configs_from_bunny(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        libraries = await get_bunny_libraries()
        logger.info(f"Fetched {len(libraries)} libraries from Bunny.net API")

        synced_count = 0
        updated_count = 0

        from database import engine
        from sqlalchemy import text as sql_text

        with engine.begin() as conn:
            for library in libraries:
                lib_id = library.get("id") if "id" in library else library.get("Id")
                lib_name = library.get("name") if "name" in library else library.get("Name")

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

                result = conn.execute(
                    sql_text(
                        "INSERT INTO library_configs (library_id, library_name, stream_api_key, is_active, created_at, updated_at) "
                        "VALUES (:library_id, :library_name, NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
                        "ON CONFLICT (library_id) DO UPDATE SET "
                        "library_name = EXCLUDED.library_name, "
                        "updated_at = CURRENT_TIMESTAMP "
                        "WHERE library_configs.library_name != EXCLUDED.library_name"
                    ),
                    {"library_id": lib_id, "library_name": lib_name}
                )
                if result.rowcount:
                    updated_count += 1
                else:
                    synced_count += 1

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

                conn.execute(
                    sql_text(
                        "INSERT INTO library_configs (library_id, library_name, stream_api_key, is_active, created_at, updated_at) "
                        "VALUES (:library_id, :library_name, NULL, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
                        "ON CONFLICT (library_id) DO NOTHING"
                    ),
                    {"library_id": hist_id, "library_name": hist_name}
                )
                synced_count += 1

        return {"message": f"Sync complete: created {synced_count}, updated {updated_count}",
                "created": synced_count, "updated": updated_count}

    except Exception as e:
        logger.error(f"Error syncing library configs: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to sync library configurations: {str(e)}")
# ============================================
# CACHE MANAGEMENT
# ============================================
_historical_stats_cache = {
    "data": None,
    "fetched_at": None,
    "ttl_seconds": 600,
    "cache_key": None
}

@app.post("/cache/clear-libraries")
async def clear_libraries_cache(current_user: models.User = Depends(get_current_user)):
    """Force the next libraries fetch to go directly to Bunny API"""
    from bunny_service import _libraries_cache
    _libraries_cache["data"] = None
    _libraries_cache["fetched_at"] = None
    _historical_stats_cache["data"] = None
    _historical_stats_cache["fetched_at"] = None
    _historical_stats_cache["cache_key"] = None
    logger.info(f"Libraries + historical stats cache cleared by user {current_user.email}")
    return {"success": True, "message": "Cache cleared. Next fetch will go directly to Bunny API."}
    
@app.get("/cache/status")
async def get_cache_status(current_user: models.User = Depends(get_current_user)):
    """Check if cached data is available and how old it is"""
    from bunny_service import _libraries_cache
    import pytz
    now = datetime.now(pytz.UTC)
    if _libraries_cache["data"] is None:
        return {"cached": False, "libraries_count": 0, "age_seconds": None}
    age = int((now - _libraries_cache["fetched_at"]).total_seconds()) if _libraries_cache["fetched_at"] else None
    return {
        "cached": True,
        "libraries_count": len(_libraries_cache["data"]),
        "age_seconds": age,
        "ttl_seconds": _libraries_cache["ttl_seconds"],
        "expires_in_seconds": max(0, _libraries_cache["ttl_seconds"] - age) if age is not None else None
    }

# ============================================
# ROOT
# ============================================

@app.get("/")
def read_root():
    return {"message": "Welcome to Elkheta Teacher Performance Dashboard API"}


# ============================================
# HISTORICAL STATS
# ============================================

@app.post("/historical-stats/batch-fetch/", response_model=schemas.BatchFetchResponse)
async def batch_fetch_library_stats(request: schemas.BatchFetchRequest, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        results = []
        successful_fetches = 0
        failed_fetches = 0
        skipped_fetches = 0

        for library_id in request.library_ids:
            try:
                existing_stats = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id == library_id,
                    models.LibraryHistoricalStats.month == request.month,
                    models.LibraryHistoricalStats.year == request.year
                ).first()

                stats_data = await get_library_monthly_stats(library_id, request.month, request.year, db)

                try:
                    cfg = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
                    display_name = (cfg.library_name if cfg and cfg.library_name
                                    else stats_data.get("library_name", f"Library {library_id}"))
                except Exception:
                    display_name = stats_data.get("library_name", f"Library {library_id}")

                if existing_stats:
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
                        library_id=library_id, library_name=display_name,
                        status="success", success=True, message="Updated existing data", data=existing_stats
                    ))
                else:
                    new_stats = models.LibraryHistoricalStats(
                        library_id=library_id, library_name=display_name,
                        month=request.month, year=request.year,
                        total_views=stats_data.get("total_views", 0),
                        total_watch_time_seconds=stats_data.get("total_watch_time_seconds", 0),
                        bandwidth_gb=stats_data.get("bandwidth_gb", 0.0),
                        views_chart=stats_data.get("views_chart", {}),
                        watch_time_chart=stats_data.get("watch_time_chart", {}),
                        bandwidth_chart=stats_data.get("bandwidth_chart", {}),
                        fetch_date=datetime.now(pytz.UTC), is_synced=False
                    )
                    db.add(new_stats)
                    db.commit()
                    db.refresh(new_stats)
                    results.append(schemas.LibraryFetchStatus(
                        library_id=library_id, library_name=display_name,
                        status="success", success=True, message="Fetched new data", data=new_stats
                    ))

                successful_fetches += 1

            except Exception as e:
                logger.error(f"Failed to fetch stats for library {library_id}: {str(e)}")
                results.append(schemas.LibraryFetchStatus(
                    library_id=library_id, library_name=f"Library {library_id}",
                    status="error", success=False, message=f"Failed to fetch: {str(e)}", error=str(e)
                ))
                failed_fetches += 1

        return schemas.BatchFetchResponse(
            success=successful_fetches > 0,
            message=f"Fetched stats for {successful_fetches}/{len(request.library_ids)} libraries",
            total_libraries=len(request.library_ids),
            successful_fetches=successful_fetches, failed_fetches=failed_fetches,
            skipped_fetches=skipped_fetches, results=results
        )

    except Exception as e:
        logger.error(f"Batch fetch error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")



@app.post("/historical-stats/sync/", response_model=schemas.SyncResponse)
async def sync_historical_stats(request: schemas.SyncRequest, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        logger.info("=" * 60)
        logger.info("SYNC TO LIBRARIES PAGE - REQUEST RECEIVED")
        logger.info(f"Library IDs: {request.library_ids}, Month: {request.month}, Year: {request.year}")
        logger.info("=" * 60)

        results = []
        synced_libraries = 0
        failed_syncs = 0
        already_synced = 0

        query = db.query(models.LibraryHistoricalStats)
        if request.library_ids:
            query = query.filter(
                models.LibraryHistoricalStats.library_id.in_(request.library_ids),
                models.LibraryHistoricalStats.month == request.month,
                models.LibraryHistoricalStats.year == request.year
            )
        else:
            query = query.filter(
                models.LibraryHistoricalStats.month == request.month,
                models.LibraryHistoricalStats.year == request.year,
                models.LibraryHistoricalStats.is_synced == False
            )

        stats_to_sync = query.all()

        if len(stats_to_sync) == 0:
            logger.warning("NO STATS FOUND TO SYNC!")
            if request.library_ids:
                any_stats = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id.in_(request.library_ids)
                ).all()
                if len(any_stats) == 0:
                    raise HTTPException(status_code=404,
                        detail=f"No stats found for libraries {request.library_ids}. Please fetch stats first.")
                else:
                    available_periods = list(set([(s.month, s.year) for s in any_stats]))
                    raise HTTPException(status_code=404,
                        detail=f"No stats found for month={request.month}, year={request.year}. Available: {available_periods}")
            else:
                raise HTTPException(status_code=404,
                    detail=f"No unsynced stats found for month={request.month}, year={request.year}.")

        logger.info(f"Found {len(stats_to_sync)} stats to sync")

        for stats in stats_to_sync:
            try:
                stats.is_synced = True
                stats.sync_date = datetime.now(pytz.UTC)
                stats.updated_at = datetime.now(pytz.UTC)

                try:
                    teacher = db.query(models.Teacher).filter(
                        models.Teacher.bunny_library_id == stats.library_id).first()
                    cfg = db.query(models.LibraryConfig).filter(
                        models.LibraryConfig.library_id == stats.library_id).first()
                    display_name = (cfg.library_name if cfg and cfg.library_name
                                    else stats.library_name or f"Library {stats.library_id}")
                    if teacher:
                        if teacher.name != display_name:
                            logger.info(f"Updating teacher name: {teacher.name} → {display_name}")
                            teacher.name = display_name
                    else:
                        logger.info(f"Creating new teacher: {display_name}")
                        db.add(models.Teacher(name=display_name, bunny_library_id=stats.library_id))
                except Exception as teacher_err:
                    logger.error(f"Teacher upsert failed for library {stats.library_id}: {str(teacher_err)}")

                results.append(schemas.LibrarySyncStatus(
                    library_id=stats.library_id, library_name=stats.library_name,
                    status="synced", success=True,
                    message=f"Synced successfully - {stats.total_views} views, {stats.total_watch_time_seconds} seconds"
                ))
                synced_libraries += 1
                logger.info(f"✓ Synced library {stats.library_id}: {stats.library_name}")

            except Exception as e:
                logger.error(f"Failed to sync library {stats.library_id}: {str(e)}")
                results.append(schemas.LibrarySyncStatus(
                    library_id=stats.library_id, library_name=stats.library_name,
                    status="error", success=False, message=f"Sync failed: {str(e)}", error=str(e)
                ))
                failed_syncs += 1

        db.commit()
        logger.info(f"SYNC COMPLETE - synced: {synced_libraries}, failed: {failed_syncs}")

        return schemas.SyncResponse(
            success=synced_libraries > 0,
            message=f"Synced {synced_libraries} libraries to Libraries page",
            total_libraries=len(stats_to_sync),
            synced_libraries=synced_libraries, failed_syncs=failed_syncs,
            already_synced=already_synced, results=results
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Sync error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@app.get("/historical-stats/libraries/", response_model=List[schemas.LibraryWithHistory])
async def get_libraries_with_history(with_stats_only: bool = False, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        import pytz as _pytz
        now = datetime.now(_pytz.UTC)
        cache_key = f"with_stats_{with_stats_only}"

        if (
            _historical_stats_cache["data"] is not None
            and _historical_stats_cache["fetched_at"] is not None
            and _historical_stats_cache.get("cache_key") == cache_key
            and (now - _historical_stats_cache["fetched_at"]).total_seconds() < _historical_stats_cache["ttl_seconds"]
        ):
            age = int((now - _historical_stats_cache["fetched_at"]).total_seconds())
            logger.info(f"[HistoricalStatsCache] HIT — {len(_historical_stats_cache['data'])} entries, {age}s old")
            return _historical_stats_cache["data"]

        logger.info(f"[HistoricalStatsCache] MISS — querying database (with_stats_only={with_stats_only})")

        libraries_query = db.query(
            models.LibraryHistoricalStats.library_id,
            models.LibraryHistoricalStats.library_name
        ).distinct()

        if with_stats_only:
            libraries_query = libraries_query.filter(models.LibraryHistoricalStats.is_synced == True)

        unique_libraries = libraries_query.all()

        if not unique_libraries and not with_stats_only:
            bunny_libraries = await get_bunny_libraries()
            result = [schemas.LibraryWithHistory(
                library_id=lib.get("id"), library_name=lib.get("name"),
                has_stats=False, monthly_data=[], last_updated=None
            ) for lib in bunny_libraries]
            _historical_stats_cache["data"] = result
            _historical_stats_cache["fetched_at"] = datetime.now(_pytz.UTC)
            _historical_stats_cache["cache_key"] = cache_key
            return result

        config_names = {cfg.library_id: cfg.library_name for cfg in db.query(models.LibraryConfig).all()}

        # Fetch ALL historical stats in ONE query — fixes the 104s N+1 problem
        all_stats = db.query(models.LibraryHistoricalStats).order_by(
            models.LibraryHistoricalStats.library_id,
            models.LibraryHistoricalStats.year.desc(),
            models.LibraryHistoricalStats.month.desc()
        ).all()

        stats_by_library = {}
        for stat in all_stats:
            stats_by_library.setdefault(stat.library_id, []).append(stat)

        result = []
        teachers_to_upsert = []

        for lib_id, lib_name in unique_libraries:
            preferred_name = config_names.get(lib_id) or lib_name
            teachers_to_upsert.append((lib_id, preferred_name))

            monthly_stats = stats_by_library.get(lib_id, [])
            monthly_data = []
            last_updated = None
            latest_name = lib_name

            for stats in monthly_stats:
                monthly_data.append(schemas.MonthlyData(
                    month=stats.month, year=stats.year,
                    total_views=stats.total_views,
                    total_watch_time_seconds=stats.total_watch_time_seconds,
                    bandwidth_gb=stats.bandwidth_gb, fetch_date=stats.fetch_date
                ))
                if not last_updated or (stats.fetch_date and stats.fetch_date > last_updated):
                    last_updated = stats.fetch_date
                    if stats.library_name:
                        latest_name = stats.library_name

            result.append(schemas.LibraryWithHistory(
                library_id=lib_id,
                library_name=config_names.get(lib_id) or latest_name or lib_name or f"Library {lib_id}",
                has_stats=len(monthly_data) > 0,
                monthly_data=monthly_data, last_updated=last_updated
            ))

        # Batch teacher upserts — no more flush inside loop
        try:
            existing_teachers = {t.bunny_library_id: t for t in db.query(models.Teacher).all()}
            for lib_id, preferred_name in teachers_to_upsert:
                teacher = existing_teachers.get(lib_id)
                if teacher:
                    if preferred_name and teacher.name != preferred_name:
                        teacher.name = preferred_name
                else:
                    db.add(models.Teacher(name=preferred_name or f"Library {lib_id}", bunny_library_id=lib_id))
            db.commit()
        except Exception as upsert_err:
            db.rollback()
            logger.warning(f"Teacher batch upsert failed (non-fatal): {str(upsert_err)}")

        _historical_stats_cache["data"] = result
        _historical_stats_cache["fetched_at"] = datetime.now(_pytz.UTC)
        _historical_stats_cache["cache_key"] = cache_key
        logger.info(f"[HistoricalStatsCache] Cached {len(result)} libraries")

        return result

    except Exception as e:
        logger.error(f"Get libraries with history error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")

# ============================================
# STAGE ENDPOINTS
# ============================================

@app.get("/stages/")
def get_stages(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    stages = db.query(Stage).order_by(Stage.display_order).all()
    return [{"id": s.id, "code": s.code, "name": s.name, "display_order": s.display_order,
             "created_at": s.created_at.isoformat() if s.created_at else None} for s in stages]


@app.post("/stages/")
def create_stage(stage: StageCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
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
        return {"id": db_stage.id, "code": db_stage.code, "name": db_stage.name,
                "display_order": db_stage.display_order,
                "created_at": db_stage.created_at.isoformat() if db_stage.created_at else None}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating stage: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create stage: {str(e)}")


@app.put("/stages/{stage_id}")
def update_stage(stage_id: int, stage: StageUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not db_stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    for field, value in stage.dict(exclude_unset=True).items():
        setattr(db_stage, field, value)
    db.commit()
    db.refresh(db_stage)
    return {"id": db_stage.id, "code": db_stage.code, "name": db_stage.name,
            "display_order": db_stage.display_order,
            "created_at": db_stage.created_at.isoformat() if db_stage.created_at else None}


@app.delete("/stages/{stage_id}")
def delete_stage(stage_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
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
def get_sections(stage_id: int = None, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    query = db.query(Section)
    if stage_id:
        query = query.filter(Section.stage_id == stage_id)
    sections = query.all()
    return [{"id": s.id, "stage_id": s.stage_id, "code": s.code, "name": s.name,
             "created_at": s.created_at.isoformat() if s.created_at else None} for s in sections]


@app.post("/sections/")
def create_section(section: SectionCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        db_section = Section(**section.dict())
        db.add(db_section)
        db.commit()
        db.refresh(db_section)
        return {"id": db_section.id, "stage_id": db_section.stage_id, "code": db_section.code,
                "name": db_section.name,
                "created_at": db_section.created_at.isoformat() if db_section.created_at else None}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


@app.delete("/sections/{section_id}")
def delete_section(section_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
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
def get_subjects(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    subjects = db.query(Subject).all()
    return [{"id": s.id, "code": s.code, "name": s.name, "is_common": s.is_common,
             "created_at": s.created_at.isoformat() if s.created_at else None} for s in subjects]


@app.post("/subjects/")
def create_subject(subject: SubjectCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        existing = db.query(Subject).filter(Subject.code == subject.code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Subject with code {subject.code} already exists")
        db_subject = Subject(**subject.dict())
        db.add(db_subject)
        db.commit()
        db.refresh(db_subject)
        return {"id": db_subject.id, "code": db_subject.code, "name": db_subject.name,
                "is_common": db_subject.is_common,
                "created_at": db_subject.created_at.isoformat() if db_subject.created_at else None}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


@app.delete("/subjects/{subject_id}")
def delete_subject(subject_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
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
def get_teacher_assignments(stage_id: int = None, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    from sqlalchemy.orm import joinedload
    query = db.query(TeacherAssignment).options(
        joinedload(TeacherAssignment.stage),
        joinedload(TeacherAssignment.section),
        joinedload(TeacherAssignment.subject),
    )
    if stage_id:
        query = query.filter(TeacherAssignment.stage_id == stage_id)
    assignments = query.all()
    result = []
    for assignment in assignments:
        result.append(TeacherAssignmentWithDetails(**{
            "id": assignment.id,
            "library_id": assignment.library_id,
            "library_name": assignment.library_name,
            "stage_id": assignment.stage_id,
            "section_id": assignment.section_id,
            "subject_id": assignment.subject_id,
            "tax_rate": assignment.tax_rate,
            "revenue_percentage": assignment.revenue_percentage,
            "created_at": assignment.created_at,
            "updated_at": assignment.updated_at,
            "stage_name": assignment.stage.name if assignment.stage else None,
            "section_name": assignment.section.name if assignment.section else None,
            "subject_name": assignment.subject.name if assignment.subject else None,
            "subject_is_common": assignment.subject.is_common if assignment.subject else None,
        }))
    return result

# ============================================
# SERIALIZER HELPERS
# ============================================

def _stage_to_dict(obj) -> dict:
    return {
        "id":            obj.id,
        "code":          obj.code,
        "name":          obj.name,
        "display_order": obj.display_order,
        "created_at":    obj.created_at,
    }


def _section_to_dict(obj) -> dict:
    return {
        "id":         obj.id,
        "stage_id":   obj.stage_id,
        "code":       obj.code,
        "name":       obj.name,
        "created_at": obj.created_at,
    }


def _section_revenue_with_details_to_dict(obj, stage_name, section_name) -> dict:
    return {
        "id":                obj.id,
        "period_id":         obj.period_id,
        "stage_id":          obj.stage_id,
        "section_id":        obj.section_id,
        "total_orders":      obj.total_orders,
        "total_revenue_egp": obj.total_revenue_egp,
        "created_at":        obj.created_at,
        "updated_at":        obj.updated_at,
        "stage_name":        stage_name,
        "section_name":      section_name,
    }


def _assignment_with_details_to_dict(obj, stage_name, section_name, subject_name, subject_is_common) -> dict:
    return {
        "id":                 obj.id,
        "library_id":         obj.library_id,
        "library_name":       obj.library_name,
        "stage_id":           obj.stage_id,
        "section_id":         obj.section_id,
        "subject_id":         obj.subject_id,
        "tax_rate":           obj.tax_rate,
        "revenue_percentage": obj.revenue_percentage,
        "created_at":         obj.created_at,
        "updated_at":         obj.updated_at,
        "stage_name":         stage_name,
        "section_name":       section_name,
        "subject_name":       subject_name,
        "subject_is_common":  subject_is_common,
    }


def _payment_with_details_to_dict(obj, stage_name, section_name, subject_name, subject_is_common, teacher_profile_id=None) -> dict:
    return {
        "id":                          obj.id,
        "period_id":                   obj.period_id,
        "assignment_id":               obj.assignment_id,
        "library_id":                  obj.library_id,
        "library_name":                obj.library_name,
        "stage_id":                    obj.stage_id,
        "section_id":                  obj.section_id,
        "subject_id":                  obj.subject_id,
        "teacher_profile_id":          teacher_profile_id,
        "total_watch_time_seconds":    obj.total_watch_time_seconds,
        "watch_time_percentage":       obj.watch_time_percentage,
        "monthly_watch_breakdown":     obj.monthly_watch_breakdown or {},
        "section_total_orders":        obj.section_total_orders,
        "section_order_percentage":    obj.section_order_percentage,
        "base_revenue":                obj.base_revenue,
        "revenue_percentage_applied":  obj.revenue_percentage_applied,
        "calculated_revenue":          obj.calculated_revenue,
        "tax_rate_applied":            obj.tax_rate_applied,
        "tax_amount":                  obj.tax_amount,
        "final_payment":               obj.final_payment,
        "created_at":                  obj.created_at,
        "stage_name":                  stage_name,
        "section_name":                section_name,
        "subject_name":                subject_name,
        "subject_is_common":           subject_is_common,
    }


def _period_to_dict(obj) -> dict:
    return {
        "id":         obj.id,
        "name":       obj.name,
        "year":       obj.year,
        "notes":      obj.notes,
        "months":     obj.months or [],
        "created_at": obj.created_at,
    }


def _revenue_to_dict(obj) -> dict:
    return {
        "id":                obj.id,
        "period_id":         obj.period_id,
        "stage_id":          obj.stage_id,
        "section_id":        obj.section_id,
        "total_orders":      obj.total_orders,
        "total_revenue_egp": obj.total_revenue_egp,
        "created_at":        obj.created_at,
        "updated_at":        obj.updated_at,
    }


def _assignment_to_dict(obj) -> dict:
    return {
        "id":                 obj.id,
        "library_id":         obj.library_id,
        "library_name":       obj.library_name,
        "stage_id":           obj.stage_id,
        "section_id":         obj.section_id,
        "subject_id":         obj.subject_id,
        "tax_rate":           obj.tax_rate,
        "revenue_percentage": obj.revenue_percentage,
        "created_at":         obj.created_at,
        "updated_at":         obj.updated_at,
    }


@app.post("/teacher-assignments/", response_model=TeacherAssignmentSchema)
def create_teacher_assignment(assignment: TeacherAssignmentCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        q = db.query(TeacherAssignment).filter(
            TeacherAssignment.library_id == assignment.library_id,
            TeacherAssignment.stage_id   == assignment.stage_id,
            TeacherAssignment.subject_id == assignment.subject_id,
        )
        if assignment.section_id is None:
            q = q.filter(TeacherAssignment.section_id.is_(None))
        else:
            q = q.filter(TeacherAssignment.section_id == assignment.section_id)

        existing = q.first()

        if existing:
            changed = False
            if assignment.tax_rate != existing.tax_rate:
                existing.tax_rate = assignment.tax_rate
                changed = True
            if assignment.revenue_percentage != existing.revenue_percentage:
                existing.revenue_percentage = assignment.revenue_percentage
                changed = True
            if changed:
                existing.updated_at = datetime.now(pytz.UTC)
                db.commit()
                db.refresh(existing)
            return _assignment_to_dict(existing)

        db_assignment = TeacherAssignment(**assignment.dict())
        db.add(db_assignment)
        db.commit()
        db.refresh(db_assignment)
        return _assignment_to_dict(db_assignment)

    except Exception as e:
        db.rollback()
        logger.error(f"Error in create_teacher_assignment: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create assignment: {str(e)}")


@app.put("/teacher-assignments/{assignment_id}", response_model=TeacherAssignmentSchema)
def update_teacher_assignment(assignment_id: int, assignment: TeacherAssignmentUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_obj = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not db_obj:
        raise HTTPException(status_code=404, detail="Assignment not found")
    for field, value in assignment.dict(exclude_unset=True).items():
        setattr(db_obj, field, value)
    db_obj.updated_at = datetime.now(pytz.UTC)
    db.commit()
    db.refresh(db_obj)
    return db_obj


@app.delete("/teacher-assignments/{assignment_id}")
def delete_teacher_assignment(assignment_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not db_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(db_assignment)
    db.commit()
    return {"message": "Assignment deleted successfully"}


@app.post("/teacher-assignments/auto-match", response_model=AutoMatchResponse)
async def auto_match_teachers(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        libraries = await get_bunny_libraries()

        stages_by_code   = {s.code: s for s in db.query(Stage).all()}
        subjects_by_code = {s.code: s for s in db.query(Subject).all()}
        sections_lookup  = {
            (sec.stage_id, sec.code): sec
            for sec in db.query(Section).all()
        }
        sections_by_stage = {}
        for (sid, _), sec in sections_lookup.items():
            sections_by_stage.setdefault(sid, []).append(sec)

        results       = []
        matched_count = 0
        unmatched_count = 0

        for lib in libraries:
            lib_id   = lib.get("id")
            lib_name = lib.get("name", "")

            if not lib_id:
                unmatched_count += 1
                continue

            stage_code, section_code, subject_code, teacher_code, teacher_name = parse_library_name(lib_name)

            if not stage_code or not subject_code:
                results.append(AutoMatchResult(
                    library_id=lib_id, library_name=lib_name,
                    stage_code=stage_code, section_code=section_code,
                    subject_code=subject_code, matched=False,
                    message=f"Could not parse: stage={stage_code}, subject={subject_code}"
                ))
                unmatched_count += 1
                continue

            stage = stages_by_code.get(stage_code)
            if not stage:
                results.append(AutoMatchResult(
                    library_id=lib_id, library_name=lib_name,
                    stage_code=stage_code, section_code=section_code,
                    subject_code=subject_code, matched=False,
                    message=f"Stage '{stage_code}' not found – add it in Settings → Stages"
                ))
                unmatched_count += 1
                continue

            subject = subjects_by_code.get(subject_code)
            if not subject:
                for code, subj in subjects_by_code.items():
                    if code.upper() == subject_code.upper():
                        subject = subj
                        break
            if not subject:
                results.append(AutoMatchResult(
                    library_id=lib_id, library_name=lib_name,
                    stage_code=stage_code, section_code=section_code,
                    subject_code=subject_code, matched=False,
                    message=f"Subject '{subject_code}' not found – add it in Settings → Subjects"
                ))
                unmatched_count += 1
                continue

            if subject.is_common or section_code is None:
                stage_sections = sections_by_stage.get(stage.id, [])

                if not stage_sections:
                    existing = db.query(TeacherAssignment).filter(
                        TeacherAssignment.library_id == lib_id,
                        TeacherAssignment.stage_id   == stage.id,
                        TeacherAssignment.subject_id  == subject.id,
                        TeacherAssignment.section_id  == None,
                    ).first()
                    if not existing:
                        db.add(TeacherAssignment(
                            library_id=lib_id, library_name=lib_name,
                            stage_id=stage.id, section_id=None,
                            subject_id=subject.id,
                            tax_rate=0.0, revenue_percentage=0.95,
                        ))
                    results.append(AutoMatchResult(
                        library_id=lib_id, library_name=lib_name,
                        stage_code=stage_code, section_code="NONE_YET",
                        subject_code=subject_code, matched=True,
                        message="Common – no sections defined for this stage yet"
                    ))
                else:
                    assigned_to = []
                    for sec in stage_sections:
                        existing = db.query(TeacherAssignment).filter(
                            TeacherAssignment.library_id == lib_id,
                            TeacherAssignment.stage_id   == stage.id,
                            TeacherAssignment.subject_id  == subject.id,
                            TeacherAssignment.section_id  == sec.id,
                        ).first()
                        if not existing:
                            db.add(TeacherAssignment(
                                library_id=lib_id, library_name=lib_name,
                                stage_id=stage.id, section_id=sec.id,
                                subject_id=subject.id,
                                tax_rate=0.0, revenue_percentage=0.95,
                            ))
                        assigned_to.append(sec.code)
                    results.append(AutoMatchResult(
                        library_id=lib_id, library_name=lib_name,
                        stage_code=stage_code, section_code="BOTH",
                        subject_code=subject_code, matched=True,
                        message=f"Common subject → assigned to: {', '.join(assigned_to)}"
                    ))
                matched_count += 1

            else:
                section = sections_lookup.get((stage.id, section_code))
                if not section:
                    results.append(AutoMatchResult(
                        library_id=lib_id, library_name=lib_name,
                        stage_code=stage_code, section_code=section_code,
                        subject_code=subject_code, matched=False,
                        message=(
                            f"Section '{section_code}' not found for stage '{stage_code}' – "
                            f"add it in Settings → Sections"
                        )
                    ))
                    unmatched_count += 1
                    continue

                existing = db.query(TeacherAssignment).filter(
                    TeacherAssignment.library_id == lib_id,
                    TeacherAssignment.stage_id   == stage.id,
                    TeacherAssignment.subject_id  == subject.id,
                    TeacherAssignment.section_id  == section.id,
                ).first()
                if not existing:
                    db.add(TeacherAssignment(
                        library_id=lib_id, library_name=lib_name,
                        stage_id=stage.id, section_id=section.id,
                        subject_id=subject.id,
                        tax_rate=0.0, revenue_percentage=0.95,
                    ))
                results.append(AutoMatchResult(
                    library_id=lib_id, library_name=lib_name,
                    stage_code=stage_code, section_code=section_code,
                    subject_code=subject_code, matched=True,
                    message=f"Matched to section {section_code} ({section.name})"
                ))
                matched_count += 1

        db.commit()
        logger.info(f"Auto-match: {matched_count} matched, {unmatched_count} unmatched from {len(libraries)} libraries")

        return AutoMatchResponse(
            total_libraries=len(libraries),
            matched=matched_count,
            unmatched=unmatched_count,
            results=results,
        )

    except Exception as e:
        db.rollback()
        logger.error(f"Auto-match error: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")

# ============================================
# TEACHER PROFILE ENDPOINTS
# ============================================

from financial_schemas import (
    TeacherProfile as TeacherProfileSchema,
    TeacherProfileCreate, TeacherProfileUpdate,
    AutoLinkResponse, UnlinkedAssignment,
    CalculationAuditSummary, AcknowledgeAuditRequest,
    FinalizationPreviewResponse, FinalizationPreviewRow,
    SubmitFinalizationRequest, FinalizationRecord,
    ReportConfig, ReportResponse, ReportRow, ReportColumnConfig,
    DashboardSummaryResponse, DashboardKPIs, PeriodStageCell,
    TeacherRankingRow, DashboardComparisonRequest, DashboardComparisonResponse,
    DashboardComparisonRow,
)


@app.get("/teacher-profiles/", response_model=List[TeacherProfileSchema])
def get_teacher_profiles(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    profiles = db.query(TeacherProfileModel).order_by(TeacherProfileModel.name).all()
    return profiles


@app.post("/teacher-profiles/", response_model=TeacherProfileSchema)
def create_teacher_profile(
    profile: TeacherProfileCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    existing = db.query(TeacherProfileModel).filter(
        TeacherProfileModel.code == profile.code
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Profile with code {profile.code} already exists")
    db_profile = TeacherProfileModel(**profile.dict())
    db.add(db_profile)
    db.commit()
    db.refresh(db_profile)
    return db_profile


@app.put("/teacher-profiles/{profile_id}", response_model=TeacherProfileSchema)
def update_teacher_profile(
    profile_id: int,
    profile: TeacherProfileUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_profile = db.query(TeacherProfileModel).filter(
        TeacherProfileModel.id == profile_id
    ).first()
    if not db_profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    for field, value in profile.dict(exclude_unset=True).items():
        setattr(db_profile, field, value)
    db_profile.updated_at = datetime.now(pytz.UTC)
    db.commit()
    db.refresh(db_profile)
    return db_profile


@app.delete("/teacher-profiles/{profile_id}")
def delete_teacher_profile(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_profile = db.query(TeacherProfileModel).filter(
        TeacherProfileModel.id == profile_id
    ).first()
    if not db_profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    # Unlink assignments before deleting
    db.query(TeacherAssignment).filter(
        TeacherAssignment.teacher_profile_id == profile_id
    ).update({"teacher_profile_id": None})
    db.delete(db_profile)
    db.commit()
    return {"success": True}


@app.post("/teacher-profiles/auto-link", response_model=AutoLinkResponse)
async def auto_link_teacher_profiles(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Scans all TeacherAssignments, extracts P-codes from library names,
    creates TeacherProfile records if needed, and links assignments.
    Assignments with no P-code are returned in unlinked_assignments list
    for manual linking in Settings.
    """
    try:
        assignments = db.query(TeacherAssignment).all()
        profiles_cache = {
            p.code: p for p in db.query(TeacherProfileModel).all()
        }

        linked = 0
        already_linked = 0
        profiles_created = 0
        unlinked_list: List[UnlinkedAssignment] = []

        for a in assignments:
            _, _, _, teacher_code, teacher_name = parse_library_name(a.library_name)

            if not teacher_code:
                unlinked_list.append(UnlinkedAssignment(
                    library_id=a.library_id,
                    library_name=a.library_name,
                    reason="no_p_code"
                ))
                continue

            # Get or create profile
            if teacher_code not in profiles_cache:
                display_name = teacher_name or teacher_code
                new_profile = TeacherProfileModel(
                    code=teacher_code,
                    name=display_name
                )
                db.add(new_profile)
                db.flush()  # get the ID without committing
                profiles_cache[teacher_code] = new_profile
                profiles_created += 1

            profile = profiles_cache[teacher_code]

            if a.teacher_profile_id == profile.id:
                already_linked += 1
            else:
                a.teacher_profile_id = profile.id
                linked += 1

        db.commit()
        logger.info(
            f"Auto-link: {linked} linked, {already_linked} already linked, "
            f"{profiles_created} profiles created, {len(unlinked_list)} unlinked"
        )

        return AutoLinkResponse(
            total_assignments=len(assignments),
            linked=linked,
            already_linked=already_linked,
            unlinked=len(unlinked_list),
            profiles_created=profiles_created,
            unlinked_assignments=unlinked_list
        )

    except Exception as e:
        db.rollback()
        logger.error(f"Auto-link error: {e}")
        raise HTTPException(status_code=500, detail=f"Auto-link failed: {str(e)}")


@app.get("/teacher-profiles/unlinked")
async def get_unlinked_assignments(db: Session = Depends(get_db)):
    rows = db.query(TeacherAssignment).filter(
        TeacherAssignment.teacher_profile_id == None
    ).all()

    # Deduplicate by library_id — keep only one row per library
    seen = {}
    for row in rows:
        if row.library_id not in seen:
            # Determine reason
            p_match = re.search(r'[Pp](\d{4})', row.library_name or '')
            if not p_match:
                reason = 'no_p_code'
            else:
                reason = 'profile_not_found'
            seen[row.library_id] = {
                "library_id": row.library_id,
                "library_name": row.library_name,
                "reason": reason,
            }

    return list(seen.values())

@app.put("/teacher-assignments/{assignment_id}/link-profile")
async def link_teacher_profile(
    assignment_id: int,
    payload: dict,
    db: Session = Depends(get_db)
):
    profile_id = payload.get("teacher_profile_id")
    if not profile_id:
        raise HTTPException(status_code=400, detail="teacher_profile_id required")

    # Find the target assignment to get its library_id
    target = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Link ALL assignments with the same library_id
    db.query(TeacherAssignment).filter(
        TeacherAssignment.library_id == target.library_id
    ).update({"teacher_profile_id": profile_id})
    db.commit()

    return {"linked": True, "library_id": target.library_id}
# ============================================
# CALCULATION AUDIT ENDPOINTS
# ============================================

@app.get("/calculation-audits/{period_id}/{stage_id}", response_model=List[CalculationAuditSummary])
def get_calculation_audits(
    period_id: int,
    stage_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Returns all audit runs for a period+stage, newest first."""
    audits = db.query(CalculationAudit).filter(
        CalculationAudit.period_id == period_id,
        CalculationAudit.stage_id  == stage_id,
    ).order_by(CalculationAudit.created_at.desc()).all()
    return [
        CalculationAuditSummary(
            id=a.id,
            period_id=a.period_id,
            stage_id=a.stage_id,
            status=a.status,
            warnings=[w for w in (a.warnings or [])],
            verification_status=a.verification_status,
            verification_delta=a.verification_delta,
            acknowledged=a.acknowledged,
            created_at=a.created_at,
        )
        for a in audits
    ]


@app.post("/calculation-audits/{audit_id}/acknowledge")
def acknowledge_audit(
    audit_id: int,
    body: AcknowledgeAuditRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Admin acknowledges all warnings for this audit run."""
    audit = db.query(CalculationAudit).filter(CalculationAudit.id == audit_id).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    audit.acknowledged = True
    audit.acknowledged_by_user_id = current_user.id
    audit.acknowledged_at = datetime.now(pytz.UTC)
    db.commit()
    return {"success": True, "audit_id": audit_id}

@app.get("/calculation-audits/{audit_id}/detail")
def get_audit_detail(
    audit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Returns the full audit record including snapshots and formula breakdown."""
    audit = db.query(CalculationAudit).filter(CalculationAudit.id == audit_id).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")

    # Build per-section formula steps from inputs_snapshot
    inputs = audit.inputs_snapshot or {}
    outputs = audit.outputs_snapshot or {}
    section_revenues = inputs.get("section_revenues", {})
    watch_times = inputs.get("watch_time_map", inputs.get("watch_times", {}))

    # Reconstruct formula steps per section from inputs snapshot
    formula_steps = {}
    for sec_id_str, rev_data in section_revenues.items():
        formula_steps[sec_id_str] = {
            "total_orders": rev_data.get("total_orders", 0),
            "total_revenue_egp": rev_data.get("total_revenue_egp", 0),
        }

    # Build per-library output rows from outputs_snapshot
    output_rows = []
    for lib_id_str, data in outputs.items():
        output_rows.append({
            "library_id": lib_id_str,
            "section_id": data.get("section_id"),
            "final_payment": data.get("final_payment", 0),
            "watch_time_percentage": data.get("watch_time_percentage", 0),
        })
    output_rows.sort(key=lambda x: x["final_payment"], reverse=True)

    return {
        "id": audit.id,
        "period_id": audit.period_id,
        "stage_id": audit.stage_id,
        "status": audit.status,
        "warnings": audit.warnings or [],
        "inputs_snapshot": inputs,
        "outputs_snapshot": outputs,
        "formula_steps": formula_steps,
        "output_rows": output_rows,
        "verification_status": audit.verification_status,
        "verification_delta": audit.verification_delta,
        "acknowledged": audit.acknowledged,
        "acknowledged_at": audit.acknowledged_at.isoformat() if audit.acknowledged_at else None,
        "created_at": audit.created_at.isoformat() if audit.created_at else None,
    }


# ============================================
# FINALIZATION ENDPOINTS
# ============================================

@app.get("/finalizations/preview/{period_id}", response_model=FinalizationPreviewResponse)
def get_finalization_preview(
    period_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Returns all teachers with calculated payments in this period,
    grouped by teacher → stage → section. Loads carry-forward-in
    from the previous finalized period automatically.
    Also checks if a next period exists (needed for carry-forward-out).
    """
    try:
        period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not period:
            raise HTTPException(status_code=404, detail="Period not found")

        # Check if next period exists (any period with higher id or later year)
        next_period = db.query(FinancialPeriod).filter(
            FinancialPeriod.id > period_id
        ).order_by(FinancialPeriod.id.asc()).first()
        next_period_exists = next_period is not None

        # Get latest acknowledged audit for this period (any stage)
        latest_audit = db.query(CalculationAudit).filter(
            CalculationAudit.period_id == period_id,
            CalculationAudit.acknowledged == True,
        ).order_by(CalculationAudit.created_at.desc()).first()

        audit_acknowledged = latest_audit is not None

        # Fetch all payments for this period
        payments = db.query(TeacherPayment).filter(
            TeacherPayment.period_id == period_id
        ).all()

        if not payments:
            return FinalizationPreviewResponse(
                period_id=period_id,
                period_name=period.name,
                next_period_exists=next_period_exists,
                next_period_name=next_period.name if next_period else None,
                latest_audit_id=latest_audit.id if latest_audit else None,
                audit_acknowledged=audit_acknowledged,
                rows=[]
            )

        # Caches
        stages_cache  = {s.id: s for s in db.query(Stage).all()}
        sections_cache = {s.id: s for s in db.query(Section).all()}
        profiles_cache = {p.id: p for p in db.query(TeacherProfileModel).all()}

        # Group payments by (teacher_profile_id, stage_id, section_id)
        from collections import defaultdict
        grouped = defaultdict(float)
        assignment_profile_map = {}

        assignments = db.query(TeacherAssignment).all()
        for a in assignments:
            assignment_profile_map[a.id] = a.teacher_profile_id

        for p in payments:
            profile_id = assignment_profile_map.get(p.assignment_id)
            if not profile_id:
                continue  # skip unlinked teachers
            key = (profile_id, p.stage_id, p.section_id)
            grouped[key] += p.final_payment

        # Find previous period's finalizations for carry-forward
        previous_finalizations = {}
        prev_period = db.query(FinancialPeriod).filter(
            FinancialPeriod.id < period_id
        ).order_by(FinancialPeriod.id.desc()).first()

        if prev_period:
            prev_fins = db.query(PaymentFinalization).filter(
                PaymentFinalization.period_id == prev_period.id
            ).all()
            for fin in prev_fins:
                key = (fin.teacher_profile_id, fin.stage_id, fin.section_id)
                previous_finalizations[key] = fin.carry_forward_out

        # Build preview rows
        rows = []
        for (profile_id, stage_id, section_id), gross in grouped.items():
            profile = profiles_cache.get(profile_id)
            stage   = stages_cache.get(stage_id)
            section = sections_cache.get(section_id)

            if not profile or not stage or not section:
                continue

            carry_in = previous_finalizations.get((profile_id, stage_id, section_id), 0.0)
            total_due = gross + carry_in

            # Check if already finalized for this period
            existing_fin = db.query(PaymentFinalization).filter(
                PaymentFinalization.period_id == period_id,
                PaymentFinalization.teacher_profile_id == profile_id,
                PaymentFinalization.stage_id == stage_id,
                PaymentFinalization.section_id == section_id,
            ).first()

            rows.append(FinalizationPreviewRow(
                teacher_profile_id=profile_id,
                teacher_code=profile.code,
                teacher_name=profile.name,
                stage_id=stage_id,
                stage_code=stage.code,
                stage_name=stage.name,
                section_id=section_id,
                section_code=section.code,
                section_name=section.name,
                gross_payment=round(gross, 2),
                carry_forward_in=round(carry_in, 2),
                total_due=round(total_due, 2),
                already_finalized=existing_fin is not None,
                existing_transfer_percentage=existing_fin.transfer_percentage if existing_fin else None,
                existing_transfer_amount=existing_fin.transfer_amount if existing_fin else None,
                existing_carry_forward_out=existing_fin.carry_forward_out if existing_fin else None,
            ))

        # Sort: by teacher name, then stage, then section
        rows.sort(key=lambda r: (r.teacher_name, r.stage_code, r.section_code))

        return FinalizationPreviewResponse(
            period_id=period_id,
            period_name=period.name,
            next_period_exists=next_period_exists,
            next_period_name=next_period.name if next_period else None,
            latest_audit_id=latest_audit.id if latest_audit else None,
            audit_acknowledged=audit_acknowledged,
            rows=rows
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_finalization_preview: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to load finalization preview: {str(e)}")


@app.post("/finalizations/", response_model=List[FinalizationRecord])
def submit_finalization(
    request: SubmitFinalizationRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Saves finalization records for each teacher/stage/section row.
    Upserts: if already finalized for this period, updates it.
    """
    try:
        period = db.query(FinancialPeriod).filter(
            FinancialPeriod.id == request.period_id
        ).first()
        if not period:
            raise HTTPException(status_code=404, detail="Period not found")

        audit = db.query(CalculationAudit).filter(
            CalculationAudit.id == request.audit_id
        ).first() if request.audit_id else None

        # Re-load payments to compute gross amounts accurately
        payments = db.query(TeacherPayment).filter(
            TeacherPayment.period_id == request.period_id
        ).all()
        assignments = db.query(TeacherAssignment).all()
        assignment_profile_map = {a.id: a.teacher_profile_id for a in assignments}

        from collections import defaultdict
        gross_map = defaultdict(float)
        for p in payments:
            profile_id = assignment_profile_map.get(p.assignment_id)
            if profile_id:
                gross_map[(profile_id, p.stage_id, p.section_id)] += p.final_payment

        # Previous period carry-forward
        prev_period = db.query(FinancialPeriod).filter(
            FinancialPeriod.id < request.period_id
        ).order_by(FinancialPeriod.id.desc()).first()

        previous_finalizations = {}
        if prev_period:
            for fin in db.query(PaymentFinalization).filter(
                PaymentFinalization.period_id == prev_period.id
            ).all():
                key = (fin.teacher_profile_id, fin.stage_id, fin.section_id)
                previous_finalizations[key] = fin.carry_forward_out

        saved = []
        now = datetime.now(pytz.UTC)

        for row in request.rows:
            key = (row.teacher_profile_id, row.stage_id, row.section_id)
            gross = round(gross_map.get(key, 0.0), 2)
            carry_in = round(previous_finalizations.get(key, 0.0), 2)
            total_due = round(gross + carry_in, 2)
            transfer_amount = round(total_due * row.transfer_percentage, 2)
            carry_out = round(total_due - transfer_amount, 2)

            existing = db.query(PaymentFinalization).filter(
                PaymentFinalization.period_id == request.period_id,
                PaymentFinalization.teacher_profile_id == row.teacher_profile_id,
                PaymentFinalization.stage_id == row.stage_id,
                PaymentFinalization.section_id == row.section_id,
            ).first()

            if existing:
                existing.gross_payment = gross
                existing.carry_forward_in = carry_in
                existing.total_due = total_due
                existing.transfer_percentage = row.transfer_percentage
                existing.transfer_amount = transfer_amount
                existing.carry_forward_out = carry_out
                existing.notes = row.notes
                existing.audit_id = audit.id if audit else existing.audit_id
                existing.finalized_at = now
                db.flush()
                saved.append(existing)
            else:
                new_fin = PaymentFinalization(
                    period_id=request.period_id,
                    teacher_profile_id=row.teacher_profile_id,
                    stage_id=row.stage_id,
                    section_id=row.section_id,
                    audit_id=audit.id if audit else None,
                    gross_payment=gross,
                    carry_forward_in=carry_in,
                    total_due=total_due,
                    transfer_percentage=row.transfer_percentage,
                    transfer_amount=transfer_amount,
                    carry_forward_out=carry_out,
                    notes=row.notes,
                    finalized_at=now,
                )
                db.add(new_fin)
                db.flush()
                saved.append(new_fin)

        db.commit()

        # Build response with names
        profiles_cache = {p.id: p for p in db.query(TeacherProfileModel).all()}
        stages_cache   = {s.id: s for s in db.query(Stage).all()}
        sections_cache = {s.id: s for s in db.query(Section).all()}

        result = []
        for fin in saved:
            db.refresh(fin)
            profile = profiles_cache.get(fin.teacher_profile_id)
            stage   = stages_cache.get(fin.stage_id)
            section = sections_cache.get(fin.section_id)
            result.append(FinalizationRecord(
                id=fin.id,
                period_id=fin.period_id,
                teacher_profile_id=fin.teacher_profile_id,
                teacher_code=profile.code if profile else None,
                teacher_name=profile.name if profile else None,
                stage_id=fin.stage_id,
                stage_code=stage.code if stage else None,
                section_id=fin.section_id,
                section_code=section.code if section else None,
                gross_payment=fin.gross_payment,
                carry_forward_in=fin.carry_forward_in,
                total_due=fin.total_due,
                transfer_percentage=fin.transfer_percentage,
                transfer_amount=fin.transfer_amount,
                carry_forward_out=fin.carry_forward_out,
                notes=fin.notes,
                finalized_at=fin.finalized_at,
                created_at=fin.created_at,
            ))

        return result

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Finalization error: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Finalization failed: {str(e)}")


@app.get("/finalizations/{period_id}", response_model=List[FinalizationRecord])
def get_finalizations(
    period_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    fins = db.query(PaymentFinalization).filter(
        PaymentFinalization.period_id == period_id
    ).all()
    profiles_cache = {p.id: p for p in db.query(TeacherProfileModel).all()}
    stages_cache   = {s.id: s for s in db.query(Stage).all()}
    sections_cache = {s.id: s for s in db.query(Section).all()}

    result = []
    for fin in fins:
        profile = profiles_cache.get(fin.teacher_profile_id)
        stage   = stages_cache.get(fin.stage_id)
        section = sections_cache.get(fin.section_id)
        result.append(FinalizationRecord(
            id=fin.id,
            period_id=fin.period_id,
            teacher_profile_id=fin.teacher_profile_id,
            teacher_code=profile.code if profile else None,
            teacher_name=profile.name if profile else None,
            stage_id=fin.stage_id,
            stage_code=stage.code if stage else None,
            section_id=fin.section_id,
            section_code=section.code if section else None,
            gross_payment=fin.gross_payment,
            carry_forward_in=fin.carry_forward_in,
            total_due=fin.total_due,
            transfer_percentage=fin.transfer_percentage,
            transfer_amount=fin.transfer_amount,
            carry_forward_out=fin.carry_forward_out,
            notes=fin.notes,
            finalized_at=fin.finalized_at,
            created_at=fin.created_at,
        ))
    return result


@app.get("/finalizations/teacher/{profile_id}", response_model=List[FinalizationRecord])
def get_teacher_finalization_history(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    fins = db.query(PaymentFinalization).filter(
        PaymentFinalization.teacher_profile_id == profile_id
    ).order_by(PaymentFinalization.period_id.desc()).all()
    stages_cache   = {s.id: s for s in db.query(Stage).all()}
    sections_cache = {s.id: s for s in db.query(Section).all()}
    profile = db.query(TeacherProfileModel).filter(TeacherProfileModel.id == profile_id).first()

    result = []
    for fin in fins:
        stage   = stages_cache.get(fin.stage_id)
        section = sections_cache.get(fin.section_id)
        result.append(FinalizationRecord(
            id=fin.id,
            period_id=fin.period_id,
            teacher_profile_id=fin.teacher_profile_id,
            teacher_code=profile.code if profile else None,
            teacher_name=profile.name if profile else None,
            stage_id=fin.stage_id,
            stage_code=stage.code if stage else None,
            section_id=fin.section_id,
            section_code=section.code if section else None,
            gross_payment=fin.gross_payment,
            carry_forward_in=fin.carry_forward_in,
            total_due=fin.total_due,
            transfer_percentage=fin.transfer_percentage,
            transfer_amount=fin.transfer_amount,
            carry_forward_out=fin.carry_forward_out,
            notes=fin.notes,
            finalized_at=fin.finalized_at,
            created_at=fin.created_at,
        ))
    return result


# ============================================
# REPORT ENDPOINT
# ============================================

@app.post("/reports/generate", response_model=ReportResponse)
def generate_report(
    config: ReportConfig,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Flexible report generator. Fetches payment + finalization data based on
    the config and returns structured rows ready for frontend rendering and export.
    """
    try:
        # Build base payments query
        query = db.query(TeacherPayment)

        if config.period_ids:
            query = query.filter(TeacherPayment.period_id.in_(config.period_ids))
        if config.stage_ids:
            query = query.filter(TeacherPayment.stage_id.in_(config.stage_ids))
        if config.section_ids:
            query = query.filter(TeacherPayment.section_id.in_(config.section_ids))
        if config.subject_ids:
            query = query.filter(TeacherPayment.subject_id.in_(config.subject_ids))

        payments = query.all()

        # Build lookup caches
        profiles_cache  = {p.id: p for p in db.query(TeacherProfileModel).all()}
        periods_cache   = {p.id: p for p in db.query(FinancialPeriod).all()}
        stages_cache    = {s.id: s for s in db.query(Stage).all()}
        sections_cache  = {s.id: s for s in db.query(Section).all()}
        subjects_cache  = {s.id: s for s in db.query(Subject).all()}
        assignments_map = {a.id: a for a in db.query(TeacherAssignment).all()}

        # Finalization data
        fin_query = db.query(PaymentFinalization)
        if config.period_ids:
            fin_query = fin_query.filter(PaymentFinalization.period_id.in_(config.period_ids))
        fins_by_key = {}
        for fin in fin_query.all():
            key = (fin.teacher_profile_id, fin.stage_id, fin.section_id, fin.period_id)
            fins_by_key[key] = fin

        # Build flat rows
        from collections import defaultdict
        flat_rows = []

        for p in payments:
            assignment = assignments_map.get(p.assignment_id)
            profile_id = assignment.teacher_profile_id if assignment else None
            if config.teacher_profile_ids and profile_id not in config.teacher_profile_ids:
                continue

            profile = profiles_cache.get(profile_id) if profile_id else None
            period  = periods_cache.get(p.period_id)
            stage   = stages_cache.get(p.stage_id)
            section = sections_cache.get(p.section_id)
            subject = subjects_cache.get(p.subject_id)

            fin_key = (profile_id, p.stage_id, p.section_id, p.period_id)
            fin = fins_by_key.get(fin_key)

            row_data = {
                "teacher_name":          profile.name if profile else p.library_name,
                "teacher_code":          profile.code if profile else None,
                "library_name":          p.library_name,
                "library_id":            p.library_id,
                "period_name":           period.name if period else str(p.period_id),
                "stage_code":            stage.code if stage else None,
                "stage_name":            stage.name if stage else None,
                "section_code":          section.code if section else None,
                "section_name":          section.name if section else None,
                "subject_code":          subject.code if subject else None,
                "subject_name":          subject.name if subject else None,
                "watch_time_minutes":    round((p.total_watch_time_seconds or 0) / 60, 1),
                "watch_time_percentage": round((p.watch_time_percentage or 0) * 100, 2),
                "revenue_percentage":    round((p.revenue_percentage_applied or 0) * 100, 0),
                "tax_percentage":        round((p.tax_rate_applied or 0) * 100, 0),
                "base_revenue":          round(p.base_revenue or 0, 2),
                "calculated_revenue":    round(p.calculated_revenue or 0, 2),
                "tax_amount":            round(p.tax_amount or 0, 2),
                "final_payment":         round(p.final_payment or 0, 2),
                "monthly_breakdown":     p.monthly_watch_breakdown or {},
                "transfer_percentage":   round((fin.transfer_percentage or 0) * 100, 0) if fin else None,
                "transfer_amount":       round(fin.transfer_amount or 0, 2) if fin else None,
                "carry_forward_in":      round(fin.carry_forward_in or 0, 2) if fin else None,
                "carry_forward_out":     round(fin.carry_forward_out or 0, 2) if fin else None,
                "total_due":             round(fin.total_due or 0, 2) if fin else None,
            }
            flat_rows.append(ReportRow(row_type="data", data=row_data))

        # Grouping and subtotals
        numeric_cols = [
            "watch_time_minutes", "base_revenue", "calculated_revenue",
            "tax_amount", "final_payment", "transfer_amount",
            "carry_forward_in", "carry_forward_out", "total_due"
        ]

        if config.group_by and flat_rows:
            group_key_map = {
                "teacher": "teacher_name",
                "stage":   "stage_code",
                "section": "section_code",
                "subject": "subject_name",
                "period":  "period_name",
            }
            gk = group_key_map.get(config.group_by)
            if gk:
                from itertools import groupby as _groupby
                flat_rows.sort(key=lambda r: (r.data.get(gk) or ""))
                grouped_rows = []
                for group_label, group_items in _groupby(flat_rows, key=lambda r: r.data.get(gk) or ""):
                    items = list(group_items)
                    grouped_rows.extend(items)
                    if config.show_subtotals:
                        subtotal_data = {"group_label": group_label}
                        for col in numeric_cols:
                            subtotal_data[col] = round(
                                sum(r.data.get(col) or 0 for r in items), 2
                            )
                        grouped_rows.append(ReportRow(
                            row_type="subtotal",
                            group_label=f"Subtotal — {group_label}",
                            data=subtotal_data
                        ))
                flat_rows = grouped_rows

        # Grand total
        if config.show_grand_total:
            data_rows = [r for r in flat_rows if r.row_type == "data"]
            grand_data = {}
            for col in numeric_cols:
                grand_data[col] = round(sum(r.data.get(col) or 0 for r in data_rows), 2)
            flat_rows.append(ReportRow(
                row_type="grand_total",
                group_label="Grand Total",
                data=grand_data
            ))

        # Comparative rows (teacher report only)
        if (config.report_type == "teacher"
                and config.comparative_teachers
                and config.teacher_profile_ids):
            comp_payments = db.query(TeacherPayment).filter(
                TeacherPayment.period_id.in_(config.period_ids) if config.period_ids else True,
                TeacherPayment.stage_id.in_(config.stage_ids) if config.stage_ids else True,
            ).all()

            for comp_cfg in config.comparative_teachers:
                comp_profile = profiles_cache.get(comp_cfg.teacher_profile_id)
                if not comp_profile:
                    continue
                comp_p_rows = [
                    cp for cp in comp_payments
                    if assignments_map.get(cp.assignment_id)
                    and assignments_map[cp.assignment_id].teacher_profile_id == comp_cfg.teacher_profile_id
                ]
                for cp in comp_p_rows:
                    comp_data = {
                        "teacher_name": comp_profile.name,
                        "teacher_code": comp_profile.code,
                    }
                    if "watch_time_percentage" in comp_cfg.columns:
                        comp_data["watch_time_percentage"] = round((cp.watch_time_percentage or 0) * 100, 2)
                    if "watch_time_minutes" in comp_cfg.columns:
                        comp_data["watch_time_minutes"] = round((cp.total_watch_time_seconds or 0) / 60, 1)
                    if "final_payment" in comp_cfg.columns:
                        comp_data["final_payment"] = round(cp.final_payment or 0, 2)
                    flat_rows.append(ReportRow(
                        row_type="comparative",
                        group_label=f"Compare — {comp_profile.name}",
                        data=comp_data
                    ))

        # Build column definitions
        all_columns = [
            ReportColumnConfig(key="teacher_name",        label="Teacher Name",       visible="teacher_name"        in config.columns),
            ReportColumnConfig(key="teacher_code",        label="Teacher Code",       visible="teacher_code"        in config.columns),
            ReportColumnConfig(key="library_name",        label="Library Name",       visible="library_name"        in config.columns),
            ReportColumnConfig(key="period_name",         label="Period",             visible="period_name"         in config.columns),
            ReportColumnConfig(key="stage_code",          label="Stage",              visible="stage_code"          in config.columns),
            ReportColumnConfig(key="section_code",        label="Section",            visible="section_code"        in config.columns),
            ReportColumnConfig(key="subject_name",        label="Subject",            visible="subject_name"        in config.columns),
            ReportColumnConfig(key="watch_time_minutes",  label="Watch (min)",        visible="watch_time_minutes"  in config.columns),
            ReportColumnConfig(key="watch_time_percentage",label="Watch %",           visible="watch_time_percentage" in config.columns),
            ReportColumnConfig(key="revenue_percentage",  label="Revenue %",          visible="revenue_percentage"  in config.columns),
            ReportColumnConfig(key="tax_percentage",      label="Tax %",              visible="tax_percentage"      in config.columns),
            ReportColumnConfig(key="base_revenue",        label="Base Revenue",       visible="base_revenue"        in config.columns),
            ReportColumnConfig(key="calculated_revenue",  label="Calculated Revenue", visible="calculated_revenue"  in config.columns),
            ReportColumnConfig(key="tax_amount",          label="Tax Amount",         visible="tax_amount"          in config.columns),
            ReportColumnConfig(key="final_payment",       label="Final Payment",      visible="final_payment"       in config.columns),
            ReportColumnConfig(key="transfer_percentage", label="Transfer %",         visible="transfer_percentage" in config.columns),
            ReportColumnConfig(key="transfer_amount",     label="Transfer Amount",    visible="transfer_amount"     in config.columns),
            ReportColumnConfig(key="carry_forward_in",    label="Carry Fwd In",       visible="carry_forward_in"    in config.columns),
            ReportColumnConfig(key="carry_forward_out",   label="Carry Fwd Out",      visible="carry_forward_out"   in config.columns),
            ReportColumnConfig(key="total_due",           label="Total Due",          visible="total_due"           in config.columns),
        ]

        return ReportResponse(
            config=config,
            columns=all_columns,
            rows=flat_rows,
            generated_at=datetime.now(pytz.UTC),
            total_rows=len([r for r in flat_rows if r.row_type == "data"]),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Report generation error: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")


# ============================================
# DASHBOARD ENDPOINTS
# ============================================

@app.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(
    period_id: int = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    try:
        all_periods = db.query(FinancialPeriod).order_by(
            FinancialPeriod.year.desc(), FinancialPeriod.created_at.desc()
        ).all()
        all_stages = db.query(Stage).order_by(Stage.display_order).all()

        # KPIs
        fin_query = db.query(PaymentFinalization)
        pay_query = db.query(TeacherPayment)

        if period_id:
            fin_query = fin_query.filter(PaymentFinalization.period_id == period_id)
            pay_query = pay_query.filter(TeacherPayment.period_id == period_id)

        all_fins = fin_query.all()
        all_pays = pay_query.all()

        total_finalized   = sum(f.transfer_amount for f in all_fins)
        total_outstanding = sum(f.carry_forward_out for f in all_fins)
        total_calculated  = sum(p.final_payment for p in all_pays)

        # For periods without finalization, outstanding = calculated - finalized
        if not all_fins and all_pays:
            total_outstanding = total_calculated

        total_watch_secs = sum(p.total_watch_time_seconds or 0 for p in all_pays)

        # Active teachers = distinct teacher profiles with payments
        assignments_with_profiles = db.query(TeacherAssignment).filter(
            TeacherAssignment.teacher_profile_id != None
        ).all()
        profile_map = {a.id: a.teacher_profile_id for a in assignments_with_profiles}
        active_profiles = set(
            profile_map[p.assignment_id]
            for p in all_pays
            if p.assignment_id in profile_map
        )

        period_obj = db.query(FinancialPeriod).filter(
            FinancialPeriod.id == period_id
        ).first() if period_id else None

        kpis = DashboardKPIs(
            total_finalized_egp=round(total_finalized, 2),
            total_outstanding_egp=round(total_outstanding, 2),
            active_teachers_count=len(active_profiles),
            total_watch_time_seconds=total_watch_secs,
            period_id=period_id,
            period_name=period_obj.name if period_obj else None,
        )

        # Period × Stage matrix
        all_payments_all = db.query(TeacherPayment).all()
        all_fins_all = db.query(PaymentFinalization).all()

        fins_by_period_stage = {}
        for fin in all_fins_all:
            key = (fin.period_id, fin.stage_id)
            if key not in fins_by_period_stage:
                fins_by_period_stage[key] = {"finalized": 0.0, "outstanding": 0.0}
            fins_by_period_stage[key]["finalized"]   += fin.transfer_amount
            fins_by_period_stage[key]["outstanding"] += fin.carry_forward_out

        pays_by_period_stage = {}
        for p in all_payments_all:
            key = (p.period_id, p.stage_id)
            pays_by_period_stage[key] = pays_by_period_stage.get(key, 0.0) + p.final_payment

        matrix = []
        for period in all_periods:
            for stage in all_stages:
                key = (period.id, stage.id)
                calc_total = round(pays_by_period_stage.get(key, 0.0), 2)
                fin_data   = fins_by_period_stage.get(key, {"finalized": 0.0, "outstanding": 0.0})
                matrix.append(PeriodStageCell(
                    period_id=period.id,
                    period_name=period.name,
                    stage_id=stage.id,
                    stage_code=stage.code,
                    calculated_total=calc_total,
                    finalized_total=round(fin_data["finalized"], 2),
                    outstanding_total=round(fin_data["outstanding"], 2),
                ))

        # Teacher rankings (top 20 by payment)
        profile_totals = {}
        for p in all_payments_all if not period_id else all_pays:
            assignment = db.query(TeacherAssignment).filter(
                TeacherAssignment.id == p.assignment_id
            ).first()
            if not assignment or not assignment.teacher_profile_id:
                continue
            pid = assignment.teacher_profile_id
            profile_totals[pid] = profile_totals.get(pid, 0.0) + p.final_payment

        profiles_all = {p.id: p for p in db.query(TeacherProfileModel).all()}
        rankings = sorted(profile_totals.items(), key=lambda x: x[1], reverse=True)[:20]
        teacher_rankings = [
            TeacherRankingRow(
                teacher_profile_id=pid,
                teacher_name=profiles_all[pid].name if pid in profiles_all else f"Profile {pid}",
                teacher_code=profiles_all[pid].code if pid in profiles_all else None,
                value=round(val, 2),
                metric="payment",
            )
            for pid, val in rankings
        ]

        return DashboardSummaryResponse(
            kpis=kpis,
            matrix=matrix,
            teacher_rankings=teacher_rankings,
            periods=[{"id": p.id, "name": p.name, "year": p.year} for p in all_periods],
            stages=[{"id": s.id, "code": s.code, "name": s.name} for s in all_stages],
        )

    except Exception as e:
        logger.error(f"Dashboard summary error: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Dashboard summary failed: {str(e)}")


@app.post("/dashboard/comparison", response_model=DashboardComparisonResponse)
def get_dashboard_comparison(
    request: DashboardComparisonRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    try:
        pay_query = db.query(TeacherPayment)
        if request.period_ids:
            pay_query = pay_query.filter(TeacherPayment.period_id.in_(request.period_ids))
        if request.stage_ids:
            pay_query = pay_query.filter(TeacherPayment.stage_id.in_(request.stage_ids))
        if request.section_ids:
            pay_query = pay_query.filter(TeacherPayment.section_id.in_(request.section_ids))

        payments = pay_query.all()

        stages_cache   = {s.id: s for s in db.query(Stage).all()}
        sections_cache = {s.id: s for s in db.query(Section).all()}
        periods_cache  = {p.id: p for p in db.query(FinancialPeriod).all()}
        subjects_cache = {s.id: s for s in db.query(Subject).all()}
        profiles_cache = {p.id: p for p in db.query(TeacherProfileModel).all()}
        assignments_map = {a.id: a for a in db.query(TeacherAssignment).all()}

        fins_cache = {}
        if request.use_finalized:
            for fin in db.query(PaymentFinalization).all():
                key = (fin.teacher_profile_id, fin.stage_id, fin.section_id, fin.period_id)
                fins_cache[key] = fin

        # Accumulate values by x-axis label
        from collections import defaultdict
        accum = defaultdict(float)

        for p in payments:
            assignment = assignments_map.get(p.assignment_id)

            # Determine x-axis label
            if request.x_axis == "teacher":
                profile_id = assignment.teacher_profile_id if assignment else None
                profile = profiles_cache.get(profile_id)
                label = profile.name if profile else p.library_name
            elif request.x_axis == "stage":
                stage = stages_cache.get(p.stage_id)
                label = stage.code if stage else str(p.stage_id)
            elif request.x_axis == "section":
                section = sections_cache.get(p.section_id)
                label = section.code if section else str(p.section_id)
            elif request.x_axis == "subject":
                subject = subjects_cache.get(p.subject_id)
                label = subject.name if subject else str(p.subject_id)
            elif request.x_axis == "period":
                period = periods_cache.get(p.period_id)
                label = period.name if period else str(p.period_id)
            else:
                label = "Unknown"

            # Determine y-axis value
            if request.y_axis == "payment":
                if request.use_finalized and assignment and assignment.teacher_profile_id:
                    fin_key = (assignment.teacher_profile_id, p.stage_id, p.section_id, p.period_id)
                    fin = fins_cache.get(fin_key)
                    value = fin.transfer_amount if fin else p.final_payment
                else:
                    value = p.final_payment
            elif request.y_axis == "watch_time":
                value = (p.total_watch_time_seconds or 0) / 60  # minutes
            elif request.y_axis == "watch_pct":
                value = (p.watch_time_percentage or 0) * 100
            elif request.y_axis == "orders":
                value = p.section_total_orders or 0
            elif request.y_axis == "carry_forward" and assignment and assignment.teacher_profile_id:
                fin_key = (assignment.teacher_profile_id, p.stage_id, p.section_id, p.period_id)
                fin = fins_cache.get(fin_key)
                value = fin.carry_forward_out if fin else 0.0
            else:
                value = 0.0

            accum[label] += value

        rows = [
            DashboardComparisonRow(label=label, value=round(val, 2))
            for label, val in sorted(accum.items(), key=lambda x: x[1], reverse=True)
        ]

        return DashboardComparisonResponse(
            x_axis=request.x_axis,
            y_axis=request.y_axis,
            rows=rows,
        )

    except Exception as e:
        logger.error(f"Dashboard comparison error: {e}")
        raise HTTPException(status_code=500, detail=f"Comparison failed: {str(e)}")

# ============================================
# FINANCIAL PERIOD ENDPOINTS
# ============================================

@app.get("/financial-periods/", response_model=List[FinancialPeriodSchema])
def get_financial_periods(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    periods = db.query(FinancialPeriod).order_by(
        FinancialPeriod.year.desc(), FinancialPeriod.created_at.desc()
    ).all()
    return [_period_to_dict(p) for p in periods]


@app.post("/financial-periods/", response_model=FinancialPeriodSchema)
def create_financial_period(period: FinancialPeriodCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        existing = db.query(FinancialPeriod).filter(
            FinancialPeriod.name == period.name
        ).first()

        if existing:
            return _period_to_dict(existing)

        db_period = FinancialPeriod(**period.dict())
        db.add(db_period)
        db.commit()
        db.refresh(db_period)
        return _period_to_dict(db_period)

    except Exception as e:
        db.rollback()
        logger.error(f"Error in create_financial_period: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create period: {str(e)}")


@app.put("/financial-periods/{period_id}", response_model=FinancialPeriodSchema)
def update_financial_period(period_id: int, period: FinancialPeriodUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        db_period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not db_period:
            raise HTTPException(status_code=404, detail="Period not found")
        for field, value in period.dict(exclude_unset=True).items():
            setattr(db_period, field, value)
        db.commit()
        db.refresh(db_period)
        return _period_to_dict(db_period)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error in update_financial_period: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update period: {str(e)}")


@app.delete("/financial-periods/{period_id}")
def delete_financial_period(period_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
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
def create_or_update_section_revenue(revenue: SectionRevenueCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        existing = db.query(SectionRevenue).filter(
            SectionRevenue.period_id  == revenue.period_id,
            SectionRevenue.stage_id   == revenue.stage_id,
            SectionRevenue.section_id == revenue.section_id,
        ).first()

        if existing:
            existing.total_orders      = revenue.total_orders
            existing.total_revenue_egp = revenue.total_revenue_egp
            existing.updated_at        = datetime.now(pytz.UTC)
            db.commit()
            db.refresh(existing)
            return _revenue_to_dict(existing)

        db_revenue = SectionRevenue(**revenue.dict())
        db.add(db_revenue)
        db.commit()
        db.refresh(db_revenue)
        return _revenue_to_dict(db_revenue)

    except Exception as e:
        db.rollback()
        logger.error(f"Error in create_or_update_section_revenue: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save revenue: {str(e)}")


# ============================================
# FINANCIAL DATA & CALCULATION ENDPOINTS
# ============================================

@app.get("/financials/{period_id}/{stage_id}", response_model=FinancialData)
def get_financial_data(period_id: int, stage_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not period:
            raise HTTPException(status_code=404, detail="Period not found")

        stage = db.query(Stage).filter(Stage.id == stage_id).first()
        if not stage:
            raise HTTPException(status_code=404, detail="Stage not found")

        sections = db.query(Section).filter(Section.stage_id == stage_id).all()
        section_map = {s.id: s for s in sections}

        section_revenues_raw = db.query(SectionRevenue).filter(
            SectionRevenue.period_id == period_id,
            SectionRevenue.stage_id  == stage_id,
        ).all()
        section_revenues_dicts = [
            _section_revenue_with_details_to_dict(
                rev,
                stage_name=stage.name,
                section_name=section_map[rev.section_id].name if rev.section_id in section_map else None,
            )
            for rev in section_revenues_raw
        ]

        assignments_raw = db.query(TeacherAssignment).filter(
            TeacherAssignment.stage_id == stage_id
        ).all()
        assignment_map = {a.id: a for a in assignments_raw}
        subject_cache = {}
        def get_subject(subject_id):
            if subject_id not in subject_cache:
                subject_cache[subject_id] = db.query(Subject).filter(Subject.id == subject_id).first()
            return subject_cache[subject_id]

        assignments_dicts = []
        for a in assignments_raw:
            sec = section_map.get(a.section_id) if a.section_id else None
            subj = get_subject(a.subject_id)
            assignments_dicts.append(_assignment_with_details_to_dict(
                a,
                stage_name=stage.name,
                section_name=sec.name if sec else None,
                subject_name=subj.name if subj else None,
                subject_is_common=subj.is_common if subj else None,
            ))

        payments_raw = db.query(TeacherPayment).filter(
            TeacherPayment.period_id == period_id,
            TeacherPayment.stage_id  == stage_id,
        ).all()
        payments_dicts = []
        for p in payments_raw:
            sec = section_map.get(p.section_id) if p.section_id else None
            subj = get_subject(p.subject_id)
            assignment = assignment_map.get(p.assignment_id)           # ← ADD
            tp_id = assignment.teacher_profile_id if assignment else None
            payments_dicts.append(_payment_with_details_to_dict(
                p,
                stage_name=stage.name,
                section_name=sec.name if sec else None,
                subject_name=subj.name if subj else None,
                subject_is_common=subj.is_common if subj else None,
                teacher_profile_id=tp_id,
            ))

        return FinancialData(
            period=_period_to_dict(period),
            stage=_stage_to_dict(stage),
            sections=[_section_to_dict(s) for s in sections],
            section_revenues=[SectionRevenueWithDetails(**d) for d in section_revenues_dicts],
            teacher_assignments=[TeacherAssignmentWithDetails(**d) for d in assignments_dicts],
            teacher_payments=[TeacherPaymentWithDetails(**d) for d in payments_dicts],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_financial_data: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to load financial data: {str(e)}")


@app.get("/financials/{period_id}/{stage_id}/libraries-preview")
def get_libraries_preview(period_id: int, stage_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    Returns all assigned libraries for this stage with their watch time
    broken down per period month. Libraries with zero analytics are flagged.
    """
    try:
        period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not period:
            raise HTTPException(status_code=404, detail="Period not found")

        period_months = period.months or []

        assignments = db.query(TeacherAssignment).filter(
            TeacherAssignment.stage_id == stage_id
        ).all()

        subject_cache = {}
        def get_subject(subject_id):
            if subject_id not in subject_cache:
                subject_cache[subject_id] = db.query(Subject).filter(Subject.id == subject_id).first()
            return subject_cache[subject_id]

        section_cache = {}
        def get_section(section_id):
            if section_id not in section_cache:
                section_cache[section_id] = db.query(Section).filter(Section.id == section_id).first()
            return section_cache[section_id]

        libraries = []
        seen = set()

        for a in assignments:
            key = (a.library_id, a.section_id)
            if key in seen:
                continue
            seen.add(key)

            subj = get_subject(a.subject_id)
            sec  = get_section(a.section_id) if a.section_id else None

            monthly_breakdown = {}
            total_seconds = 0

            for month_str in period_months:
                try:
                    year, month = map(int, month_str.split("-"))
                except ValueError:
                    continue
                stat = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id == a.library_id,
                    models.LibraryHistoricalStats.year  == year,
                    models.LibraryHistoricalStats.month == month,
                ).first()
                secs = stat.total_watch_time_seconds if stat else 0
                monthly_breakdown[month_str] = secs
                total_seconds += secs

            libraries.append({
                "library_id":               a.library_id,
                "library_name":             a.library_name,
                "subject_name":             subj.name if subj else None,
                "subject_is_common":        subj.is_common if subj else False,
                "section_name":             sec.name if sec else "All Sections",
                "total_watch_time_seconds": total_seconds,
                "monthly_watch_breakdown":  monthly_breakdown,
                "has_analytics":            total_seconds > 0,
            })

        no_analytics_count = sum(1 for lib in libraries if not lib["has_analytics"])

        return {
            "period_months":      period_months,
            "libraries":          libraries,
            "no_analytics_count": no_analytics_count,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_libraries_preview: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


@app.post("/calculate-payments/{period_id}/{stage_id}", response_model=CalculatePaymentsResponse)
async def calculate_payments(
    period_id: int,
    stage_id: int,
    request: dict = None,
    db: Session = Depends(get_db),
):
    """
    Payment calculation — correct algorithm:

    STEP 1 — Allocate common subject watch time per section:
      Each common library has ONE assignment per section (created by auto-match).
      For that assignment's section:
        allocated_wt = raw_wt * (section_orders / total_all_orders)
      This is the "virtual" split proportional to orders.

    STEP 2 — Build each section's total watch time pool:
      pool[section] = Σ allocated_wt (common libs) + Σ raw_wt (specific libs)

    STEP 3 — Compute payment for each teacher:
      watch_pct = teacher_effective_wt / section_pool
      payment   = section_revenue * watch_pct * revenue_pct * (1 - tax_rate)
    """
    try:
        excluded_ids = []
        if request and isinstance(request, dict):
            excluded_ids = request.get("excluded_library_ids", [])

        period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not period:
            raise HTTPException(status_code=404, detail="Period not found")

        stage = db.query(Stage).filter(Stage.id == stage_id).first()
        if not stage:
            raise HTTPException(status_code=404, detail="Stage not found")

        period_months = period.months or []

        # Block recalculation if this stage has already been finalized
        existing_fins = db.query(PaymentFinalization).filter(
            PaymentFinalization.period_id == period_id,
            PaymentFinalization.stage_id  == stage_id,
        ).first()
        if existing_fins:
            raise HTTPException(
                status_code=409,
                detail="This stage has already been finalized. Use 'Reset Stage' to unlock recalculation."
            )

        section_revenues = db.query(SectionRevenue).filter(
            SectionRevenue.period_id == period_id,
            SectionRevenue.stage_id  == stage_id,
        ).all()
        if not section_revenues:
            raise HTTPException(status_code=400, detail="No revenue data found. Please add revenue data first.")

        assignments = db.query(TeacherAssignment).filter(
            TeacherAssignment.stage_id == stage_id
        ).all()
        if excluded_ids:
            assignments = [a for a in assignments if a.library_id not in excluded_ids]
        if not assignments:
            raise HTTPException(status_code=400, detail="No teacher assignments found after exclusions.")

        # Delete old payments for this period+stage
        db.query(TeacherPayment).filter(
            TeacherPayment.period_id == period_id,
            TeacherPayment.stage_id  == stage_id,
        ).delete()

        # ── Build raw watch-time map + monthly breakdown ──────────────────────
        watch_time_map = {}  # library_id → total seconds for period months
        monthly_map    = {}  # library_id → {month_str: seconds}

        for a in assignments:
            lib_id = a.library_id
            if lib_id in watch_time_map:
                continue

            breakdown = {}
            total = 0

            if period_months:
                for month_str in period_months:
                    try:
                        yr, mo = map(int, month_str.split("-"))
                    except ValueError:
                        continue
                    stat = db.query(models.LibraryHistoricalStats).filter(
                        models.LibraryHistoricalStats.library_id == lib_id,
                        models.LibraryHistoricalStats.year  == yr,
                        models.LibraryHistoricalStats.month == mo,
                    ).first()
                    secs = stat.total_watch_time_seconds if stat else 0
                    breakdown[month_str] = secs
                    total += secs
            else:
                # Fallback: all stats for the period year
                stats = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id == lib_id,
                    models.LibraryHistoricalStats.year       == period.year,
                ).all()
                for stat in stats:
                    key  = f"{stat.year}-{stat.month:02d}"
                    breakdown[key] = stat.total_watch_time_seconds
                    total += stat.total_watch_time_seconds

            watch_time_map[lib_id] = total
            monthly_map[lib_id]    = breakdown

        # ── Caches ───────────────────────────────────────────────────────────
        subject_cache = {}
        def get_subject(sid):
            if sid not in subject_cache:
                subject_cache[sid] = db.query(Subject).filter(Subject.id == sid).first()
            return subject_cache[sid]

        section_map = {s.id: s for s in db.query(Section).filter(Section.stage_id == stage_id).all()}

        # ── Orders totals ─────────────────────────────────────────────────────
        total_all_orders  = sum(rev.total_orders for rev in section_revenues) or 1
        orders_by_section = {rev.section_id: rev.total_orders for rev in section_revenues}

        # ── STEP 1: Allocate common watch time per section ────────────────────
        # Each common assignment belongs to ONE section (auto-match creates one per section).
        # allocated_wt = raw_wt * (section_orders / total_all_orders)
        allocated_wt = {rev.section_id: {} for rev in section_revenues}

        for a in assignments:
            subj = get_subject(a.subject_id)
            if not (subj and subj.is_common):
                continue
            if a.section_id not in allocated_wt:
                continue  # section not in this period's revenues — skip
            raw_wt = watch_time_map.get(a.library_id, 0)
            ratio  = orders_by_section.get(a.section_id, 0) / total_all_orders
            alloc  = raw_wt * ratio
            key = (a.library_id, a.subject_id)
            allocated_wt[a.section_id][key] = alloc
            logger.info(f"Common lib {a.library_id} → sec {a.section_id}: {alloc:.0f}s (ratio={ratio:.3f})")

        # ── STEP 2: Build section watch-time pools ────────────────────────────
        # pool = Σ allocated_wt (common) + Σ raw_wt (specific)
        section_pool = {}
        for rev in section_revenues:
            sec_id = rev.section_id
            common_total = sum(allocated_wt[sec_id].values())
            specific_total = sum(
                watch_time_map.get(a.library_id, 0)
                for a in assignments
                if a.section_id == sec_id
                and not (get_subject(a.subject_id) and get_subject(a.subject_id).is_common)
            )
            section_pool[sec_id] = common_total + specific_total
            logger.info(f"Section {sec_id} pool: common={common_total:.0f}s specific={specific_total:.0f}s total={section_pool[sec_id]:.0f}s")

        # ── STEP 3: Create payment records ────────────────────────────────────
        payments_created  = []
        total_payment_sum = 0.0

        for rev in section_revenues:
            sec_id      = rev.section_id
            sec_revenue = rev.total_revenue_egp
            sec_orders  = rev.total_orders
            pool        = section_pool.get(sec_id, 0)
            ord_frac    = orders_by_section[sec_id] / total_all_orders

            # Common assignments for THIS section only
            for a in assignments:
                if a.section_id != sec_id:
                    continue
                subj = get_subject(a.subject_id)
                if not (subj and subj.is_common):
                    continue

                key        = (a.library_id, a.subject_id)
                teacher_wt = allocated_wt[sec_id].get(key, 0)
                wt_pct     = (teacher_wt / pool) if pool > 0 else 0.0

                base_rev = sec_revenue * wt_pct
                calc_rev = base_rev * a.revenue_percentage
                tax_amt  = calc_rev * a.tax_rate
                final    = calc_rev - tax_amt

                payment = TeacherPayment(
                    period_id=period_id, assignment_id=a.id,
                    library_id=a.library_id, library_name=a.library_name,
                    stage_id=stage_id, section_id=sec_id, subject_id=a.subject_id,
                    total_watch_time_seconds=int(teacher_wt),
                    watch_time_percentage=wt_pct,
                    monthly_watch_breakdown=monthly_map.get(a.library_id, {}),
                    section_total_orders=sec_orders,
                    section_order_percentage=ord_frac,
                    base_revenue=base_rev,
                    revenue_percentage_applied=a.revenue_percentage,
                    calculated_revenue=calc_rev,
                    tax_rate_applied=a.tax_rate,
                    tax_amount=tax_amt,
                    final_payment=final,
                )
                db.add(payment)
                payments_created.append(payment)
                total_payment_sum += final

            # Specific assignments for THIS section only
            for a in assignments:
                if a.section_id != sec_id:
                    continue
                subj = get_subject(a.subject_id)
                if subj and subj.is_common:
                    continue  # already handled above

                teacher_wt = watch_time_map.get(a.library_id, 0)
                wt_pct     = (teacher_wt / pool) if pool > 0 else 0.0

                base_rev = sec_revenue * wt_pct
                calc_rev = base_rev * a.revenue_percentage
                tax_amt  = calc_rev * a.tax_rate
                final    = calc_rev - tax_amt

                payment = TeacherPayment(
                    period_id=period_id, assignment_id=a.id,
                    library_id=a.library_id, library_name=a.library_name,
                    stage_id=stage_id, section_id=sec_id, subject_id=a.subject_id,
                    total_watch_time_seconds=teacher_wt,
                    watch_time_percentage=wt_pct,
                    monthly_watch_breakdown=monthly_map.get(a.library_id, {}),
                    section_total_orders=sec_orders,
                    section_order_percentage=ord_frac,
                    base_revenue=base_rev,
                    revenue_percentage_applied=a.revenue_percentage,
                    calculated_revenue=calc_rev,
                    tax_rate_applied=a.tax_rate,
                    tax_amount=tax_amt,
                    final_payment=final,
                )
                db.add(payment)
                payments_created.append(payment)
                total_payment_sum += final

        db.commit()

        # ── AUDIT GENERATION ─────────────────────────────────────────────────
        # Build warning list
        audit_warnings = []

        # Warning: zero watch time libraries not excluded
        for a in assignments:
            if watch_time_map.get(a.library_id, 0) == 0:
                audit_warnings.append({
                    "code": "ZERO_WATCH_TIME_INCLUDED",
                    "message": f"Library '{a.library_name}' has 0 watch time for this period but was included.",
                    "severity": "warning",
                    "library_id": a.library_id,
                    "library_name": a.library_name,
                })

        # Check libraries appearing in multiple assignments
        # Common subjects are EXPECTED to appear in multiple sections — confirm only
        # Non-common subjects appearing in multiple sections IS a real problem
        lib_id_counts = {}
        for a in assignments:
            lib_id_counts[a.library_id] = lib_id_counts.get(a.library_id, 0) + 1

        for lib_id, count in lib_id_counts.items():
            if count > 1:
                lib_assignments = [a for a in assignments if a.library_id == lib_id]
                lib_name = lib_assignments[0].library_name if lib_assignments else str(lib_id)
                section_ids = [a.section_id for a in lib_assignments]
                
                # Check if ALL assignments for this library are common subjects
                all_common = all(
                    get_subject(a.subject_id) and get_subject(a.subject_id).is_common
                    for a in lib_assignments
                )

                if all_common:
                    # This is expected — common subject assigned across multiple sections
                    section_names = []
                    for a in lib_assignments:
                        sec = section_map.get(a.section_id)
                        if sec:
                            section_names.append(sec.name)
                    audit_warnings.append({
                        "code": "COMMON_SUBJECT_MULTI_SECTION",
                        "message": (
                            f"Library '{lib_name}' is a common subject assigned to "
                            f"{count} sections ({', '.join(section_names)}) — this is expected."
                        ),
                        "severity": "info",
                        "library_id": lib_id,
                        "library_name": lib_name,
                    })
                else:
                    # Non-common subject in multiple assignments — this IS a problem
                    audit_warnings.append({
                        "code": "DUPLICATE_LIBRARY_ASSIGNMENT",
                        "message": (
                            f"Library '{lib_name}' appears in {count} assignments "
                            f"but is NOT marked as a common subject. Check assignments."
                        ),
                        "severity": "critical",
                        "library_id": lib_id,
                        "library_name": lib_name,
                    })

        # Warning: sum of payments exceeds section revenue
        for rev in section_revenues:
            sec_payments = [p for p in payments_created if p.section_id == rev.section_id]
            sec_payment_sum = sum(p.final_payment for p in sec_payments)
            if sec_payment_sum > rev.total_revenue_egp * 1.01:  # 1% tolerance
                audit_warnings.append({
                    "code": "PAYMENT_SUM_EXCEEDS_REVENUE",
                    "message": (
                        f"Section ID {rev.section_id}: payments sum "
                        f"({sec_payment_sum:.2f}) exceeds revenue ({rev.total_revenue_egp:.2f})."
                    ),
                    "severity": "critical",
                    "library_id": None,
                    "library_name": None,
                })

        # Warning: unlinked teachers (no teacher_profile_id)
        # Also check if a profile exists by P-code even if not formally linked
        all_profiles_by_code = {
            p.code: p for p in db.query(TeacherProfileModel).all()
        }
        for a in assignments:
            if not a.teacher_profile_id:
                # Try to find the P-code in the library name
                import re as _re
                p_match = _re.search(r'[Pp](\d{4})', a.library_name or '')
                if p_match:
                    p_code = f"P{p_match.group(1)}"
                    if p_code in all_profiles_by_code:
                        # Profile exists but assignment not formally linked — minor warning
                        audit_warnings.append({
                            "code": "UNLINKED_TEACHER",
                            "message": (
                                f"Library '{a.library_name}' has profile {p_code} in DB "
                                f"but assignment is not formally linked. Run Auto-Link to fix."
                            ),
                            "severity": "warning",
                            "library_id": a.library_id,
                            "library_name": a.library_name,
                        })
                    else:
                        # P-code not in DB at all
                        audit_warnings.append({
                            "code": "UNLINKED_TEACHER",
                            "message": (
                                f"Library '{a.library_name}' has P-code {p_code} "
                                f"but no matching profile found. Run Auto-Link in Settings."
                            ),
                            "severity": "warning",
                            "library_id": a.library_id,
                            "library_name": a.library_name,
                        })
                else:
                    # No P-code in library name at all
                    audit_warnings.append({
                        "code": "UNLINKED_TEACHER",
                        "message": (
                            f"Library '{a.library_name}' has no P-code in its name "
                            f"and no teacher profile linked."
                        ),
                        "severity": "warning",
                        "library_id": a.library_id,
                        "library_name": a.library_name,
                    })

        # Cross-validation: re-derive final payments from inputs and compare
        verification_status = "matched"
        verification_delta = 0.0
        try:
            recheck_sum = 0.0
            for rev in section_revenues:
                sec_id = rev.section_id
                pool = section_pool.get(sec_id, 0)
                ord_frac = orders_by_section[sec_id] / total_all_orders

                for a in assignments:
                    if a.section_id != sec_id:
                        continue
                    subj = get_subject(a.subject_id)
                    is_common = subj and subj.is_common

                    if is_common:
                        key = (a.library_id, a.subject_id)
                        teacher_wt = allocated_wt[sec_id].get(key, 0)
                    else:
                        teacher_wt = watch_time_map.get(a.library_id, 0)

                    wt_pct = (teacher_wt / pool) if pool > 0 else 0.0
                    base_rev = rev.total_revenue_egp * wt_pct
                    calc_rev = base_rev * a.revenue_percentage
                    tax_amt  = calc_rev * a.tax_rate
                    final    = calc_rev - tax_amt
                    recheck_sum += final

            verification_delta = abs(total_payment_sum - recheck_sum)
            if verification_delta > 0.02:
                verification_status = "mismatched"
                audit_warnings.append({
                    "code": "VERIFICATION_MISMATCH",
                    "message": (
                        f"Cross-validation failed: stored payments sum to {total_payment_sum:.2f} "
                        f"but re-calculation gives {recheck_sum:.2f} "
                        f"(delta: {verification_delta:.4f} EGP)."
                    ),
                    "severity": "critical",
                    "library_id": None,
                    "library_name": None,
                })
        except Exception as ve:
            logger.error(f"Cross-validation error: {ve}")
            verification_status = "error"

        # Determine overall status
has_critical = any(w["severity"] == "critical" for w in audit_warnings)
        has_warning  = any(w["severity"] == "warning"  for w in audit_warnings)
        # "info" severity (e.g. common subject confirmations) does not affect status
        audit_status = "failed" if has_critical else ("warnings" if has_warning else "passed")

        # Build snapshots
        inputs_snapshot = {
            "section_revenues": {
                str(rev.section_id): {
                    "total_orders": rev.total_orders,
                    "total_revenue_egp": rev.total_revenue_egp,
                }
                for rev in section_revenues
            },
            "watch_times": {str(k): v for k, v in watch_time_map.items()},
            "excluded_library_ids": excluded_ids,
            "period_months": period_months,
        }
        outputs_snapshot = {
            str(p.library_id): {
                "section_id": p.section_id,
                "final_payment": p.final_payment,
                "watch_time_percentage": p.watch_time_percentage,
            }
            for p in payments_created
        }

        audit_record = CalculationAudit(
            period_id=period_id,
            stage_id=stage_id,
            triggered_by_user_id=None,  # will be wired once auth is passed through
            status=audit_status,
            warnings=audit_warnings,
            inputs_snapshot=inputs_snapshot,
            outputs_snapshot=outputs_snapshot,
            verification_status=verification_status,
            verification_delta=verification_delta,
            acknowledged=False,
        )
        db.add(audit_record)
        db.commit()
        db.refresh(audit_record)
        logger.info(
            f"Audit saved: id={audit_record.id}, status={audit_status}, "
            f"warnings={len(audit_warnings)}, verification={verification_status}"
        )

        # Serialize for response
        payments_with_details = []
        
        for payment in payments_created:
            db.refresh(payment)
            sec  = section_map.get(payment.section_id)
            subj = get_subject(payment.subject_id)
            assignment = next((a for a in assignments if a.id == payment.assignment_id), None)
            tp_id = assignment.teacher_profile_id if assignment else None
            payments_with_details.append(TeacherPaymentWithDetails(
                **_payment_with_details_to_dict(
                    payment,
                    stage_name=stage.name,
                    section_name=sec.name if sec else None,
                    subject_name=subj.name if subj else None,
                    subject_is_common=subj.is_common if subj else None,
                    teacher_profile_id=tp_id,
                )
            ))

        return CalculatePaymentsResponse(
            success=True,
            message=f"Successfully calculated payments for {len(payments_created)} teachers",
            payments_calculated=len(payments_created),
            total_payment=total_payment_sum,
            payments=payments_with_details,
            audit_id=audit_record.id,
            audit_status=audit_status,
            audit_warnings=audit_warnings,
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Payment calculation error: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")
        
@app.get("/library-exclusions/{period_id}/{stage_id}")
def get_library_exclusions(
    period_id: int,
    stage_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    rows = db.query(LibraryExclusion).filter(
        LibraryExclusion.period_id == period_id,
        LibraryExclusion.stage_id  == stage_id,
    ).all()
    return [r.library_id for r in rows]


@app.post("/library-exclusions/{period_id}/{stage_id}")
def set_library_exclusions(
    period_id: int,
    stage_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Replace the full exclusion list for this period+stage."""
    library_ids = payload.get("library_ids", [])

    # Delete existing and re-insert (full replace)
    db.query(LibraryExclusion).filter(
        LibraryExclusion.period_id == period_id,
        LibraryExclusion.stage_id  == stage_id,
    ).delete()

    for lib_id in library_ids:
        db.add(LibraryExclusion(
            period_id=period_id,
            stage_id=stage_id,
            library_id=lib_id,
        ))

    db.commit()
    return {"saved": len(library_ids)}


@app.delete("/reset-period/{period_id}/{stage_id}")
def reset_period_stage(
    period_id: int,
    stage_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Deletes all payments, finalizations, and audits for a given period+stage.
    This unlocks recalculation after a period has been finalized.
    """
    try:
        # Count what will be deleted for the response summary
        payment_count = db.query(TeacherPayment).filter(
            TeacherPayment.period_id == period_id,
            TeacherPayment.stage_id  == stage_id,
        ).count()

        # Finalizations are per period (not per stage), but we only delete
        # rows that belong to sections in this stage
        stage_section_ids = [
            s.id for s in db.query(Section).filter(Section.stage_id == stage_id).all()
        ]
        fin_count = db.query(PaymentFinalization).filter(
            PaymentFinalization.period_id   == period_id,
            PaymentFinalization.stage_id    == stage_id,
        ).count()

        audit_count = db.query(CalculationAudit).filter(
            CalculationAudit.period_id == period_id,
            CalculationAudit.stage_id  == stage_id,
        ).count()

        # Delete in correct order (audits and payments first, then finalizations)
        db.query(CalculationAudit).filter(
            CalculationAudit.period_id == period_id,
            CalculationAudit.stage_id  == stage_id,
        ).delete()

        db.query(TeacherPayment).filter(
            TeacherPayment.period_id == period_id,
            TeacherPayment.stage_id  == stage_id,
        ).delete()

        db.query(PaymentFinalization).filter(
            PaymentFinalization.period_id == period_id,
            PaymentFinalization.stage_id  == stage_id,
        ).delete()

        db.commit()

        logger.info(
            f"Period reset: period={period_id}, stage={stage_id} — "
            f"deleted {payment_count} payments, {fin_count} finalizations, {audit_count} audits"
        )

        return {
            "success": True,
            "message": f"Reset complete",
            "deleted_payments": payment_count,
            "deleted_finalizations": fin_count,
            "deleted_audits": audit_count,
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Reset error: {e}")
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")


@app.get("/teacher-payments/{period_id}", response_model=List[TeacherPaymentWithDetails])
def get_teacher_payments(period_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    payments = db.query(TeacherPayment).filter(TeacherPayment.period_id == period_id).all()
    payments_with_details = []
    for payment in payments:
        stage = db.query(Stage).filter(Stage.id == payment.stage_id).first()
        section = db.query(Section).filter(Section.id == payment.section_id).first()
        subject = db.query(Subject).filter(Subject.id == payment.subject_id).first()
        assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == payment.assignment_id).first()
        tp_id = assignment.teacher_profile_id if assignment else None
        payment_dict = {**payment.__dict__, "teacher_profile_id": tp_id, "stage_name": stage.name if stage else None,
                        "section_name": section.name if section else None,
                        "subject_name": subject.name if subject else None,
                        "subject_is_common": subject.is_common if subject else None}
        payments_with_details.append(TeacherPaymentWithDetails(**payment_dict))
    return payments_with_details
