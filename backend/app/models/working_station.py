from sqlalchemy import Column, Integer, String

from app.database import Base


class WorkingStation(Base):
    __tablename__ = "working_stations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False, unique=True, index=True)
