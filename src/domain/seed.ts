import { DEFAULT_SETTINGS, type Employee, type Snapshot } from './types';

export const SKILL = { clonagem: 'sk-clonagem', cultivo: 'sk-cultivo', pos: 'sk-pos-colheita' } as const;
export const SECTOR = { cultivo: 'se-cultivo', pos: 'se-pos-colheita', gp: 'se-gp' } as const;

const emp = (
  id: string, fullName: string, shortName: string, sectorId: string, skillIds: string[],
): Employee => ({
  id, fullName, shortName, sectorId, skillIds, registration: null, admissionDate: null,
  status: 'active', restrictions: null, maxPerMonth: null, adminNotes: null,
});

/** Dados iniciais (espelham supabase/migrations/0004_seed.sql). */
export function seedSnapshot(): Snapshot {
  return {
    skills: [
      { id: SKILL.clonagem, name: 'Clonagem', color: '#7c3aed', active: true, sortOrder: 1 },
      { id: SKILL.cultivo, name: 'Cultivo', color: '#16a34a', active: true, sortOrder: 2 },
      { id: SKILL.pos, name: 'Pós-Colheita', color: '#d97706', active: true, sortOrder: 3 },
    ],
    sectors: [
      { id: SECTOR.cultivo, name: 'Cultivo', color: '#16a34a', defaultSkillId: SKILL.cultivo, active: true, sortOrder: 1 },
      { id: SECTOR.pos, name: 'Pós-Colheita', color: '#d97706', defaultSkillId: SKILL.pos, active: true, sortOrder: 2 },
      { id: SECTOR.gp, name: 'G&P', color: '#0e7490', defaultSkillId: null, active: true, sortOrder: 3 },
    ],
    employees: [
      emp('em-ailton', 'Ailton Ferreira do Nascimento Junior', 'Ailton Ferreira', SECTOR.cultivo, [SKILL.cultivo]),
      emp('em-david', 'David Victor da Silva Andrade', 'David Victor', SECTOR.cultivo, [SKILL.cultivo]),
      emp('em-emerson', 'Emerson Lucas Ribeiro da Silva', 'Emerson Lucas', SECTOR.cultivo, [SKILL.cultivo]),
      emp('em-josenaldo', 'Josenaldo das Neves', 'Josenaldo Neves', SECTOR.cultivo, [SKILL.cultivo]),
      emp('em-edna', 'Edna Gomes Euzebio', 'Edna Gomes', SECTOR.pos, [SKILL.pos, SKILL.clonagem]),
      emp('em-tatiana', 'Tatiana Almeida da Silva', 'Tatiana Almeida', SECTOR.pos, [SKILL.pos]),
      emp('em-ediane', 'Ediane Macedo Paz de Lima', 'Ediane Macedo', SECTOR.gp, [SKILL.clonagem]),
      emp('em-jose', 'José Ivan Batista Filho', 'José Ivan', SECTOR.gp, [SKILL.clonagem]),
      emp('em-marcelo', 'Marcelo Pontes Soares', 'Marcelo Pontes', SECTOR.gp, [SKILL.clonagem]),
    ],
    unavailability: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    requirements: [{ skillId: SKILL.clonagem, minCount: 1, mandatory: true }],
    schedules: [],
    workDays: [],
    assignments: [],
  };
}
