import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from '@/domain/mutations';
import { DEFAULT_SETTINGS, type AuditEntry, type Profile, type Snapshot } from '@/domain/types';
import type { Repository } from './repository';

const t5 = (t: string | null | undefined) => (t ?? '').slice(0, 5);

/** Converte erros do PostgREST/Postgres em mensagens legíveis. */
function check<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) {
    const msg = r.error.message;
    if (r.error.code === '23505' || /duplicate key/.test(msg)) throw new DomainError('Registro duplicado: a pessoa já está escalada neste sábado ou o nome já existe.');
    if (r.error.code === '42501' || /row-level security/.test(msg)) throw new DomainError('Você não tem permissão para esta ação.');
    if (/Failed to fetch|NetworkError/.test(msg)) throw new DomainError('Sem conexão com o servidor. Nada foi alterado; tente novamente.');
    throw new DomainError(msg);
  }
  return r.data;
}

export function createSupabaseRepository(url: string, anonKey: string): Repository {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const rpc = async (fn: string, args: Record<string, unknown>) => check(await sb.rpc(fn, args));

  return {
    mode: 'supabase',

    async currentProfile() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return null;
      const p = check(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
      if (!p) return { id: user.id, name: user.email ?? '', email: user.email ?? '', role: 'viewer' };
      return { id: p.id, name: p.name, email: p.email, role: p.role };
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new DomainError(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) throw new DomainError(error.message);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },

    async load(): Promise<Snapshot> {
      const [skills, sectors, employees, empSkills, priv, unav, settings, reqs, schedules, workDays, assignments, quotas] = await Promise.all([
        sb.from('skills').select('*').order('sort_order'),
        sb.from('sectors').select('*').order('sort_order'),
        sb.from('employees').select('*').order('short_name'),
        sb.from('employee_skills').select('*'),
        sb.from('employee_private').select('*'),
        sb.from('unavailability').select('*'),
        sb.from('settings').select('*').eq('id', 1).maybeSingle(),
        sb.from('activity_requirements').select('*'),
        sb.from('schedules').select('*'),
        sb.from('work_days').select('*').order('date'),
        sb.from('assignments').select('*'),
        sb.from('monthly_quotas').select('*'),
      ]).then((rs) => rs.map((r) => check(r as any)) as any[]);
      const st = settings ?? {};
      const privById = new Map((priv ?? []).map((p: any) => [p.employee_id, p]));
      return {
        skills: skills.map((s: any) => ({ id: s.id, name: s.name, color: s.color, active: s.active, sortOrder: s.sort_order })),
        sectors: sectors.map((s: any) => ({ id: s.id, name: s.name, color: s.color, defaultSkillId: s.default_skill_id, active: s.active, sortOrder: s.sort_order })),
        employees: employees.map((e: any) => ({
          id: e.id, fullName: e.full_name, shortName: e.short_name, registration: e.registration, sectorId: e.sector_id,
          skillIds: empSkills.filter((x: any) => x.employee_id === e.id).map((x: any) => x.skill_id),
          admissionDate: e.admission_date, status: e.status, maxPerMonth: e.max_per_month,
          restrictions: (privById.get(e.id) as any)?.restrictions ?? null, adminNotes: (privById.get(e.id) as any)?.admin_notes ?? null,
        })),
        unavailability: unav.map((u: any) => ({ id: u.id, employeeId: u.employee_id, startDate: u.start_date, endDate: u.end_date, reason: u.reason })),
        settings: {
          orgName: st.org_name ?? DEFAULT_SETTINGS.orgName,
          idealPerDay: st.ideal_per_day ?? 4,
          maxPerDay: st.max_per_day ?? 4,
          startTime: t5(st.start_time) || '06:00',
          endTime: t5(st.end_time) || '09:00',
          maxPerMonth: st.max_per_month ?? 2,
          avoidConsecutive: st.avoid_consecutive ?? true,
          minGapWeeks: st.min_gap_weeks ?? 2,
          balancePriority: st.balance_priority ?? 'high',
          considerHistoryMonths: st.consider_history_months ?? 0,
          print: { ...DEFAULT_SETTINGS.print, ...(st.print ?? {}) },
        },
        requirements: reqs.map((r: any) => ({ skillId: r.skill_id, minCount: r.min_count, mandatory: r.mandatory })),
        schedules: schedules.map((s: any) => ({ id: s.id, year: s.year, month: s.month, status: s.status, publishedAt: s.published_at, updatedAt: s.updated_at, useQuotas: !!s.use_quotas })),
        workDays: workDays.map((w: any) => ({ id: w.id, scheduleId: w.schedule_id, date: w.date, startTime: t5(w.start_time), endTime: t5(w.end_time), locked: w.locked, note: w.note,
          kind: w.kind ?? 'regular', label: w.label ?? null, countsInQuota: w.counts_in_quota ?? true, idealSize: w.ideal_size ?? null,
          requirements: Array.isArray(w.requirements) ? w.requirements.map((r: any) => ({ skillId: r.skillId, minCount: Number(r.minCount), mandatory: r.mandatory !== false })) : null })),
        quotas: (quotas ?? []).map((q: any) => ({ scheduleId: q.schedule_id, employeeId: q.employee_id, quota: q.quota })),
        assignments: assignments.map((a: any) => ({
          id: a.id, workDayId: a.work_day_id, employeeId: a.employee_id, activityId: a.activity_id, reservedLabel: a.reserved_label,
          requiredSkillId: a.required_skill_id, status: a.status, attendance: a.attendance, replacedById: a.replaced_by_id, position: a.position, createdAt: a.created_at,
        })),
      };
    },

    async saveEmployee(e) {
      await rpc('save_employee', {
        p: {
          id: e.id || null, fullName: e.fullName.trim(), shortName: e.shortName.trim(), registration: e.registration ?? '',
          sectorId: e.sectorId ?? '', admissionDate: e.admissionDate ?? '', status: e.status, maxPerMonth: e.maxPerMonth ?? '',
          restrictions: e.restrictions ?? '', adminNotes: e.adminNotes ?? '', skillIds: e.skillIds,
        },
      });
    },
    async saveSector(s) {
      const row: Record<string, unknown> = { name: s.name.trim(), color: s.color, default_skill_id: s.defaultSkillId, active: s.active, sort_order: s.sortOrder };
      check(await sb.from('sectors').upsert(s.id ? { id: s.id, ...row } : row));
    },
    async saveSkill(s) {
      const row: Record<string, unknown> = { name: s.name.trim(), color: s.color, active: s.active, sort_order: s.sortOrder };
      check(await sb.from('skills').upsert(s.id ? { id: s.id, ...row } : row));
    },
    async addUnavailability(u) {
      check(await sb.from('unavailability').insert({ employee_id: u.employeeId, start_date: u.startDate, end_date: u.endDate, reason: u.reason }));
    },
    async removeUnavailability(id) {
      check(await sb.from('unavailability').delete().eq('id', id));
    },
    async saveSettings(s, req) {
      await rpc('save_settings', { p_settings: s, p_requirements: req });
    },

    async commitMonth(p) {
      await rpc('commit_month', { p_year: p.year, p_month: p.month, p_days: p.days });
    },
    async addAssignment(date, m) {
      await rpc('add_assignment', { p_date: date, p_employee: m.employeeId, p_activity: m.activityId, p_reserved_label: m.reservedLabel, p_required_skill: m.requiredSkillId });
    },
    async updateAssignment(id, patch) {
      const row: Record<string, unknown> = {};
      if ('employeeId' in patch) row.employee_id = patch.employeeId;
      if ('activityId' in patch) row.activity_id = patch.activityId;
      if ('reservedLabel' in patch) row.reserved_label = patch.reservedLabel;
      if ('requiredSkillId' in patch) row.required_skill_id = patch.requiredSkillId;
      if ('attendance' in patch) row.attendance = patch.attendance;
      check(await sb.from('assignments').update(row).eq('id', id));
    },
    async removeAssignment(id) {
      check(await sb.from('assignments').delete().eq('id', id));
    },
    async replaceAssignment(id, employeeId, activityId) {
      await rpc('replace_assignment', { p_id: id, p_employee: employeeId, p_activity: activityId });
    },
    async swapAssignments(a, b) {
      await rpc('swap_assignments', { p_a: a, p_b: b });
    },
    async moveReplacing(sourceId, targetId) {
      // Validado antes no navegador com as mesmas regras (mutations.moveReplacing).
      const t: any = check(await sb.from('assignments')
        .select('id, employee_id, activity_id, reserved_label, required_skill_id, position, work_days(date, schedules(status))')
        .eq('id', targetId).single());
      const src: any = check(await sb.from('assignments').select('id, employee_id').eq('id', sourceId).single());
      const published = t.work_days?.schedules?.status && t.work_days.schedules.status !== 'draft';
      const { data: skills } = await sb.from('employee_skills').select('skill_id').eq('employee_id', src.employee_id);
      const has = (k: string | null) => !!k && (skills ?? []).some((x: any) => x.skill_id === k);
      if (published && t.employee_id) check(await sb.from('assignments').update({ status: 'replaced' }).eq('id', targetId));
      else check(await sb.from('assignments').delete().eq('id', targetId));
      await rpc('move_assignment', { p_id: sourceId, p_date: t.work_days.date });
      const patch: Record<string, unknown> = { position: t.position, reserved_label: t.reserved_label, required_skill_id: t.required_skill_id };
      if (has(t.activity_id)) patch.activity_id = t.activity_id;
      check(await sb.from('assignments').update(patch).eq('id', sourceId));
      if (published && t.employee_id) check(await sb.from('assignments').update({ replaced_by_id: sourceId }).eq('id', targetId));
    },
    async moveAssignment(id, date) {
      await rpc('move_assignment', { p_id: id, p_date: date });
    },
    async setDayLocked(date, locked) {
      await rpc('ensure_work_day', { p_date: date });
      check(await sb.from('work_days').update({ locked }).eq('date', date));
    },
    async updateWorkDay(date, patch) {
      await rpc('ensure_work_day', { p_date: date });
      const row: Record<string, unknown> = {};
      if (patch.startTime) row.start_time = patch.startTime;
      if (patch.endTime) row.end_time = patch.endTime;
      if ('note' in patch) row.note = patch.note || null;
      check(await sb.from('work_days').update(row).eq('date', date));
    },
    async saveExtraDay(x) {
      await rpc('save_extra_day', { p_date: x.date, p_label: x.label, p_start: x.startTime, p_end: x.endTime, p_ideal: x.idealSize, p_counts: x.countsInQuota, p_requirements: x.requirements });
    },
    async removeExtraDay(date) {
      await rpc('remove_extra_day', { p_date: date });
    },
    async setQuotas(year, month, quotas, enable) {
      await rpc('set_quotas', { p_year: year, p_month: month, p_quotas: quotas, p_enable: enable });
    },
    async setScheduleStatus(year, month, status) {
      check(await sb.from('schedules').update({ status }).eq('year', year).eq('month', month));
    },

    async listAudit(limit = 200): Promise<AuditEntry[]> {
      const rows = check(await sb.from('audit_log').select('*').order('at', { ascending: false }).limit(limit));
      return (rows ?? []).map((r: any) => ({
        id: String(r.id), at: r.at, userName: r.user_name, entity: r.entity, entityId: r.entity_id, action: r.action, summary: r.summary, before: r.before, after: r.after,
      }));
    },
    async listProfiles() {
      const rows = check(await sb.from('profiles').select('*').order('name'));
      return (rows ?? []).map((p: any): Profile => ({ id: p.id, name: p.name, email: p.email, role: p.role }));
    },
    async updateRole(userId, role) {
      check(await sb.from('profiles').update({ role }).eq('id', userId));
    },
    async inviteUser(email, name, role) {
      const { data } = await sb.auth.getSession();
      const res = await fetch('/.netlify/functions/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ email, name, role }),
      }).catch(() => null);
      if (!res) throw new DomainError('Sem conexão com o servidor.');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new DomainError(body.error ?? 'Não foi possível enviar o convite.');
    },
  };
}
