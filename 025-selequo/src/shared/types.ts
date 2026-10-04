// Shared domain types used by server, web and MCP.

export const ROLES = ['owner', 'admin', 'editor', 'reviewer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const SOURCE_TYPES = ['web', 'pdf', 'screenshot', 'image', 'manual', 'csv', 'text'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_QUALITIES = [
  'official',
  'manufacturer',
  'vendor',
  'marketplace',
  'editorial',
  'user_review',
  'manual',
  'unknown',
] as const;
export type SourceQuality = (typeof SOURCE_QUALITIES)[number];

export const SOURCE_STATUSES = ['pending', 'processing', 'ready', 'failed', 'deleted'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const REVIEW_STATES = ['candidate', 'confirmed', 'rejected', 'superseded'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const CANDIDATE_STATUSES = ['considering', 'shortlisted', 'rejected', 'chosen'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const PROJECT_STATUSES = ['active', 'deciding', 'decided', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type AttrType = 'number' | 'text' | 'bool' | 'price';

/** A normalized value. Unknown is represented by the *absence* of a value, never by 0. */
export type NormalizedValue =
  | { kind: 'number'; value: number; unit: string | null }
  | { kind: 'text'; value: string }
  | { kind: 'bool'; value: boolean };

export type SourceRange =
  | { type: 'text'; start: number; end: number; context: string }
  | { type: 'pdf'; page: number; start: number; end: number; context: string }
  | { type: 'image'; region: { x: number; y: number; w: number; h: number } | null; context: string }
  | { type: 'manual'; by: string; context: string }
  | { type: 'csv'; row: number; column: string; context: string };

export type FactKind = 'fact' | 'opinion';

export interface Fact {
  id: string;
  projectId: string;
  candidateId: string;
  sourceId: string;
  attributeKey: string | null;
  rawLabel: string;
  rawValue: string;
  normalizedValue: NormalizedValue | null;
  unit: string | null;
  kind: FactKind;
  sourceRange: SourceRange;
  confidence: number;
  reviewState: ReviewState;
  extractedBy: string;
  createdAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  supersededBy?: string | null;
  note?: string | null;
}

export interface Attribute {
  id: string;
  projectId: string;
  key: string;
  displayName: string;
  type: AttrType;
  unit: string | null;
  category: string;
  aliases: string[];
  groupName: string | null;
  sortOrder: number;
  origin: 'catalog' | 'suggested' | 'user';
  status: 'active' | 'suggested' | 'removed';
}

export interface Candidate {
  id: string;
  projectId: string;
  name: string;
  provider: string | null;
  url: string | null;
  status: CandidateStatus;
  notes: string | null;
  tags: string[];
  createdAt: string;
}

export interface Source {
  id: string;
  projectId: string;
  candidateId: string | null;
  type: SourceType;
  url: string | null;
  fileKey: string | null;
  fileName: string | null;
  mime: string | null;
  title: string | null;
  publisher: string | null;
  quality: SourceQuality;
  capturedAt: string | null;
  publishedAt: string | null;
  retrievedAt: string | null;
  hash: string | null;
  status: SourceStatus;
  aiEnabled: boolean;
  error: string | null;
  injectionFlags: string[];
  createdBy: string | null;
  createdByName?: string | null;
  createdAt: string;
}

export type CriterionDirection = 'higher_better' | 'lower_better' | 'target' | 'boolean' | 'none';
export type TargetOp = '>=' | '<=' | '=' | '>' | '<' | 'includes';
export interface CriterionTarget {
  op: TargetOp;
  value: number | string | boolean;
  unit?: string | null;
}

export interface Criterion {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  weight: number;
  direction: CriterionDirection;
  mustHave: boolean;
  target: CriterionTarget | null;
  linkedAttributes: string[];
  origin: 'user' | 'suggested';
  status: 'active' | 'suggested';
  sortOrder: number;
}

export interface Scenario {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  weights: Record<string, number>;
  mustHaves: Record<string, boolean>;
  params: { seats?: number | null; costBasis?: 'as_listed' | 'annual_total' | 'monthly_equivalent'; includeShipping?: boolean };
  sortOrder: number;
}

export type BillingPeriod = 'one_time' | 'monthly' | 'annual' | 'unknown';
export type TaxMode = 'included' | 'excluded' | 'unknown';

export interface PriceSnapshot {
  id: string;
  projectId: string;
  candidateId: string;
  sourceId: string | null;
  factId: string | null;
  amount: number;
  currency: string;
  tax: TaxMode;
  shipping: number | null;
  billingPeriod: BillingPeriod;
  contractMonths: number | null;
  perSeat: boolean;
  seats: number | null;
  capturedAt: string;
  fxRate: number | null;
  fxBase: string | null;
  fxSource: string | null;
  fxAt: string | null;
  note: string | null;
}

export interface Question {
  id: string;
  projectId: string;
  candidateId: string | null;
  attributeKey: string | null;
  text: string;
  status: 'open' | 'answered' | 'closed';
  answer: string | null;
  answerSourceId: string | null;
  answerFactId: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface Decision {
  id: string;
  projectId: string;
  chosenCandidateId: string | null;
  scenarioId: string | null;
  reason: string;
  assumptions: string | null;
  expectedOutcome: string | null;
  reviewDate: string | null;
  actualResult: string | null;
  lessons: string | null;
  status: 'draft' | 'decided' | 'reviewed';
  decidedBy: string | null;
  decidedByName?: string | null;
  decidedAt: string | null;
  reviewedAt: string | null;
}

export interface Project {
  id: string;
  workspaceId: string;
  title: string;
  category: string | null;
  purpose: string | null;
  deadline: string | null;
  status: ProjectStatus;
  currency: string;
  locale: string;
  aiEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const ROLE_RANK: Record<Role, number> = { owner: 50, admin: 40, editor: 30, reviewer: 20, viewer: 10 };

export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
