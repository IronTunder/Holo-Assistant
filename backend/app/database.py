from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

# Leggi dal file .env
DATABASE_HOST = os.getenv("DATABASE_HOST", "localhost")
DATABASE_PORT = os.getenv("DATABASE_PORT", "5432")
DATABASE_USER = os.getenv("DATABASE_USER", "postgres")
DATABASE_PASSWORD = os.getenv("DATABASE_PASSWORD", "postgres")
DATABASE_NAME = os.getenv("DATABASE_NAME", "ditto_db")

DATABASE_URL = f"postgresql://{DATABASE_USER}:{DATABASE_PASSWORD}@{DATABASE_HOST}:{DATABASE_PORT}/{DATABASE_NAME}"

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def apply_compatible_migrations():
    """Applica piccole migrazioni compatibili senza richiedere reset del DB."""
    inspector = inspect(engine)
    if "refresh_tokens" not in inspector.get_table_names():
        return

    columns = {
        column["name"]: column
        for column in inspector.get_columns("refresh_tokens")
    }

    with engine.begin() as connection:
        machine_id_column = columns.get("machine_id")
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

def get_db():
    """Dependency per ottenere una sessione database"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
