from sqlalchemy import Column, Integer, String, Text, ForeignKey, Table
from sqlalchemy.orm import relationship
from app.database import Base

# Tabella di join per relazione many-to-many tra Machine e Category
machine_category_association = Table(
    "machine_category_association",
    Base.metadata,
    Column("machine_id", Integer, ForeignKey("machines.id"), primary_key=True),
    Column("category_id", Integer, ForeignKey("categories.id"), primary_key=True),
)


class Category(Base):
    __tablename__ = "categories"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    
    # Relazione con Machine (un-to-many tramite association table)
    machines = relationship(
        "Machine",
        secondary=machine_category_association,
        back_populates="categories"
    )
