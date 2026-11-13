/**
 * Modo demonstração: mesmos contratos e regras do Supabase, com dados guardados no navegador.
 * Útil para avaliar o sistema antes de conectar o banco (VITE_DATA_MODE=demo).
 */
import { buildGenerateInput, resultToCommit } from '@/domain/generate-input';
import * as M from '@/domain/mutations';
import { generateSchedule } from '@/domain/scheduler';
import { seedSnapshot } from '@/domain/seed';
import type { AuditEntry, Profile, Role, Snapshot } from '@/domain/types';
import type { Repository } from './repository';

const KEY = 'dzc-escalas-demo-v1';
const AUDIT_KEY = 'dzc-escalas-demo-audit-v1';
const ROLE_KEY = 'dzc-escalas-demo-role';

const memory: Record<string, string> = {};
const store = {
  get(k: string) {
    try { return localStorage.getItem(k) ?? memory[k] ?? null; } catch { return memory[k] ?? null; }
  },
  set(k: string, v: string) {
    memory[k] = v;
    try { localStorage.setItem(k, v); } catch { /* armazenamento indisponível: mantém em memória */ }
  },
  del(k: string) {
    delete memory[k];
    try { localStorage.removeItem(k); } catch { /* noop */ }
  },
};

/** Cria um histórico realista: setembro e outubro encerrados com presença, novembro publicado. */
function buildDemoData(): Snapshot {
  let s = seedSnapshot();
  const today = new Date().toISOString().slice(0, 10);
  const months: [number, number][] = [[2026, 9], [2026, 10], [2026, 11]];
  for (const [y, m] of months) {
    const r = generateSchedule(buildGenerateInput(s, y, m));
    s = M.commitMonth(s, resultToCommit(r, y, m));
    const sc = s.schedules.find((x) => x.year === y && x.month === m)!;
    for (const wd of s.workDays.filter((w) => w.scheduleId === sc.id && w.date < today)) {
      for (const a of s.assignments.filter((x) => x.workDayId === wd.id && x.status === 'active' && x.employeeId)) {
        a.attendance = 'present';
      }
      wd.locked = true;
    }
    s = M.setScheduleStatus(s, y, m, m === 11 ? 'published' : 'closed');
  }
  // Uma ausência com substituição registrada em outubro, para ilustrar os relatórios
  const oct = s.workDays.find((w) => w.date === '2026-10-17');
  if (oct) {
    const sc = s.schedules.find((x) => x.id === oct.scheduleId)!;
    sc.status = 'published';
    oct.locked = false;
    const a = s.assignments.find((x) => x.workDayId === oct.id && x.status === 'active' && x.activityId === 'sk-cultivo');
    const sub = s.employees.find((e) => e.skillIds.includes('sk-cultivo') && !s.assignments.some((x) => x.workDayId === oct.id && x.employeeId === e.id && x.status === 'active'));
    if (a && sub) {
      a.attendance = 'absent';
      s = M.replaceAssignment(s, a.id, sub.id, 'sk-cultivo');
      const n = s.assignments.find((x) => x.workDayId === oct.id && x.employeeId === sub.id && x.status === 'active')!;
      n.attendance = 'present';
    }
    s.workDays.find((w) => w.id === oct.id)!.locked = true;
    s.schedules.find((x) => x.id === sc.id)!.status = 'closed';
  }
  s.unavailability.push({ id: 'un-demo-1', employeeId: 'em-tatiana', startDate: '2026-12-19', endDate: '2026-12-31', reason: 'Férias programadas' });
  return s;
}

function diff(before: Snapshot, after: Snapshot) {
  const out: { entity: string; id: string; before: unknown; after: unknown }[] = [];
  const keys = ['employees', 'sectors', 'skills', 'unavailability', 'schedules', 'workDays', 'assignments'] as const;
  if (JSON.stringify(before.quotas ?? []) !== JSON.stringify(after.quotas ?? [])) out.push({ entity: 'quotas', id: 'quotas', before: before.quotas ?? [], after: after.quotas ?? [] });
  for (const k of keys) {
    const b = new Map((before[k] as { id: string }[]).map((x) => [x.id, x]));
    const a = new Map((after[k] as { id: string }[]).map((x) => [x.id, x]));
    for (const [id, x] of a) {
      const y = b.get(id);
      if (!y) out.push({ entity: k, id, before: null, after: x });
      else if (JSON.stringify(y) !== JSON.stringify(x)) {
        const { updatedAt: _u1, ...yy } = y as any;
        const { updatedAt: _u2, ...xx } = x as any;
        if (JSON.stringify(yy) !== JSON.stringify(xx)) out.push({ entity: k, id, before: y, after: x });
      }
    }
    for (const [id, y] of b) if (!a.has(id)) out.push({ entity: k, id, before: y, after: null });
  }
  if (JSON.stringify(before.settings) !== JSON.stringify(after.settings) || JSON.stringify(before.requirements) !== JSON.stringify(after.requirements))
    out.push({ entity: 'settings', id: 'settings', before: { ...before.settings, requirements: before.requirements }, after: { ...after.settings, requirements: after.requirements } });
  return out;
}

export function createDemoRepository(): Repository {
  const read = (): Snapshot => {
    const raw = store.get(KEY);
    if (raw) {
      try { return JSON.parse(raw); } catch { /* recria */ }
    }
    const s = buildDemoData();
    store.set(KEY, JSON.stringify(s));
    return s;
  };
  const readAudit = (): AuditEntry[] => {
    try { return JSON.parse(store.get(AUDIT_KEY) ?? '[]'); } catch { return []; }
  };
  const role = (): Role => (store.get(ROLE_KEY) as Role) || 'admin';
  const profile = (): Profile => ({ id: 'demo-user', name: 'Administrador (demo)', email: 'demo@local', role: role() });

  const apply = async (summary: string, fn: (s: Snapshot) => Snapshot) => {
    const r = role();
    if (r === 'viewer') throw new M.DomainError('Perfil visualizador não pode alterar informações.');
    const before = read();
    const after = fn(before);
    const changes = diff(before, after);
    store.set(KEY, JSON.stringify(after));
    const audit = readAudit();
    const at = new Date().toISOString();
    for (const c of changes.slice(0, 40)) {
      audit.unshift({
        id: M.uid(), at, userName: profile().name, entity: c.entity, entityId: c.id,
        action: c.before == null ? 'insert' : c.after == null ? 'delete' : 'update',
        summary, before: c.before, after: c.after,
      });
    }
    store.set(AUDIT_KEY, JSON.stringify(audit.slice(0, 500)));
  };
  const adminOnly = () => {
    if (role() !== 'admin') throw new M.DomainError('Apenas administradores podem realizar esta ação.');
  };

  const listeners = new Set<() => void>();

  return {
    mode: 'demo',
    async currentProfile() { return profile(); },
    async signIn() {},
    async signOut() {},
    async resetPassword() {},
    onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    async load() {
      const s = read();
      if (role() === 'viewer') {
        const visible = new Set(s.schedules.filter((x) => x.status !== 'draft').map((x) => x.id));
        const wds = s.workDays.filter((w) => visible.has(w.scheduleId));
        const wdIds = new Set(wds.map((w) => w.id));
        return {
          ...s,
          employees: s.employees.map((e) => ({ ...e, adminNotes: null, restrictions: null })),
          unavailability: [],
          schedules: s.schedules.filter((x) => visible.has(x.id)),
          workDays: wds,
          assignments: s.assignments.filter((a) => wdIds.has(a.workDayId)),
        };
      }
      return s;
    },

    async saveEmployee(e) {
      adminOnly();
      await apply(`Cadastro de ${e.shortName}`, (s) => {
        const next = structuredClone(s);
        const i = next.employees.findIndex((x) => x.id === e.id);
        if (i >= 0) next.employees[i] = e; else next.employees.push({ ...e, id: e.id || M.uid() });
        return next;
      });
    },
    async saveSector(sec) {
      adminOnly();
      await apply(`Setor ${sec.name}`, (s) => {
        const next = structuredClone(s);
        const i = next.sectors.findIndex((x) => x.id === sec.id);
        if (next.sectors.some((x) => x.name.toLowerCase() === sec.name.toLowerCase() && x.id !== sec.id)) throw new M.DomainError('Já existe um setor com esse nome.');
        if (i >= 0) next.sectors[i] = sec; else next.sectors.push({ ...sec, id: sec.id || M.uid() });
        return next;
      });
    },
    async saveSkill(sk) {
      adminOnly();
      await apply(`Habilidade ${sk.name}`, (s) => {
        const next = structuredClone(s);
        if (next.skills.some((x) => x.name.toLowerCase() === sk.name.toLowerCase() && x.id !== sk.id)) throw new M.DomainError('Já existe uma habilidade com esse nome.');
        const i = next.skills.findIndex((x) => x.id === sk.id);
        if (i >= 0) next.skills[i] = sk; else next.skills.push({ ...sk, id: sk.id || M.uid() });
        return next;
      });
    },
    async addUnavailability(u) {
      await apply('Indisponibilidade registrada', (s) => ({ ...structuredClone(s), unavailability: [...s.unavailability, { ...u, id: M.uid() }] }));
    },
    async removeUnavailability(id) {
      await apply('Indisponibilidade removida', (s) => ({ ...structuredClone(s), unavailability: s.unavailability.filter((u) => u.id !== id) }));
    },
    async saveSettings(settings, requirements) {
      adminOnly();
      await apply('Configurações alteradas', (s) => ({ ...structuredClone(s), settings, requirements }));
    },

    async commitMonth(p) { await apply(`Geração automática ${p.month}/${p.year}`, (s) => M.commitMonth(s, p)); },
    async addAssignment(date, m) { await apply('Colaborador adicionado', (s) => M.addAssignment(s, date, m)); },
    async updateAssignment(id, patch) {
      await apply(patch.attendance !== undefined && Object.keys(patch).length === 1 ? 'Presença registrada' : 'Participação editada', (s) => M.updateAssignment(s, id, patch));
    },
    async removeAssignment(id) { await apply('Colaborador removido', (s) => M.removeAssignment(s, id)); },
    async replaceAssignment(id, emp, act) { await apply('Substituição', (s) => M.replaceAssignment(s, id, emp, act)); },
    async moveReplacing(a, b) { await apply('Movido para o lugar de outra pessoa', (s) => M.moveReplacing(s, a, b)); },
    async swapAssignments(a, b) { await apply('Troca entre sábados', (s) => M.swapAssignments(s, a, b)); },
    async moveAssignment(id, date) { await apply('Movido para outro sábado', (s) => M.moveAssignment(s, id, date)); },
    async setDayLocked(date, locked) { await apply(locked ? 'Sábado bloqueado' : 'Sábado desbloqueado', (s) => M.setDayLocked(s, date, locked)); },
    async updateWorkDay(date, patch) { await apply('Sábado editado', (s) => M.updateWorkDay(s, date, patch)); },
    async saveExtraDay(x) { await apply(`Data extra ${x.date}`, (s) => M.saveExtraDay(s, x)); },
    async removeExtraDay(date) { await apply('Data extra removida', (s) => M.removeExtraDay(s, date)); },
    async setQuotas(y, m, q, enable) { await apply(enable ? 'Cotas do mês' : 'Banco de cotas desativado', (s) => M.setQuotas(s, y, m, q, enable)); },
    async setScheduleStatus(y, m, st) { await apply(`Escala ${m}/${y}: ${st}`, (s) => M.setScheduleStatus(s, y, m, st)); },

    async listAudit(limit = 200) { return readAudit().slice(0, limit); },
    async listProfiles() {
      return [profile(), { id: 'demo-sup', name: 'Supervisor (exemplo)', email: 'supervisor@exemplo', role: 'supervisor' }, { id: 'demo-view', name: 'Quadro de avisos (exemplo)', email: 'quadro@exemplo', role: 'viewer' }];
    },
    async updateRole(userId, r) {
      if (userId === 'demo-user') {
        store.set(ROLE_KEY, r);
        listeners.forEach((l) => l());
      }
    },
    async inviteUser() {
      throw new M.DomainError('No modo demonstração não há envio de convites. Conecte o Supabase para gerenciar usuários.');
    },
  };
}

export function resetDemoData() {
  store.del(KEY);
  store.del(AUDIT_KEY);
}
export function setDemoRole(r: Role) {
  store.set(ROLE_KEY, r);
}
