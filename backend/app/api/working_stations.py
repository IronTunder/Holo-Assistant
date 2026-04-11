from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.models.working_station import WorkingStation
from app.schemas.working_station import WorkingStationResponse

router = APIRouter(prefix="/working-stations", tags=["working_stations"])


@router.get("/", response_model=List[WorkingStationResponse])
async def get_working_stations(
    db: Session = Depends(get_db),
):
    return (
        db.query(WorkingStation)
        .options(
            joinedload(WorkingStation.department),
            joinedload(WorkingStation.assigned_machine),
        )
        .order_by(WorkingStation.name.asc())
        .all()
    )


@router.get("/available", response_model=List[WorkingStationResponse])
async def get_available_working_stations(
    db: Session = Depends(get_db),
):
    return (
        db.query(WorkingStation)
        .options(
            joinedload(WorkingStation.department),
            joinedload(WorkingStation.assigned_machine),
        )
        .filter(WorkingStation.in_uso.is_(False))
        .order_by(WorkingStation.name.asc())
        .all()
    )


@router.get("/{working_station_id}", response_model=WorkingStationResponse)
async def get_working_station(
    working_station_id: int,
    db: Session = Depends(get_db),
):
    working_station = (
        db.query(WorkingStation)
        .options(
            joinedload(WorkingStation.department),
            joinedload(WorkingStation.assigned_machine),
        )
        .filter(WorkingStation.id == working_station_id)
        .first()
    )
    if working_station is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Postazione non trovata")
    return working_station
