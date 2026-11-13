import type { CommitPayload, ExtraDayInput, MemberInput } from '@/domain/mutations';
import type {
  Assignment, AuditEntry, Employee, ISODate, Profile, Requirement, Role, ScheduleStatus, Sector, Settings, Skill,
  Snapshot, Unavailability, WorkDay,
} from '@/domain/types';

export type AssignmentPatch = Partial<Pick<Assignment, 'employeeId' | 'activityId' | 'reservedLabel' | 'requiredSkillId' | 'attendance'>>;

/** Contrato único da camada de dados: implementado pelo Supabase (produção) e pelo modo demonstração. */
export interface Repository {
  readonly mode: 'supabase' | 'demo';
  currentProfile(): Promise<Profile | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  onAuthChange(cb: () => void): () => void;

  load(): Promise<Snapshot>;

  saveEmployee(e: Employee): Promise<void>;
  saveSector(s: Sector): Promise<void>;
  saveSkill(s: Skill): Promise<void>;
  addUnavailability(u: Omit<Unavailability, 'id'>): Promise<void>;
  removeUnavailability(id: string): Promise<void>;
  saveSettings(s: Settings, req: Requirement[]): Promise<void>;

  commitMonth(p: CommitPayload): Promise<void>;
  addAssignment(date: ISODate, m: MemberInput): Promise<void>;
  updateAssignment(id: string, patch: AssignmentPatch): Promise<void>;
  removeAssignment(id: string): Promise<void>;
  replaceAssignment(id: string, employeeId: string, activityId: string | null): Promise<void>;
  swapAssignments(a: string, b: string): Promise<void>;
  moveAssignment(id: string, date: ISODate): Promise<void>;
  setDayLocked(date: ISODate, locked: boolean): Promise<void>;
  updateWorkDay(date: ISODate, patch: Partial<Pick<WorkDay, 'startTime' | 'endTime' | 'note'>>): Promise<void>;
  setScheduleStatus(year: number, month: number, status: ScheduleStatus): Promise<void>;
  saveExtraDay(x: ExtraDayInput): Promise<void>;
  removeExtraDay(date: ISODate): Promise<void>;
  setQuotas(year: number, month: number, quotas: Record<string, number>, enable: boolean): Promise<void>;

  listAudit(limit?: number): Promise<AuditEntry[]>;
  listProfiles(): Promise<Profile[]>;
  updateRole(userId: string, role: Role): Promise<void>;
  inviteUser(email: string, name: string, role: Role): Promise<void>;
}
