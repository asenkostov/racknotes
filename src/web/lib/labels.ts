import type { SurveyStatus, VerifyStatus } from '../../core/model.ts';

export const statusLabel: Record<SurveyStatus, string> = {
  in_progress: 'В ПРОЦЕС',
  review: 'ЗА ПРЕГЛЕД',
  imported: 'В NETBOX'
};

export const verifyLabel: Record<VerifyStatus, string> = {
  check: 'За проверка',
  confirmed: 'Потвърдено'
};

/** Bulgarian count + noun: plural(1, 'шкаф', 'шкафа') → "1 шкаф". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
