import { useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';
import { Edit2, FolderTree, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminCategory, AdminMachine, KnowledgeItem } from './adminTypes';

interface KnowledgeManagerProps {
  categories: AdminCategory[];
  machines: AdminMachine[];
  onMetadataRefresh: () => Promise<void>;
}

const emptyForm = {
  category_id: '',
  question_title: '',
  answer_text: '',
  keywords: '',
  example_questions: '',
  sort_order: '0',
  machine_ids: [] as number[],
  is_active: true,
};

export const KnowledgeManager = ({ categories, machines, onMetadataRefresh }: KnowledgeManagerProps) => {
  const { apiCall } = useApiClient();
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [formState, setFormState] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  const fetchKnowledgeItems = async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(`${API_ENDPOINTS.LIST_KNOWLEDGE_ITEMS}?include_inactive=true`);
      if (!response.ok) {
        throw new Error('Errore nel caricamento knowledge');
      }
      const data = (await response.json()) as KnowledgeItem[];
      setKnowledgeItems(data);
      if (!selectedItemId && data[0]) {
        setSelectedItemId(data[0].id);
      }
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento knowledge');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchKnowledgeItems();
  }, [apiCall]);

  const visibleItems = useMemo(() => {
    return knowledgeItems.filter((item) => selectedCategoryId === 'all' || String(item.category_id) === selectedCategoryId);
  }, [knowledgeItems, selectedCategoryId]);

  const selectedItem = useMemo(() => {
    return visibleItems.find((item) => item.id === selectedItemId) ?? null;
  }, [selectedItemId, visibleItems]);

  const openCreateForm = () => {
    setEditingItem(null);
    setFormState({
      ...emptyForm,
      category_id: selectedCategoryId !== 'all' ? selectedCategoryId : categories[0] ? String(categories[0].id) : '',
    });
    setIsFormOpen(true);
  };

  const openEditForm = (item: KnowledgeItem) => {
    setEditingItem(item);
    setFormState({
      category_id: String(item.category_id),
      question_title: item.question_title,
      answer_text: item.answer_text,
      keywords: item.keywords || '',
      example_questions: item.example_questions || '',
      sort_order: String(item.sort_order),
      machine_ids: item.assigned_machine_ids,
      is_active: item.is_active,
    });
    setIsFormOpen(true);
  };

  const handleMachineToggle = (machineId: number) => {
    setFormState((currentState) => ({
      ...currentState,
      machine_ids: currentState.machine_ids.includes(machineId)
        ? currentState.machine_ids.filter((id) => id !== machineId)
        : [...currentState.machine_ids, machineId],
    }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formState.category_id || !formState.question_title.trim() || !formState.answer_text.trim()) {
      toast.error('Compila categoria, titolo e risposta.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        category_id: Number(formState.category_id),
        question_title: formState.question_title.trim(),
        answer_text: formState.answer_text.trim(),
        keywords: formState.keywords.trim() || null,
        example_questions: formState.example_questions.trim() || null,
        sort_order: Number(formState.sort_order) || 0,
        machine_ids: formState.machine_ids,
        is_active: formState.is_active,
      };

      const response = await apiCall(
        editingItem ? API_ENDPOINTS.UPDATE_KNOWLEDGE_ITEM(editingItem.id) : API_ENDPOINTS.CREATE_KNOWLEDGE_ITEM,
        {
          method: editingItem ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error('Errore nel salvataggio knowledge item');
      }

      toast.success(editingItem ? 'Knowledge item aggiornato' : 'Knowledge item creato');
      setIsFormOpen(false);
      await fetchKnowledgeItems();
      await onMetadataRefresh();
    } catch (error) {
      console.error(error);
      toast.error('Errore nel salvataggio knowledge item');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (itemId: number) => {
    try {
      const response = await apiCall(API_ENDPOINTS.DELETE_KNOWLEDGE_ITEM(itemId), { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Errore durante eliminazione');
      }
      toast.success('Knowledge item eliminato');
      setSelectedItemId(null);
      await fetchKnowledgeItems();
    } catch (error) {
      console.error(error);
      toast.error('Errore durante eliminazione knowledge item');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <FolderTree className="h-5 w-5 text-sky-600" />
              <h3 className="text-lg font-semibold">Knowledge</h3>
            </div>
            <p className="text-sm text-slate-500">
              Categorie globali condivise, con template assegnati ai macchinari.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Tutte le categorie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le categorie</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={String(category.id)}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={openCreateForm} className="gap-2">
              <Plus className="h-4 w-4" />
              Nuovo template
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Categorie</p>
          </div>
          <ScrollArea className="h-[280px] xl:h-[520px]">
            <div className="space-y-1 p-2">
              {categories.map((category) => {
                const isSelected = selectedCategoryId === String(category.id);
                const count = knowledgeItems.filter((item) => item.category_id === category.id).length;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(String(category.id))}
                    className={`w-full rounded-lg px-3 py-3 text-left transition ${
                      isSelected ? 'bg-sky-50 text-sky-900' : 'hover:bg-slate-50'
                    }`}
                  >
                    <p className="font-medium">{category.name}</p>
                    <p className="text-xs text-slate-500">{count} template</p>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Template</p>
              <p className="text-xs text-slate-500">{visibleItems.length} risultati</p>
            </div>
          </div>
          <ScrollArea className="h-[320px] xl:h-[520px]">
            <div className="space-y-2 p-3">
              {isLoading ? (
                <p className="text-sm text-slate-500">Caricamento template...</p>
              ) : visibleItems.length === 0 ? (
                <p className="text-sm text-slate-500">Nessun template per questa categoria.</p>
              ) : (
                visibleItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedItemId(item.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      selectedItemId === item.id
                        ? 'border-sky-300 bg-sky-50'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{item.question_title}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-500">{item.answer_text}</p>
                      </div>
                      <Badge variant={item.is_active ? 'outline' : 'secondary'}>
                        {item.is_active ? 'Attivo' : 'Disattivo'}
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Assegnazione</p>
          </div>
          <div className="space-y-4 p-4">
            {!selectedItem ? (
              <p className="text-sm text-slate-500">Seleziona un template per vedere dettagli e assegnazioni.</p>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold text-slate-900">{selectedItem.question_title}</h4>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEditForm(selectedItem)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDelete(selectedItem.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{selectedItem.answer_text}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Macchinari assegnati</p>
                  <div className="mt-3 space-y-2">
                    {machines.map((machine) => {
                      const assigned = selectedItem.assigned_machine_ids.includes(machine.id);
                      return (
                        <div
                          key={machine.id}
                          className={`rounded-lg border px-3 py-2 text-sm ${
                            assigned ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 text-slate-500'
                          }`}
                        >
                          <p className="font-medium">{machine.nome}</p>
                          <p className="text-xs">{machine.department_name || machine.reparto || '-'}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Modifica template' : 'Nuovo template'}</DialogTitle>
            <DialogDescription>
              Definisci categoria, risposta e assegnazioni macchina in un unico flusso.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Categoria</label>
                <Select
                  value={formState.category_id}
                  onValueChange={(value) => setFormState((currentState) => ({ ...currentState, category_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={String(category.id)}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Ordine</label>
                <Input
                  value={formState.sort_order}
                  onChange={(event) => setFormState((currentState) => ({ ...currentState, sort_order: event.target.value }))}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Titolo domanda/template</label>
                <Input
                  value={formState.question_title}
                  onChange={(event) => setFormState((currentState) => ({ ...currentState, question_title: event.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Risposta</label>
                <Textarea
                  className="min-h-32"
                  value={formState.answer_text}
                  onChange={(event) => setFormState((currentState) => ({ ...currentState, answer_text: event.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Keyword</label>
                <Input
                  value={formState.keywords}
                  onChange={(event) => setFormState((currentState) => ({ ...currentState, keywords: event.target.value }))}
                  placeholder="es. olio, manutenzione ordinaria, filtro"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Esempi di domande</label>
                <Textarea
                  className="min-h-28"
                  value={formState.example_questions}
                  onChange={(event) =>
                    setFormState((currentState) => ({ ...currentState, example_questions: event.target.value }))
                  }
                  placeholder={"Una domanda per riga\nCome cambio l'olio?\nLa pressa fa rumore, cosa controllo?"}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-slate-900">Assegna ai macchinari</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormState((currentState) => ({ ...currentState, machine_ids: machines.map((machine) => machine.id) }))}
                >
                  Seleziona tutti
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {machines.map((machine) => {
                  const checked = formState.machine_ids.includes(machine.id);
                  return (
                    <button
                      key={machine.id}
                      type="button"
                      onClick={() => handleMachineToggle(machine.id)}
                      className={`rounded-lg border px-3 py-3 text-left transition ${
                        checked ? 'border-sky-300 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <p className="font-medium text-slate-900">{machine.nome}</p>
                      <p className="text-xs text-slate-500">{machine.department_name || machine.reparto || '-'}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                Annulla
              </Button>
              <Button type="submit" disabled={isSaving} className="gap-2">
                <Save className="h-4 w-4" />
                {isSaving ? 'Salvataggio...' : 'Salva template'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
