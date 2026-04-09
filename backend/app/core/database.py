import os
import re
import logging

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import psycopg2

load_dotenv()

logger = logging.getLogger(__name__)

DATABASE_HOST = os.getenv("DATABASE_HOST", "localhost")
DATABASE_PORT = os.getenv("DATABASE_PORT", "5432")
DATABASE_USER = os.getenv("DATABASE_USER", "postgres")
DATABASE_PASSWORD = os.getenv("DATABASE_PASSWORD")
DATABASE_NAME = os.getenv("DATABASE_NAME", "ditto_db")


def _allow_insecure_defaults() -> bool:
    return os.getenv("DITTO_ALLOW_INSECURE_DEFAULTS", "false").lower() == "true"


def _require_database_password() -> str:
    if DATABASE_PASSWORD and DATABASE_PASSWORD not in {"postgres", "password", "changeme"}:
        return DATABASE_PASSWORD
    if _allow_insecure_defaults():
        return DATABASE_PASSWORD or "postgres"
    raise RuntimeError(
        "DATABASE_PASSWORD must be set to a non-default value. "
        "Set DITTO_ALLOW_INSECURE_DEFAULTS=true only for isolated tests or demos."
    )


DATABASE_PASSWORD = _require_database_password()
DATABASE_URL = f"postgresql://{DATABASE_USER}:{DATABASE_PASSWORD}@{DATABASE_HOST}:{DATABASE_PORT}/{DATABASE_NAME}"


def _database_host_candidates(primary_host: str) -> list[str]:
    candidates: list[str] = []

    def add_candidate(host: str) -> None:
        normalized = (host or "").strip()
        if normalized and normalized not in candidates:
            candidates.append(normalized)

    add_candidate(primary_host)
    if primary_host not in {"127.0.0.1", "localhost"}:
        add_candidate("127.0.0.1")
        add_candidate("localhost")

    return candidates


def _create_database_connection():
    last_error = None

    for host in _database_host_candidates(DATABASE_HOST):
        try:
            connection = psycopg2.connect(
                host=host,
                port=DATABASE_PORT,
                user=DATABASE_USER,
                password=DATABASE_PASSWORD,
                dbname=DATABASE_NAME,
                connect_timeout=3,
            )
            if host != DATABASE_HOST:
                logger.warning(
                    "DATABASE_HOST '%s' non raggiungibile; uso fallback '%s' per PostgreSQL.",
                    DATABASE_HOST,
                    host,
                )
            return connection
        except psycopg2.OperationalError as exc:
            last_error = exc
            message = str(exc).lower()
            if "connection refused" not in message and "timeout expired" not in message and "could not connect" not in message:
                raise

    if last_error is not None:
        raise last_error

    raise RuntimeError("Impossibile creare una connessione PostgreSQL: nessun host candidato disponibile.")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, creator=_create_database_connection)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def _slugify_department_code(name: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return value[:64] or "department"


def _ensure_column(connection, inspector, table_name: str, column_name: str, ddl: str) -> None:
    columns = {column["name"] for column in inspector.get_columns(table_name)}
    if column_name in columns:
        return
    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {ddl}"))


def _ensure_index(connection, inspector, table_name: str, index_name: str, definition_sql: str) -> None:
    indexes = {index["name"] for index in inspector.get_indexes(table_name)}
    if index_name in indexes:
        return
    connection.execute(text(definition_sql))


def _backfill_departments() -> None:
    from app.models.department import Department
    from app.models.machine import Machine
    from app.models.user import User

    db = SessionLocal()
    try:
        department_names = set()
        for user in db.query(User).all():
            if user.reparto_legacy:
                department_names.add(user.reparto_legacy.strip())
        for machine in db.query(Machine).all():
            if machine.reparto_legacy:
                department_names.add(machine.reparto_legacy.strip())

        existing_departments = {department.name: department for department in db.query(Department).all()}
        used_codes = {department.code for department in existing_departments.values() if department.code}

        for department_name in sorted(name for name in department_names if name):
            if department_name in existing_departments:
                continue

            base_code = _slugify_department_code(department_name)
            candidate = base_code
            suffix = 2
            while candidate in used_codes:
                candidate = f"{base_code[:58]}-{suffix}"
                suffix += 1

            department = Department(name=department_name, code=candidate, is_active=True)
            db.add(department)
            db.flush()
            existing_departments[department_name] = department
            used_codes.add(candidate)

        for user in db.query(User).all():
            if user.department_id is None and user.reparto_legacy:
                department = existing_departments.get(user.reparto_legacy.strip())
                if department is not None:
                    user.department_id = department.id

        for machine in db.query(Machine).all():
            if machine.department_id is None and machine.reparto_legacy:
                department = existing_departments.get(machine.reparto_legacy.strip())
                if department is not None:
                    machine.department_id = department.id

        db.commit()
    finally:
        db.close()


def _slugify_role_code(name: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return value[:64] or "role"


def _backfill_roles() -> None:
    from app.models.role import (
        ADMIN_ROLE_CODE,
        MAINTENANCE_TECH_ROLE_CODE,
        OPERATOR_ROLE_CODE,
        SYSTEM_ROLE_DEFINITIONS,
        Role,
    )
    from app.models.user import LivelloEsperienza, Ruolo, User

    db = SessionLocal()
    try:
        existing_roles = {role.code: role for role in db.query(Role).filter(Role.code.isnot(None)).all()}
        used_codes = {role.code for role in existing_roles.values() if role.code}
        used_names = {role.name for role in db.query(Role).all()}

        for role_code, role_data in SYSTEM_ROLE_DEFINITIONS.items():
            role = existing_roles.get(role_code)
            if role is None:
                role_name = role_data["name"]
                if role_name in used_names:
                    role_name = f"{role_name} ({role_code})"
                role = Role(
                    name=role_name,
                    code=role_code,
                    description=role_data["description"],
                    is_system=True,
                    is_active=True,
                )
                role.permissions = role_data["permissions"]
                db.add(role)
                db.flush()
                existing_roles[role_code] = role
                used_codes.add(role_code)
                used_names.add(role_name)
                continue

            role.name = role_data["name"]
            role.description = role_data["description"]
            role.permissions = role_data["permissions"]
            role.is_system = True
            role.is_active = True

        for role in db.query(Role).filter(Role.code.is_(None)).all():
            base_code = _slugify_role_code(role.name)
            candidate = base_code
            suffix = 2
            while candidate in used_codes:
                candidate = f"{base_code[:58]}-{suffix}"
                suffix += 1
            role.code = candidate
            used_codes.add(candidate)

        admin_role = existing_roles[ADMIN_ROLE_CODE]
        technician_role = existing_roles[MAINTENANCE_TECH_ROLE_CODE]
        operator_role = existing_roles[OPERATOR_ROLE_CODE]

        for user in db.query(User).all():
            if user.role_id is not None:
                continue
            if user.ruolo == Ruolo.ADMIN:
                user.role_id = admin_role.id
            elif user.livello_esperienza == LivelloEsperienza.MANUTENTORE:
                user.role_id = technician_role.id
            else:
                user.role_id = operator_role.id

        db.commit()
    finally:
        db.close()


def _migrate_legacy_preset_responses() -> None:
    from app.models.knowledge_item import KnowledgeItem, MachineKnowledgeItem
    from app.models.machine import Machine
    from app.models.preset_response import PresetResponse

    db = SessionLocal()
    try:
        existing_items = db.query(KnowledgeItem).count()
        legacy_available = inspect(engine).has_table("preset_responses")
        if existing_items > 0 or not legacy_available:
            return

        machines = db.query(Machine).all()
        machine_ids = [machine.id for machine in machines]

        for sort_order, preset in enumerate(db.query(PresetResponse).order_by(PresetResponse.id).all(), start=1):
            first_keyword = None
            if preset.keywords:
                first_keyword = next(
                    (token.strip() for token in preset.keywords.split(",") if token.strip()),
                    None,
                )
            question_title = first_keyword or preset.text.splitlines()[0][:120] or f"Template {preset.id}"

            knowledge_item = KnowledgeItem(
                category_id=preset.category_id,
                question_title=question_title,
                answer_text=preset.text,
                keywords=preset.keywords,
                is_active=True,
                sort_order=sort_order,
            )
            db.add(knowledge_item)
            db.flush()

            target_machine_ids = machine_ids if preset.machine_id is None else [preset.machine_id]
            for machine_id in target_machine_ids:
                if machine_id is None:
                    continue
                db.add(
                    MachineKnowledgeItem(
                        machine_id=machine_id,
                        knowledge_item_id=knowledge_item.id,
                        is_enabled=True,
                    )
                )

        db.commit()
    finally:
        db.close()


def apply_compatible_migrations():
    """Applica migrazioni additive e backfill compatibili col database esistente."""
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)

    if "refresh_tokens" not in inspector.get_table_names():
        return

    with engine.begin() as connection:
        refresh_columns = {
            column["name"]: column
            for column in inspector.get_columns("refresh_tokens")
        }

        machine_id_column = refresh_columns.get("machine_id")
        if machine_id_column and not machine_id_column.get("nullable", False):
            connection.execute(
                text(
                    "ALTER TABLE refresh_tokens "
                    "ALTER COLUMN machine_id DROP NOT NULL"
                )
            )

        connection.execute(
            text(
                """
                UPDATE refresh_tokens AS rt
                SET machine_id = NULL
                FROM users AS u
                WHERE rt.user_id = u.id
                  AND u.ruolo = 'ADMIN'
                  AND rt.machine_id IS NOT NULL
                """
            )
        )

        if "users" in inspector.get_table_names():
            _ensure_column(connection, inspector, "users", "role_id", "role_id INTEGER")
            _ensure_index(
                connection,
                inspector,
                "users",
                "ix_users_role_id",
                "CREATE INDEX ix_users_role_id ON users (role_id)",
            )
            _ensure_column(connection, inspector, "users", "department_id", "department_id INTEGER")
            _ensure_index(
                connection,
                inspector,
                "users",
                "ix_users_department_id",
                "CREATE INDEX ix_users_department_id ON users (department_id)",
            )

        if "machines" in inspector.get_table_names():
            _ensure_column(connection, inspector, "machines", "department_id", "department_id INTEGER")
            _ensure_index(
                connection,
                inspector,
                "machines",
                "ix_machines_department_id",
                "CREATE INDEX ix_machines_department_id ON machines (department_id)",
            )

        if "interaction_logs" in inspector.get_table_names():
            _ensure_column(connection, inspector, "interaction_logs", "knowledge_item_id", "knowledge_item_id INTEGER")
            _ensure_column(connection, inspector, "interaction_logs", "feedback_status", "feedback_status VARCHAR(32)")
            _ensure_column(connection, inspector, "interaction_logs", "feedback_timestamp", "feedback_timestamp TIMESTAMP")
            _ensure_column(connection, inspector, "interaction_logs", "resolved_by_user_id", "resolved_by_user_id INTEGER")
            _ensure_column(connection, inspector, "interaction_logs", "resolution_note", "resolution_note TEXT")
            _ensure_column(connection, inspector, "interaction_logs", "resolution_timestamp", "resolution_timestamp TIMESTAMP")
            _ensure_column(
                connection,
                inspector,
                "interaction_logs",
                "action_type",
                "action_type VARCHAR(32) NOT NULL DEFAULT 'question'",
            )
            _ensure_column(
                connection,
                inspector,
                "interaction_logs",
                "priority",
                "priority VARCHAR(32) NOT NULL DEFAULT 'normal'",
            )
            _ensure_index(
                connection,
                inspector,
                "interaction_logs",
                "ix_interaction_logs_knowledge_item_id",
                "CREATE INDEX ix_interaction_logs_knowledge_item_id ON interaction_logs (knowledge_item_id)",
            )
            _ensure_index(
                connection,
                inspector,
                "interaction_logs",
                "ix_interaction_logs_feedback_status",
                "CREATE INDEX ix_interaction_logs_feedback_status ON interaction_logs (feedback_status)",
            )
            _ensure_index(
                connection,
                inspector,
                "interaction_logs",
                "ix_interaction_logs_action_type",
                "CREATE INDEX ix_interaction_logs_action_type ON interaction_logs (action_type)",
            )
            _ensure_index(
                connection,
                inspector,
                "interaction_logs",
                "ix_interaction_logs_priority",
                "CREATE INDEX ix_interaction_logs_priority ON interaction_logs (priority)",
            )

        if "knowledge_items" in inspector.get_table_names():
            _ensure_column(
                connection,
                inspector,
                "knowledge_items",
                "example_questions",
                "example_questions TEXT",
            )

        if "machines" in inspector.get_table_names():
            _ensure_column(
                connection,
                inspector,
                "machines",
                "startup_checklist",
                "startup_checklist JSONB NOT NULL DEFAULT '[]'::jsonb",
            )
            # Ensure existing rows have empty array instead of NULL
            connection.execute(
                text("UPDATE machines SET startup_checklist = '[]'::jsonb WHERE startup_checklist IS NULL")
            )

        if "roles" in inspector.get_table_names():
            _ensure_column(connection, inspector, "roles", "code", "code VARCHAR(64)")
            _ensure_column(connection, inspector, "roles", "description", "description TEXT")
            _ensure_column(connection, inspector, "roles", "is_system", "is_system BOOLEAN NOT NULL DEFAULT FALSE")
            _ensure_column(connection, inspector, "roles", "is_active", "is_active BOOLEAN NOT NULL DEFAULT TRUE")
            _ensure_index(
                connection,
                inspector,
                "roles",
                "ix_roles_code",
                "CREATE UNIQUE INDEX ix_roles_code ON roles (code)",
            )

    _backfill_departments()
    _backfill_roles()
    _migrate_legacy_preset_responses()

def get_db():
    """Dependency per ottenere una sessione database"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
