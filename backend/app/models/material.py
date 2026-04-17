from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (
        CheckConstraint("(NOT is_stock_tracked) OR (current_quantity >= 0)", name="ck_materials_non_negative_stock"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(160), nullable=False, unique=True, index=True)
    sku = Column(String(64), nullable=True, unique=True, index=True)
    category = Column(String(120), nullable=True, index=True)
    description = Column(Text, nullable=True)
    characteristics = Column(Text, nullable=True)
    aliases = Column(Text, nullable=True)
    unit_of_measure = Column(String(32), nullable=False, default="pz")
    current_quantity = Column(Float, nullable=False, default=0, index=True)
    minimum_quantity = Column(Float, nullable=False, default=0)
    reorder_quantity = Column(Float, nullable=False, default=0)
    storage_location = Column(String(160), nullable=True)
    is_stock_tracked = Column(Boolean, nullable=False, default=True)
    last_stock_update_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    working_station_assignments = relationship(
        "WorkingStationMaterial",
        back_populates="material",
        cascade="all, delete-orphan",
    )
    stock_movements = relationship(
        "MaterialStockMovement",
        back_populates="material",
        cascade="all, delete-orphan",
    )


class MaterialStockMovement(Base):
    __tablename__ = "material_stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False, index=True)
    movement_type = Column(String(32), nullable=False, index=True)
    quantity_delta = Column(Float, nullable=False)
    quantity_before = Column(Float, nullable=False)
    quantity_after = Column(Float, nullable=False)
    note = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    working_station_id = Column(Integer, ForeignKey("working_stations.id"), nullable=True, index=True)
    related_ticket_id = Column(Integer, ForeignKey("operational_tickets.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    material = relationship("Material", back_populates="stock_movements")
    created_by_user = relationship("User")
    working_station = relationship("WorkingStation")
    related_ticket = relationship("OperationalTicket")


class WorkingStationMaterial(Base):
    __tablename__ = "working_station_materials"

    id = Column(Integer, primary_key=True, index=True)
    working_station_id = Column(Integer, ForeignKey("working_stations.id"), nullable=False, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True, index=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False, index=True)
    usage_context = Column(String(160), nullable=True)
    notes = Column(Text, nullable=True)
    display_order = Column(Integer, nullable=False, default=0)
    is_required = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    working_station = relationship("WorkingStation")
    machine = relationship("Machine")
    material = relationship("Material", back_populates="working_station_assignments")
