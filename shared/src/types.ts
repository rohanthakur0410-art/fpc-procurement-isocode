export type Role = 'operator' | 'office';
export type Crop = 'soybean' | 'tur';
export type Grade = 'A' | 'B';

export interface Member {
  id: number;
  farmerId: string;
  name: string;
  nameMr: string;
  village: string;
  villageMr: string;
  landAcres: number;
  bankAccountMasked: string;
  ifsc: string;
  verified: boolean;
}

export interface Centre {
  code: string;
  name: string;
  nameMr: string;
}

export interface PriceRow {
  priceDate: string; // YYYY-MM-DD
  crop: Crop;
  grade: Grade;
  rateRupees: number; // per quintal
  setBy: string;
}

export interface PurchasePayload {
  centreCode: string;
  farmerId: string;
  crop: Crop;
  grade: Grade;
  grossTenths: number; // kg * 10
  tareTenths: number;
  moistureTenths: number; // percent * 10
  rateRupees: number;
  photoName?: string | null;
  draftId?: string;
  priceReviewedAt?: string;
}

export interface SyncEntry {
  uuid: string;
  deviceId: string;
  seq: number;
  prevHash: string;
  hash: string;
  deviceTs: string; // ISO timestamp from the device clock
  payload: PurchasePayload;
}

export type PurchaseStatus = 'approved' | 'flagged' | 'paid';

export interface Purchase extends SyncEntry {
  slipNo: string | null;
  status: PurchaseStatus;
  flags: string[];
  netTenths: number;
  amountPaisa: number;
  syncedAt: string | null;
}

export interface SyncResultItem {
  uuid: string;
  result: 'stored' | 'duplicate' | 'rejected';
  slipNo?: string;
  status?: PurchaseStatus;
  flags?: string[];
  error?: string;
}

export interface SessionUser {
  username: string;
  role: Role;
  name: string;
  centreCode: string | null;
}
