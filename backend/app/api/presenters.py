from typing import Optional

from app.models.category import Category
from app.models.department import Department
from app.models.knowledge_item import KnowledgeItem, MachineKnowledgeItem
from app.models.machine import Machine
from app.models.working_station import WorkingStation
from app.models.role import ALL_PERMISSIONS
from app.models.user import Ruolo
from app.models.user import User


def serialize_department(department: Department) -> dict:
    return {
        "id": department.id,
        "name": department.name,
        "code": department.code,
        "description": department.description,
        "is_active": department.is_active,
    }


def serialize_role(role) -> dict:
    return {
        "id": role.id,
        "name": role.name,
        "code": role.code,
        "description": role.description,
        "permissions": role.permissions,
        "is_system": role.is_system,
        "is_active": role.is_active,
    }


def get_user_permissions(user: User) -> list[str]:
    if user.role is not None and user.role.is_active:
        return user.role.permissions
    if user.ruolo == Ruolo.ADMIN:
        return ALL_PERMISSIONS
    return []


def serialize_user(user: User) -> dict:
    department_name = user.reparto or None
    role = user.role
    return {
        "id": user.id,
        "nome": user.nome,
        "badge_id": user.badge_id,
        "ruolo": user.ruolo.value,
        "role_id": role.id if role else None,
        "role_name": role.name if role else None,
        "role_code": role.code if role else user.ruolo.value,
        "permissions": get_user_permissions(user),
        "livello_esperienza": user.livello_esperienza.value,
        "department_id": user.department_id,
        "department_name": department_name,
        "reparto": department_name,
        "turno": user.turno.value,
        "created_at": user.created_at,
    }


def serialize_operator(user: Optional[User]) -> Optional[dict]:
    if user is None:
        return None
    payload = serialize_user(user)
    return {
        "id": payload["id"],
        "nome": payload["nome"],
        "badge_id": payload["badge_id"],
        "department_id": payload["department_id"],
        "department_name": payload["department_name"],
        "reparto": payload["reparto"],
        "turno": payload["turno"],
        "livello_esperienza": payload["livello_esperienza"],
    }


def serialize_machine(machine: Machine, operator: Optional[User] = None, deleted: bool = False) -> dict:
    department_name = machine.reparto or None
    return {
        "id": machine.id,
        "nome": machine.nome,
        "department_id": machine.department_id,
        "department_name": department_name,
        "reparto": department_name,
        "descrizione": machine.descrizione,
        "id_postazione": machine.id_postazione,
        "startup_checklist": machine.startup_checklist or [],
        "in_uso": machine.in_uso,
        "operatore_attuale_id": machine.operatore_attuale_id,
        "working_station_id": machine.working_station_id,
        "operator": serialize_operator(operator),
        "deleted": deleted,
    }


def serialize_working_station(
    working_station: WorkingStation,
    operator: Optional[User] = None,
    assigned_machine: Optional[Machine] = None,
    deleted: bool = False,
) -> dict:
    department_name = working_station.department.name if working_station.department else None
    resolved_machine = assigned_machine or working_station.assigned_machine
    return {
        "id": working_station.id,
        "name": working_station.name,
        "description": working_station.description,
        "station_code": working_station.station_code,
        "startup_checklist": working_station.startup_checklist or [],
        "department_id": working_station.department_id,
        "department_name": department_name,
        "reparto": department_name,
        "in_uso": working_station.in_uso,
        "operatore_attuale_id": working_station.operatore_attuale_id,
        "operator": serialize_operator(operator),
        "assigned_machine": serialize_machine(resolved_machine) if resolved_machine else None,
        "deleted": deleted,
    }


def serialize_category(category: Category) -> dict:
    return {
        "id": category.id,
        "name": category.name,
        "description": category.description,
    }


def serialize_knowledge_item(
    knowledge_item: KnowledgeItem,
    assigned_machine_ids: Optional[list[int]] = None,
    assigned_working_station_ids: Optional[list[int]] = None,
    assignment_count: Optional[int] = None,
) -> dict:
    if assigned_machine_ids is None:
        assigned_machine_ids = []
    if assigned_working_station_ids is None:
        assigned_working_station_ids = sorted(
            {
                assignment.working_station_id
                for assignment in getattr(knowledge_item, "working_station_assignments", [])
                if assignment.is_enabled
            }
        )
    if assignment_count is None:
        assignment_count = len(assigned_working_station_ids)

    category_name = knowledge_item.category.name if knowledge_item.category else None
    return {
        "id": knowledge_item.id,
        "category_id": knowledge_item.category_id,
        "category_name": category_name,
        "question_title": knowledge_item.question_title,
        "answer_text": knowledge_item.answer_text,
        "keywords": knowledge_item.keywords,
        "example_questions": knowledge_item.example_questions,
        "is_active": knowledge_item.is_active,
        "sort_order": knowledge_item.sort_order,
        "assigned_machine_ids": assigned_machine_ids,
        "assigned_working_station_ids": assigned_working_station_ids,
        "assignment_count": assignment_count,
    }


def serialize_machine_knowledge_assignment(assignment: MachineKnowledgeItem) -> dict:
    return {
        "id": assignment.id,
        "machine_id": assignment.machine_id,
        "knowledge_item_id": assignment.knowledge_item_id,
        "is_enabled": assignment.is_enabled,
    }
