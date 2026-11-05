// Domain model. Field names follow NetBox 4.1 where an equivalent exists,
// so the export step is a mapping, not a translation.

export type Id = string;
export type VerifyStatus = 'check' | 'confirmed';
export type SurveyStatus = 'in_progress' | 'review' | 'imported';
export type Face = 'front' | 'rear';

/** Common bookkeeping on every record; used later for record-level sync. */
export interface Meta {
  id: Id;
  createdAt: string;
  updatedAt: string;
  /** NetBox object id once the record exists in NetBox (milestone 4). */
  netboxId?: number;
}

/** One visit to one client site. NetBox: Tenant + Site. */
export interface Survey extends Meta {
  tenant: string;
  site: string;
  building: string;
  status: SurveyStatus;
  author: string;
  notes: string;
}

/** NetBox: Location (nested Site › floor › room). */
export interface Floor extends Meta {
  surveyId: Id;
  level: number;
  name: string;
}

export interface Room extends Meta {
  surveyId: Id;
  floorId: Id;
  name: string;
}

/** NetBox: Rack. */
export interface Rack extends Meta {
  surveyId: Id;
  roomId: Id;
  name: string;
  uHeight: number;
  notes: string;
}

/** NetBox: Device. position 0 = not racked / 0U (vertical PDU etc.). */
export interface Device extends Meta {
  surveyId: Id;
  rackId: Id;
  name: string;
  manufacturer: string;
  model: string;
  role: string;
  uHeight: number;
  position: number;
  face: Face;
  /** Full-depth devices block the U on both faces (NetBox: is_full_depth). */
  fullDepth: boolean;
  serial: string;
  assetTag: string;
  mgmtIp: string;
  status: VerifyStatus;
  notes: string;
}

export type OwnerKind = 'survey' | 'room' | 'rack' | 'device';

export interface Photo extends Meta {
  surveyId: Id;
  ownerKind: OwnerKind;
  ownerId: Id;
  blob: Blob;
  width: number;
  height: number;
}

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

export function meta(): Meta {
  const t = now();
  return { id: newId(), createdAt: t, updatedAt: t };
}
