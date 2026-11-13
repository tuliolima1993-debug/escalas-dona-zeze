import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { uid } from '@/domain/mutations';
import type { Sector, Skill } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { Badge } from '@/components/ui/misc';
import { cn, readableOn } from '@/lib/utils';

export const PALETTE = ['#7c3aed', '#16a34a', '#d97706', '#0e7490', '#047857', '#db2777', '#2563eb', '#dc2626', '#65a30d', '#475569'];

type Item = (Sector | Skill) & { defaultSkillId?: string | null };

export function CatalogPanel({ kind }: { kind: 'sector' | 'skill' }) {
  const { s, can, run } = useSnapshot();
  const items: Item[] = kind === 'sector' ? s.sectors : s.skills;
  const [editing, setEditing] = useState<Item | null>(null);
  const countFor = (id: string) =>
    kind === 'sector' ? s.employees.filter((e) => e.sectorId === id && e.status !== 'inactive').length : s.employees.filter((e) => e.skillIds.includes(id) && e.status !== 'inactive').length;
  const label = kind === 'sector' ? 'setor' : 'habilidade';

  const save = async () => {
    if (!editing) return;
    const ok = kind === 'sector'
      ? await run((r) => r.saveSector({ ...(editing as Sector), id: editing.id || uid() }), 'Setor salvo.')
      : await run((r) => r.saveSkill({ ...(editing as Skill), id: editing.id || uid() }), 'Habilidade salva.');
    if (ok) setEditing(null);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {kind === 'sector' ? 'Repartições internas do cultivo. A atividade padrão é usada quando a pessoa não ocupa uma vaga obrigatória.' : 'Atividades que podem ser atribuídas nos sábados. A cor identifica a atividade nos cartões e na impressão.'}
        </p>
        {can.admin && <Button size="sm" onClick={() => setEditing({ id: '', name: '', color: PALETTE[items.length % PALETTE.length], active: true, sortOrder: items.length + 1, defaultSkillId: null })}><Plus />Nov{kind === 'sector' ? 'o setor' : 'a habilidade'}</Button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...items].sort((a, b) => a.sortOrder - b.sortOrder).map((it) => (
          <Card key={it.id} className={cn('flex items-center gap-3 p-4', !it.active && 'opacity-50')}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-extrabold" style={{ backgroundColor: it.color, color: readableOn(it.color) }}>{it.name.slice(0, 2).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{it.name} {!it.active && <Badge>Inativo</Badge>}</p>
              <p className="text-xs text-muted-foreground">
                {countFor(it.id)} colaborador(es)
                {kind === 'sector' && <> · padrão: {s.skills.find((k) => k.id === it.defaultSkillId)?.name ?? 'conforme habilidade'}</>}
                {kind === 'skill' && s.requirements.some((r) => r.skillId === it.id && r.mandatory && r.minCount > 0) && <> · obrigatória</>}
              </p>
            </div>
            {can.admin && <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditing({ ...it })}><Pencil /></Button>}
          </Card>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? `Editar ${label}` : `Nov${kind === 'sector' ? 'o' : 'a'} ${label}`}</DialogTitle></DialogHeader>
          {editing && (
            <DialogBody className="space-y-4">
              <Field label="Nome" error={editing.name.trim().length < 2 ? 'Informe ao menos 2 caracteres.' : undefined}>
                <Input value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Cor de identificação">
                <div className="flex flex-wrap items-center gap-2">
                  {PALETTE.map((c) => (
                    <button key={c} aria-label={c} onClick={() => setEditing({ ...editing, color: c })} className={cn('h-8 w-8 rounded-full ring-offset-2 transition', editing.color === c && 'ring-2 ring-slate-900')} style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-border" />
                </div>
              </Field>
              {kind === 'sector' && (
                <Field label="Atividade padrão do setor">
                  <Select value={editing.defaultSkillId ?? ''} onChange={(e) => setEditing({ ...editing, defaultSkillId: e.target.value || null })}>
                    <option value="">Primeira habilidade da pessoa</option>
                    {s.skills.filter((k) => k.active).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </Select>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Ordem de exibição"><Input type="number" value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: +e.target.value })} /></Field>
                <Field label="Situação"><label className="flex h-10 items-center gap-2 text-sm"><Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />{editing.active ? 'Ativo' : 'Inativo'}</label></Field>
              </div>
            </DialogBody>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button disabled={!editing || editing.name.trim().length < 2} onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
