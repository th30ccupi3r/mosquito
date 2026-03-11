from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Threat(Base):
    __tablename__ = "threats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    technology: Mapped[str | None] = mapped_column(String, nullable=True)
    subcategory: Mapped[str | None] = mapped_column(String, nullable=True)
    threat_category: Mapped[str] = mapped_column(String, nullable=False)
    question: Mapped[str] = mapped_column(String, nullable=False)
    typical_threat: Mapped[str] = mapped_column(String, nullable=False)
    impact: Mapped[str] = mapped_column(String, nullable=False)
    easiness_of_attack: Mapped[str] = mapped_column(String, nullable=False)
    export_new_component: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
