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
  /** Server version this copy corresponds to; absent until first synced. Local only. */
  version?: number;
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

export type Wall = 'top' | 'right' | 'bottom' | 'left';
export type Facing = 'up' | 'right' | 'down' | 'left';
/** Rack door on one face. left/right = hinge side as seen standing in front of that face. */
export type RackDoor = 'none' | 'left' | 'right' | 'double';

export interface Door {
  wall: Wall;
  /** Metres from the wall's start (left end for top/bottom, top end for left/right). */
  offset: number;
  width: number;
}

export interface Room extends Meta {
  surveyId: Id;
  floorId: Id;
  name: string;
  /** Plan of the room: inner size in metres (x = left→right, y = top→bottom) and doors. */
  widthM?: number;
  depthM?: number;
  doors?: Door[];
  /** Other things in the room: panels, UPS, AC, columns, safety devices, notes. */
  items?: RoomItem[];
}

export type ItemKind = 'panel' | 'ups' | 'ac' | 'column' | 'fire' | 'detector' | 'camera' | 'reader' | 'note';
/** Something in the room that is not a rack. Box items have a size; the rest are points. */
export interface RoomItem {
  id: Id;
  kind: ItemKind;
  /** Variant, e.g. AC 'wall' | 'floor' | 'inrow'. */
  sub?: string;
  name?: string;
  notes?: string;
  /** Box items: top-left corner, like racks. Point items: the point itself. Metres. */
  x: number;
  y: number;
  widthMm?: number;
  depthMm?: number;
  facing?: Facing;
}

/** NetBox: Rack. */
export interface Rack extends Meta {
  surveyId: Id;
  roomId: Id;
  name: string;
  uHeight: number;
  notes: string;
  /** Outer size in millimetres (default 600 × 1000). */
  widthMm?: number;
  depthMm?: number;
  /** Position on the room plan: top-left corner in metres, and the direction the front faces. */
  plan?: { x: number; y: number; facing: Facing };
  /** Unset = not recorded yet. */
  doors?: { front?: RackDoor; rear?: RackDoor };
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
  /** Set for devices installed in a bay of another device (blades in a chassis). NetBox: parent_device. */
  parentId?: Id;
  /** Role colour from NetBox (hex without #), used in the rack view. */
  roleColor?: string;
}

/** NetBox: Cable. Each end is a port on a device in this survey, or something outside it (another rack, a power feed). */
export type PortKind = 'interface' | 'frontport' | 'rearport' | 'powerport' | 'poweroutlet' | 'powerfeed' | 'consoleport' | 'consoleserverport' | 'circuittermination' | 'other';

export interface CableEnd {
  /** Device in this survey, if the end is on one. */
  deviceId?: Id;
  /** Name of the device or object when it is outside this survey (e.g. a switch in another rack, a power feed). */
  external?: string;
  port: string;
  kind: PortKind;
}

export interface Cable extends Meta {
  surveyId: Id;
  label: string;
  type: 'data' | 'power';
  a: CableEnd;
  b: CableEnd;
  status: VerifyStatus;
  notes: string;
}

export type OwnerKind = 'survey' | 'room' | 'rack' | 'device' | 'item';

export interface Photo extends Meta {
  surveyId: Id;
  ownerKind: OwnerKind;
  ownerId: Id;
  /** SHA-256 of the JPEG; the photo's identity on the server. */
  hash: string;
  mime: string;
  width: number;
  height: number;
  /** The image itself. Absent on devices that have not downloaded it yet. Local only. */
  blob?: Blob;
  /** Local only: the blob is on the server. */
  uploaded?: boolean;
}

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

export function meta(): Meta {
  const t = now();
  return { id: newId(), createdAt: t, updatedAt: t };
}
