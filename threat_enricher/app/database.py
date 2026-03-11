import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./mosquito.db")

engine = create_engine(
    DATABASE_URL,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    future=True,
)


class Base(DeclarativeBase):
    pass


def ensure_schema() -> None:
    inspector = inspect(engine)

    if "threats" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("threats")}

    with engine.begin() as connection:
        if "subcategory" not in columns:
            connection.execute(text("ALTER TABLE threats ADD COLUMN subcategory VARCHAR"))
        if "export_new_component" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE threats ADD COLUMN export_new_component BOOLEAN NOT NULL DEFAULT 0"
                )
            )
