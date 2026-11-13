// Tipos de domínio compartilhados entre o motor de escalas, a camada de dados e a interface.
// Datas são sempre strings ISO "yyyy-MM-dd" (sem fuso) para evitar deslocamentos de horário.

export type ISODate = string;
export type Role = 'admin' | 'supervisor' | 'viewer';
export type EmployeeStatus = 'active' | 'inactive' | 'vacation' | 'leave';
export type ScheduleStatus = 'draft' | 'published' | 'closed';
export type AssignmentStatus = 'active' | 'replaced';
export type Attendance = 'present' | 'absent' | null;

export interface Sector {
  id: string;
  name: string;
  color: string; // hex
  defaultSkillId: string | null; // atividade padrão de quem é do setor
  active: boolean;
  sortOrder: number;
}

export interface Skill {
  id: string;
  name: string;
  color: string; // hex
  active: boolean;
  sortOrder: number;
}

export interface Employee {
  id: string;
  fullName: string;
  shortName: string;
  registration: string | null;
  sectorId: string | null;
  skillIds: string[];
  admissionDate: ISODate | null;
  status: EmployeeStatus;
  restrictions: string | null; // texto livre exibido ao administrador
  maxPerMonth: number | null; // restrição individual opcional (sobrepõe a configuração geral)
  adminNotes: string | null; // nunca sai na impressão / visualizador
}

/** Indisponibilidade: período (férias, afastamento) ou um sábado específico (start = end). */
export interface Unavailability {
  id: string;
  employeeId: string;
  startDate: ISODate;
  endDate: ISODate;
  reason: string | null;
}

export interface Requirement {
  skillId: string;
  minCount: number;
  mandatory: boolean; // true = restrição obrigatória; false = preferência
}

export type BalancePriority = 'high' | 'medium' | 'low';

export interface PrintSettings {
  paper: 'A4' | 'A3';
  showActivityCounts: boolean;
  emptySlotsToIdeal: boolean; // desenhar linhas em branco até a equipe ideal
  footerText: string; // vazio = sem rodapé
}

export interface Settings {
  orgName: string;
  idealPerDay: number;
  maxPerDay: number; // capacidade de transporte (restrição obrigatória)
  startTime: string; // "06:00"
  endTime: string; // "09:00"
  maxPerMonth: number; // repetições máximas por pessoa no mês
  avoidConsecutive: boolean;
  minGapWeeks: number; // intervalo preferido entre participações (em semanas)
  balancePriority: BalancePriority;
  considerHistoryMonths: number; // quantos meses anteriores pesam no equilíbrio (0 = todo o histórico)
  print: PrintSettings;
}

export interface Schedule {
  id: string;
  year: number;
  month: number; // 1-12
  status: ScheduleStatus;
  publishedAt: string | null;
  updatedAt: string | null;
  /** Banco de cotas ativo: cada pessoa só pode ser escalada até a sua cota no mês. */
  useQuotas?: boolean;
}

export interface Quota {
  scheduleId: string;
  employeeId: string;
  quota: number;
}

export type DayKind = 'regular' | 'extra';

export interface WorkDay {
  id: string;
  scheduleId: string;
  date: ISODate;
  startTime: string;
  endTime: string;
  locked: boolean;
  note: string | null; // nota operacional (aparece na impressão se preenchida)
  /** 'extra' = feriado/jornada extraordinária (qualquer dia da semana). */
  kind?: DayKind;
  label?: string | null; // motivo da data extra, ex.: "Finados — manutenção de rega"
  countsInQuota?: boolean; // participação conta na cota mensal
  idealSize?: number | null; // equipe ideal própria da data extra
  requirements?: Requirement[] | null; // atividades obrigatórias próprias (null = padrão)
}

export interface Assignment {
  id: string;
  workDayId: string;
  employeeId: string | null; // null = vaga reservada
  activityId: string | null; // atividade efetivamente atribuída no dia
  reservedLabel: string | null; // "Novo colaborador 1"
  requiredSkillId: string | null; // habilidade exigida da vaga reservada
  status: AssignmentStatus;
  attendance: Attendance;
  replacedById: string | null;
  position: number;
  createdAt?: string;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuditEntry {
  id: string;
  at: string;
  userName: string | null;
  entity: string;
  entityId: string | null;
  action: 'insert' | 'update' | 'delete' | string;
  summary: string | null;
  before: unknown;
  after: unknown;
}

export interface Snapshot {
  sectors: Sector[];
  skills: Skill[];
  employees: Employee[];
  unavailability: Unavailability[];
  settings: Settings;
  requirements: Requirement[];
  schedules: Schedule[];
  workDays: WorkDay[];
  assignments: Assignment[];
  quotas?: Quota[];
}

export const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  vacation: 'Férias',
  leave: 'Afastado',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  viewer: 'Visualizador',
};

export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicada',
  closed: 'Encerrada',
};

export const DEFAULT_SETTINGS: Settings = {
  orgName: 'CULTIVO DONA ZEZÉ CONDE',
  idealPerDay: 4,
  maxPerDay: 4,
  startTime: '06:00',
  endTime: '09:00',
  maxPerMonth: 2,
  avoidConsecutive: true,
  minGapWeeks: 2,
  balancePriority: 'high',
  considerHistoryMonths: 0,
  print: { paper: 'A4', showActivityCounts: true, emptySlotsToIdeal: true, footerText: '' },
};
