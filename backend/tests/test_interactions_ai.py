import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.interactions import (
    ask_question,
    clear_session_history,
    get_pending_quick_action,
    resolve_interaction,
    submit_quick_action,
)
from app.database import Base
from app.models.category import Category
from app.models.department import Department
from app.models.interaction_log import InteractionLog
from app.models.knowledge_item import KnowledgeItem, WorkingStationKnowledgeItem
from app.models.machine import Machine
from app.models.operator_chat_session import OperatorChatSession
from app.models.user import LivelloEsperienza, Ruolo, Turno, User
from app.models.working_station import WorkingStation
from app.schemas.interaction import AskQuestionRequest, InteractionResolutionRequest, InteractionTargetRequest, QuickActionRequest
from app.services.knowledge_retrieval import (
    IndexedKnowledgeItem,
    RetrievalResult,
    ScoredKnowledgeCandidate,
    knowledge_retrieval_service,
)
from scripts.seed_categories import align_existing_seed_data


class InteractionAiTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.db = self.SessionLocal()
        self._seed_fixture()
        knowledge_retrieval_service.invalidate_all()

    def tearDown(self) -> None:
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        knowledge_retrieval_service.invalidate_all()

    def _seed_fixture(self) -> None:
        department = Department(name="Assemblaggio", code="assemblaggio", is_active=True)
        machine = Machine(
            nome="Pressa A7",
            department=department,
            reparto_legacy="Assemblaggio",
            descrizione="Pressa di test",
            id_postazione="A7",
            in_uso=False,
        )
        user = User(
            nome="Mario Rossi",
            badge_id="12345",
            password_hash="hash",
            ruolo=Ruolo.OPERAIO,
            livello_esperienza=LivelloEsperienza.OPERAIO,
            department=department,
            reparto_legacy="Assemblaggio",
            turno=Turno.MATTINA,
        )
        technician = User(
            nome="Tecnico Manutentore",
            badge_id="TECH-001",
            password_hash="hash",
            ruolo=Ruolo.OPERAIO,
            livello_esperienza=LivelloEsperienza.MANUTENTORE,
            department=department,
            reparto_legacy="Assemblaggio",
            turno=Turno.MATTINA,
        )
        admin = User(
            nome="Admin",
            badge_id="ADMIN-001",
            password_hash="hash",
            ruolo=Ruolo.ADMIN,
            livello_esperienza=LivelloEsperienza.SENIOR,
            department=department,
            reparto_legacy="Assemblaggio",
            turno=Turno.MATTINA,
        )
        manutenzione = Category(name="Manutenzione", description="Procedure di manutenzione")
        sicurezza = Category(name="Sicurezza", description="Procedure di sicurezza")
        items = [
            KnowledgeItem(
                category=manutenzione,
                question_title="Cambio olio pressa",
                answer_text="Per cambiare l'olio spegni la pressa e scarica il serbatoio.",
                keywords="olio, cambio olio, lubrificazione",
                example_questions="Come cambio l'olio della pressa?\nDevo sostituire l'olio macchina",
                is_active=True,
                sort_order=1,
            ),
            KnowledgeItem(
                category=manutenzione,
                question_title="Sostituzione cinghia trasmissione",
                answer_text="Per sostituire la cinghia allenta il motore e monta la nuova.",
                keywords="cinghia, trasmissione, sostituzione",
                example_questions="La cinghia e rovinata\nCome cambio la cinghia di trasmissione?",
                is_active=True,
                sort_order=2,
            ),
            KnowledgeItem(
                category=manutenzione,
                question_title="Rumori anomali macchina",
                answer_text="Se senti rumori anomali controlla cuscinetti, bulloni e lubrificazione degli assi.",
                keywords="rumori, rumore, cuscinetti, bulloni",
                example_questions="La macchina fa un rumore strano\nSento rumori anomali durante il ciclo",
                is_active=True,
                sort_order=3,
            ),
            KnowledgeItem(
                category=sicurezza,
                question_title="Arresto di emergenza",
                answer_text="Premi il pulsante rosso di emergenza e allontanati dalla macchina.",
                keywords="emergenza, arresto, pulsante rosso",
                example_questions="Dove si trova l'arresto di emergenza?\nCome fermo subito la macchina?",
                is_active=True,
                sort_order=4,
            ),
        ]

        working_station = WorkingStation(
            name="Postazione A7",
            department=department,
            description="Postazione collegata alla pressa",
            station_code="WS-A7",
            startup_checklist=["Controllo visivo iniziale"],
            in_uso=True,
            operatore_attuale_id=user.id,
            assigned_machine=machine,
        )

        self.db.add_all([department, machine, user, technician, admin, manutenzione, sicurezza, working_station, *items])
        self.db.flush()
        machine.in_uso = True
        machine.operatore_attuale_id = user.id
        working_station.operatore_attuale_id = user.id
        self.db.add_all(
            [
                WorkingStationKnowledgeItem(working_station_id=working_station.id, knowledge_item_id=item.id, is_enabled=True)
                for item in items
            ]
        )
        self.db.commit()

        self.machine_id = machine.id
        self.user_id = user.id
        self.technician_id = technician.id
        self.admin_id = admin.id
        self.working_station_id = working_station.id
        self.item_ids = {item.question_title: item.id for item in items}

    async def test_ranking_prefers_exact_keyword_match(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "Come faccio il cambio olio della pressa?",
            indexed_candidates,
        )

        self.assertGreater(len(scored), 0)
        self.assertEqual(scored[0].item.question_title, "Cambio olio pressa")

    async def test_ranking_handles_light_typo_with_fuzzy_score(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "Devo cambiare la cingia di trasmisione",
            indexed_candidates,
        )

        self.assertGreater(len(scored), 0)
        self.assertEqual(scored[0].item.question_title, "Sostituzione cinghia trasmissione")

    async def test_ranking_matches_example_questions(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "Come fermo subito la macchina?",
            indexed_candidates,
        )

        self.assertGreater(len(scored), 0)
        self.assertEqual(scored[0].item.question_title, "Arresto di emergenza")

    async def test_ranking_matches_singular_plural_variant(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "rumore",
            indexed_candidates,
        )

        self.assertGreater(len(scored), 0)
        self.assertEqual(scored[0].item.question_title, "Rumori anomali macchina")

    async def test_ranking_rejects_single_word_out_of_domain_query(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "roblox",
            indexed_candidates,
        )

        self.assertEqual(scored, [])

    async def test_ranking_rejects_multiword_out_of_domain_query(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "napoli juve aperol",
            indexed_candidates,
        )

        self.assertEqual(scored, [])

    async def test_ranking_rejects_long_narrative_query(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "se ni mondo esistesse un po di bene e ogniun si considerassse suo fratello ci sarebbero meno pensieri e meno pene ed il mondo ne sarebbe assai piu bello",
            indexed_candidates,
        )

        self.assertEqual(scored, [])

    async def test_ask_question_returns_answer_mode(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Come faccio il cambio olio della pressa?",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "answer")
        self.assertEqual(response.reason_code, "matched")
        self.assertEqual(response.knowledge_item_title, "Cambio olio pressa")
        self.assertGreater(response.confidence, 0.7)

    async def test_ask_question_accepts_working_station_id(self) -> None:
        request = AskQuestionRequest(
            working_station_id=self.working_station_id,
            user_id=self.user_id,
            question="Come faccio il cambio olio della pressa?",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "answer")
        self.assertEqual(response.reason_code, "matched")
        self.assertEqual(response.knowledge_item_title, "Cambio olio pressa")

    async def test_ask_question_uses_working_station_knowledge_without_machine(self) -> None:
        working_station = WorkingStation(
            name="Postazione Manuale",
            department_id=self.db.query(User).filter(User.id == self.user_id).first().department_id,
            description="Postazione senza macchina ma con knowledge dedicata",
            station_code="WS-MAN",
            startup_checklist=["Controllo DPI"],
            in_uso=True,
            operatore_attuale_id=self.user_id,
        )
        category = self.db.query(Category).filter(Category.name == "Manutenzione").first()
        knowledge_item = KnowledgeItem(
            category=category,
            question_title="Checklist postazione manuale",
            answer_text="Per questa postazione controlla DPI, utensili e banco di lavoro.",
            keywords="postazione manuale, banco, dpi",
            example_questions="Che controlli devo fare sulla postazione manuale?",
            is_active=True,
            sort_order=10,
        )
        self.db.add_all([working_station, knowledge_item])
        self.db.flush()
        self.db.add(
            WorkingStationKnowledgeItem(
                working_station_id=working_station.id,
                knowledge_item_id=knowledge_item.id,
                is_enabled=True,
            )
        )
        self.db.commit()

        request = AskQuestionRequest(
            working_station_id=working_station.id,
            user_id=self.user_id,
            question="Che controlli devo fare sulla postazione manuale?",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "answer")
        self.assertEqual(response.reason_code, "matched")
        self.assertEqual(response.knowledge_item_title, "Checklist postazione manuale")
        self.assertIn("banco di lavoro", response.response.lower())
    async def test_ask_question_rejects_unassigned_machine(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Come faccio il cambio olio della pressa?",
        )
        machine = self.db.query(Machine).filter(Machine.id == self.machine_id).first()
        working_station = self.db.query(WorkingStation).filter(WorkingStation.id == self.working_station_id).first()
        machine.in_uso = False
        machine.operatore_attuale_id = None
        working_station.in_uso = False
        working_station.operatore_attuale_id = None
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            await ask_question(request, db=self.db)

        self.assertEqual(context.exception.status_code, 403)

    async def test_ask_question_uses_retrieval_cache_but_still_logs_each_request(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Come faccio il cambio olio della pressa?",
        )

        with (
            patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()),
            patch.object(
                knowledge_retrieval_service,
                "score_candidates",
                wraps=knowledge_retrieval_service.score_candidates,
            ) as score_candidates,
        ):
            first_response = await ask_question(request, db=self.db)
            second_response = await ask_question(request, db=self.db)

        self.assertEqual(first_response.knowledge_item_title, "Cambio olio pressa")
        self.assertEqual(second_response.knowledge_item_title, "Cambio olio pressa")
        self.assertEqual(score_candidates.call_count, 1)
        self.assertEqual(self.db.query(InteractionLog).count(), 2)

    async def test_retrieval_cache_invalidation_allows_updated_knowledge_answer(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Come faccio il cambio olio della pressa?",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            first_response = await ask_question(request, db=self.db)

        item = (
            self.db.query(KnowledgeItem)
            .filter(KnowledgeItem.id == self.item_ids["Cambio olio pressa"])
            .first()
        )
        item.answer_text = "Risposta aggiornata dopo modifica knowledge."
        self.db.commit()
        knowledge_retrieval_service.invalidate_machine(self.machine_id)

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            second_response = await ask_question(request, db=self.db)

        self.assertIn("spegni la pressa", first_response.response.lower())
        self.assertEqual(second_response.response, "Risposta aggiornata dopo modifica knowledge.")

    async def test_quick_action_creates_maintenance_signal(self) -> None:
        request = QuickActionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            action_type="maintenance",
        )
        current_user = self.db.query(User).filter(User.id == self.user_id).first()

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await submit_quick_action(request, current_user=current_user, db=self.db)

        interaction = self.db.query(InteractionLog).filter(InteractionLog.id == response.interaction_id).first()
        self.assertEqual(response.feedback_status, "unresolved")
        self.assertEqual(response.priority, "normal")
        self.assertEqual(interaction.action_type, "maintenance")
        self.assertEqual(interaction.priority, "normal")
        self.assertEqual(interaction.feedback_status, "unresolved")

    async def test_quick_action_creates_critical_emergency_signal(self) -> None:
        request = QuickActionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            action_type="emergency",
        )
        current_user = self.db.query(User).filter(User.id == self.user_id).first()

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await submit_quick_action(request, current_user=current_user, db=self.db)

        interaction = self.db.query(InteractionLog).filter(InteractionLog.id == response.interaction_id).first()
        self.assertEqual(response.feedback_status, "unresolved")
        self.assertEqual(response.priority, "critical")
        self.assertEqual(interaction.action_type, "emergency")
        self.assertEqual(interaction.priority, "critical")
        self.assertEqual(interaction.feedback_status, "unresolved")

    async def test_quick_action_rejects_other_operator(self) -> None:
        other_user = User(
            nome="Luigi Bianchi",
            badge_id="67890",
            password_hash="hash",
            ruolo=Ruolo.OPERAIO,
            livello_esperienza=LivelloEsperienza.OPERAIO,
            reparto_legacy="Assemblaggio",
            turno=Turno.MATTINA,
        )
        self.db.add(other_user)
        self.db.commit()
        self.db.refresh(other_user)
        request = QuickActionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            action_type="maintenance",
        )

        with self.assertRaises(HTTPException) as context:
            await submit_quick_action(request, current_user=other_user, db=self.db)

        self.assertEqual(context.exception.status_code, 403)

    async def test_quick_action_rejects_second_open_signal(self) -> None:
        request = QuickActionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            action_type="maintenance",
        )
        current_user = self.db.query(User).filter(User.id == self.user_id).first()

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            await submit_quick_action(request, current_user=current_user, db=self.db)

            with self.assertRaises(HTTPException) as context:
                await submit_quick_action(
                    QuickActionRequest(
                        machine_id=self.machine_id,
                        user_id=self.user_id,
                        action_type="emergency",
                    ),
                    current_user=current_user,
                    db=self.db,
                )

        self.assertEqual(context.exception.status_code, 409)

    async def test_get_pending_quick_action_returns_open_signal(self) -> None:
        current_user = self.db.query(User).filter(User.id == self.user_id).first()

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            created = await submit_quick_action(
                QuickActionRequest(
                    machine_id=self.machine_id,
                    user_id=self.user_id,
                    action_type="maintenance",
                ),
                current_user=current_user,
                db=self.db,
            )

        pending = await get_pending_quick_action(
            machine_id=self.machine_id,
            current_user=current_user,
            db=self.db,
        )

        self.assertIsNotNone(pending)
        self.assertEqual(pending.interaction_id, created.interaction_id)
        self.assertEqual(pending.action_type, "maintenance")
        self.assertEqual(pending.feedback_status, "unresolved")

    async def test_quick_action_is_available_again_after_resolution(self) -> None:
        current_user = self.db.query(User).filter(User.id == self.user_id).first()

        with (
            patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()),
            patch("app.api.interactions.verify_password", return_value=True),
        ):
            created = await submit_quick_action(
                QuickActionRequest(
                    machine_id=self.machine_id,
                    user_id=self.user_id,
                    action_type="maintenance",
                ),
                current_user=current_user,
                db=self.db,
            )

            await resolve_interaction(
                created.interaction_id,
                InteractionResolutionRequest(
                    resolution_note="Richiesta chiusa",
                    technician_username="Tecnico Manutentore",
                    technician_password="password-tecnico",
                ),
                current_user=current_user,
                db=self.db,
            )

            reopened = await submit_quick_action(
                QuickActionRequest(
                    machine_id=self.machine_id,
                    user_id=self.user_id,
                    action_type="emergency",
                ),
                current_user=current_user,
                db=self.db,
            )

        self.assertEqual(reopened.action_type, "emergency")

    def _create_unresolved_interaction(self) -> InteractionLog:
        interaction = InteractionLog(
            user_id=self.user_id,
            machine_id=self.machine_id,
            domanda="La risposta non ha risolto il problema",
            risposta="Procedura suggerita",
            feedback_status="unresolved",
            action_type="question",
            priority="normal",
        )
        self.db.add(interaction)
        self.db.commit()
        self.db.refresh(interaction)
        return interaction

    async def test_resolve_interaction_rejects_regular_operator_without_technician_auth(self) -> None:
        interaction = self._create_unresolved_interaction()
        current_user = self.db.query(User).filter(User.id == self.user_id).first()

        with self.assertRaises(HTTPException) as context:
            await resolve_interaction(
                interaction.id,
                InteractionResolutionRequest(resolution_note="Ripristino effettuato"),
                current_user=current_user,
                db=self.db,
            )

        self.assertEqual(context.exception.status_code, 403)

    async def test_resolve_interaction_rejects_technician_badge_only(self) -> None:
        interaction = self._create_unresolved_interaction()
        current_user = self.db.query(User).filter(User.id == self.user_id).first()

        with self.assertRaises(Exception):
            InteractionResolutionRequest(
                resolution_note="Sostituito sensore",
                technician_badge_id="TECH-001",
            )

        self.db.refresh(interaction)
        self.assertNotEqual(interaction.feedback_status, "resolved")

    async def test_resolve_interaction_accepts_technician_credentials_and_records_resolution(self) -> None:
        interaction = self._create_unresolved_interaction()
        current_user = self.db.query(User).filter(User.id == self.user_id).first()

        with (
            patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()),
            patch("app.api.interactions.verify_password", return_value=True),
        ):
            response = await resolve_interaction(
                interaction.id,
                InteractionResolutionRequest(
                    resolution_note="Sostituito sensore",
                    technician_username="Tecnico Manutentore",
                    technician_password="password-tecnico",
                ),
                current_user=current_user,
                db=self.db,
            )

        self.db.refresh(interaction)
        self.assertEqual(response.feedback_status, "resolved")
        self.assertEqual(response.resolved_by_user_id, self.technician_id)
        self.assertEqual(response.resolution_note, "Sostituito sensore")
        self.assertEqual(interaction.feedback_status, "resolved")
        self.assertEqual(interaction.resolved_by_user_id, self.technician_id)
        self.assertEqual(interaction.resolution_note, "Sostituito sensore")
        self.assertIsNotNone(interaction.resolution_timestamp)

    async def test_resolve_interaction_accepts_admin(self) -> None:
        interaction = self._create_unresolved_interaction()
        admin_user = self.db.query(User).filter(User.id == self.admin_id).first()

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await resolve_interaction(
                interaction.id,
                InteractionResolutionRequest(resolution_note="Chiuso da admin"),
                current_user=admin_user,
                db=self.db,
            )

        self.db.refresh(interaction)
        self.assertEqual(response.feedback_status, "resolved")
        self.assertEqual(response.resolved_by_user_id, self.admin_id)
        self.assertEqual(interaction.resolved_by_user_id, self.admin_id)

    async def test_resolve_interaction_rejects_already_closed_interaction(self) -> None:
        interaction = self._create_unresolved_interaction()
        current_user = self.db.query(User).filter(User.id == self.user_id).first()

        with (
            patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()),
            patch("app.api.interactions.verify_password", return_value=True),
        ):
            await resolve_interaction(
                interaction.id,
                InteractionResolutionRequest(
                    resolution_note="Sostituito sensore",
                    technician_username="Tecnico Manutentore",
                    technician_password="password-tecnico",
                ),
                current_user=current_user,
                db=self.db,
            )

            with self.assertRaises(HTTPException) as context:
                await resolve_interaction(
                    interaction.id,
                    InteractionResolutionRequest(
                        resolution_note="Secondo tentativo",
                        technician_username="Tecnico Manutentore",
                        technician_password="password-tecnico",
                    ),
                    current_user=current_user,
                    db=self.db,
                )

        self.assertEqual(context.exception.status_code, 409)

    async def test_ask_question_returns_clarification_mode(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Qual e la procedura giusta?",
        )
        clarification_result = RetrievalResult(
            mode="clarification",
            response="Ho trovato due procedure simili. Quale descrive meglio il problema?",
            confidence=0.61,
            response_payload=None,
            clarification_options=[
                {"knowledge_item_id": self.item_ids["Cambio olio pressa"], "label": "Cambio olio pressa (Manutenzione)"},
                {"knowledge_item_id": self.item_ids["Sostituzione cinghia trasmissione"], "label": "Sostituzione cinghia trasmissione (Manutenzione)"},
            ],
            route="clarification",
            reason_code="clarification",
            top_candidates=[],
        )

        with patch(
            "app.api.interactions.knowledge_retrieval_service.resolve_question_for_working_station",
            new=AsyncMock(return_value=clarification_result),
        ):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "clarification")
        self.assertEqual(response.reason_code, "clarification")
        self.assertEqual(len(response.clarification_options), 2)
        self.assertEqual(response.clarification_options[0].knowledge_item_id, self.item_ids["Cambio olio pressa"])

    async def test_ask_question_returns_clarification_for_generic_problem_query(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Ho un problema alla macchina",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "clarification")
        self.assertEqual(response.reason_code, "clarification")
        self.assertGreaterEqual(len(response.clarification_options), 2)

    async def test_ask_question_returns_clarification_for_generic_problem_query_with_typo(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Ho un problema alla macchin",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "clarification")
        self.assertEqual(response.reason_code, "clarification")
        self.assertGreaterEqual(len(response.clarification_options), 2)

    async def test_selected_knowledge_item_shortcuts_to_expected_answer(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Serve un chiarimento",
            selected_knowledge_item_id=self.item_ids["Sostituzione cinghia trasmissione"],
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "answer")
        self.assertEqual(response.reason_code, "matched")
        self.assertEqual(response.knowledge_item_id, self.item_ids["Sostituzione cinghia trasmissione"])
        self.assertIn("cinghia", response.response.lower())

    async def test_ask_question_returns_fallback_when_no_match(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Come calibro il sensore di pressione?",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.confidence, 0.0)
        self.assertEqual(response.reason_code, "no_match")
        self.assertEqual(response.knowledge_item_id, None)

    async def test_ask_question_returns_fallback_for_out_of_domain_single_word(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="roblox",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.confidence, 0.0)
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)

    async def test_ask_question_returns_fallback_for_out_of_domain_multiword(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="napoli juve aperol",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.confidence, 0.0)
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)

    async def test_ask_question_returns_fallback_for_long_narrative_query(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="se ni mondo esistesse un po di bene e ogniun si considerassse suo fratello ci sarebbero meno pensieri e meno pene ed il mondo ne sarebbe assai piu bello",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)

    async def test_ask_question_returns_fallback_for_weather_query(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Che tempo fa domani a Milano?",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)

    async def test_ask_question_returns_fallback_for_poetry_request(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Scrivimi una poesia",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)

    async def test_ask_question_returns_fallback_for_extremist_request(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Come posso fondare il 4 reich?",
        )

        with (
            patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()),
            patch(
                "app.services.knowledge_retrieval.generate_out_of_scope_response",
                new=AsyncMock(return_value="Non posso aiutarti su questa richiesta. Posso invece supportarti con domande tecniche su macchine, sicurezza e procedure di reparto."),
            ),
        ):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)
        self.assertIn("macchine", response.response.lower())

    def test_requires_llm_verification_for_weak_match(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)
        candidate = indexed_candidates[0]
        scored_candidate = ScoredKnowledgeCandidate(
            item=candidate,
            score=8.1,
            exact_keyword_matches=0,
            keyword_overlap=0,
            title_overlap=0,
            example_overlap=0,
            answer_overlap=1,
            root_overlap=0,
            fuzzy_score=0.72,
            best_token_similarity=0.74,
            strong_technical_matches=1,
        )

        self.assertTrue(knowledge_retrieval_service._requires_llm_verification(scored_candidate, 0.76))

    def test_align_existing_seed_data_updates_legacy_operazioni_items(self) -> None:
        operazioni = Category(name="Operazioni", description="Procedure operative")
        legacy_item = KnowledgeItem(
            category=operazioni,
            question_title="velocita",
            answer_text="Per regolare la velocita di lavoro: utilizzare il potenziometro sul pannello di controllo, non superare il 90% per materiali delicati",
            keywords="velocita, potenziometro, regolazione, materiali delicati",
            example_questions="Come regolo la velocita?\nDove imposto la velocita di lavoro?\nPosso aumentare il potenziometro?",
            is_active=True,
            sort_order=1,
        )
        self.db.add_all([operazioni, legacy_item])
        self.db.commit()

        updated_items = align_existing_seed_data(self.db)
        self.db.commit()
        self.db.refresh(legacy_item)

        self.assertEqual(updated_items, 1)
        self.assertEqual(legacy_item.question_title, "Regolazione velocita dal pannello")
        self.assertIn("pannello macchina", legacy_item.example_questions.lower())

    async def test_clear_session_history_reopens_empty_chat_session_without_deleting_logs(self) -> None:
        machine = self.db.query(Machine).filter(Machine.id == self.machine_id).first()
        current_user = self.db.query(User).filter(User.id == self.user_id).first()
        working_station = WorkingStation(
            name="Postazione Clear Chat",
            station_code="CLR-01",
            description="Postazione usata per il test di svuotamento chat",
            assigned_machine=machine,
            startup_checklist=[],
            in_uso=True,
            operatore_attuale_id=self.user_id,
        )
        self.db.add(working_station)
        self.db.flush()

        chat_session = OperatorChatSession(
            user_id=self.user_id,
            working_station_id=working_station.id,
            is_active=True,
        )
        self.db.add(chat_session)
        self.db.flush()

        interaction = InteractionLog(
            user_id=self.user_id,
            machine_id=self.machine_id,
            working_station_id=working_station.id,
            chat_session_id=chat_session.id,
            domanda="Messaggio da svuotare",
            risposta="Risposta da non mostrare piu in chat",
            action_type="question",
            feedback_status="resolved",
        )
        self.db.add(interaction)
        self.db.commit()

        response = await clear_session_history(
            InteractionTargetRequest(working_station_id=working_station.id),
            current_user=current_user,
            db=self.db,
        )

        self.db.refresh(chat_session)
        self.db.refresh(interaction)

        self.assertEqual(response.working_station_id, working_station.id)
        self.assertEqual(response.machine_id, self.machine_id)
        self.assertEqual(response.messages, [])
        self.assertIsNotNone(response.chat_session_id)
        self.assertNotEqual(response.chat_session_id, chat_session.id)
        self.assertFalse(chat_session.is_active)
        self.assertIsNone(interaction.chat_session_id)


class IndexedKnowledgeItemTestCase(unittest.TestCase):
    def test_indexed_item_builds_normalized_tokens(self) -> None:
        category = Category(id=1, name="Manutenzione")
        item = KnowledgeItem(
            id=7,
            category_id=1,
            category=category,
            question_title="Cambio olio pressa",
            answer_text="Spegni la macchina e scarica il serbatoio dell'olio.",
            keywords="olio, cambio olio",
            example_questions="Come cambio l'olio della pressa?\nDevo sostituire l'olio macchina",
            sort_order=1,
            is_active=True,
        )

        indexed = IndexedKnowledgeItem.from_model(item)

        self.assertIn("olio", indexed.keyword_tokens)
        self.assertIn("pressa", indexed.title_tokens)
        self.assertIn("macchina", indexed.example_tokens)
        self.assertEqual(indexed.knowledge_item_id, 7)


if __name__ == "__main__":
    unittest.main()


