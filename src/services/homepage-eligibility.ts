import type { HomepageEntityType } from '../db/schema/homepage.js';

export const MAX_TOPIC_ANCESTRY_DEPTH = 16;

export const HOMEPAGE_ELIGIBILITY_DIAGNOSTICS = [
  'ELIGIBLE',
  'INVALID_EVALUATION_INPUT',
  'COUNTRY_NOT_FOUND',
  'COUNTRY_INACTIVE',
  'COUNTRY_MISMATCH',
  'ENTITY_NOT_FOUND',
  // Resource diagnostics
  'RESOURCE_NOT_PUBLISHED',
  'RESOURCE_TYPE_INACTIVE',
  'SCHOOL_COUNTRY_MISMATCH',
  'SCHOOL_INACTIVE',
  'NO_PUBLISHED_VERSION',
  'MULTIPLE_PUBLISHED_VERSIONS',
  'PUBLISHED_VERSION_FUTURE_DATED',
  'NO_AVAILABLE_FILE',
  'TAXONOMY_PARENT_MISSING',
  'CURRICULUM_COUNTRY_MISMATCH',
  'CURRICULUM_INACTIVE',
  'CURRICULUM_VERSION_MISMATCH',
  'CURRICULUM_VERSION_NOT_CURRENT',
  'EDUCATION_LEVEL_MISMATCH',
  'EDUCATION_LEVEL_INACTIVE',
  'GRADE_MISMATCH',
  'GRADE_INACTIVE',
  'PATHWAY_MISMATCH',
  'PATHWAY_INACTIVE',
  'SUBJECT_TAXONOMY_MISMATCH',
  'SUBJECT_INACTIVE',
  'TOPIC_TAXONOMY_MISMATCH',
  'TOPIC_INACTIVE',
  'TOPIC_ANCESTOR_MISSING',
  'TOPIC_ANCESTOR_MISMATCH',
  'TOPIC_ANCESTOR_INACTIVE',
  'TOPIC_ANCESTRY_CYCLE',
  'TOPIC_ANCESTRY_TOO_DEEP',
  // Update diagnostics
  'UPDATE_COUNTRY_MISSING',
  'UPDATE_NOT_PUBLISHED',
  'UPDATE_PUBLISHED_AT_MISSING',
  'UPDATE_FUTURE_DATED',
  'UPDATE_CATEGORY_INACTIVE',
  'UPDATE_CURRICULUM_COUNTRY_MISMATCH',
  'UPDATE_CURRICULUM_INACTIVE',
  // Calendar event diagnostics
  'CALENDAR_NOT_OFFICIAL',
  'CALENDAR_OWNER_CONTAMINATED',
  'CALENDAR_COUNTRY_MISSING',
  'CALENDAR_INACTIVE',
  'CALENDAR_EXPIRED',
  'CALENDAR_CURRICULUM_COUNTRY_MISMATCH',
  'CALENDAR_CURRICULUM_INACTIVE',
  'CALENDAR_EDUCATION_LEVEL_MISMATCH',
  'CALENDAR_EDUCATION_LEVEL_INACTIVE',
  'CALENDAR_CURRICULUM_VERSION_NOT_CURRENT',
  'CALENDAR_EVENT_TYPE_INACTIVE',
  'CALENDAR_EVENT_NOT_PUBLIC',
  'CALENDAR_EVENT_NOT_ACTIVE',
  'CALENDAR_EVENT_SOURCE_NOT_OFFICIAL',
  'CALENDAR_EVENT_PAST',
  // Pin window diagnostics
  'PIN_WINDOW_NOT_STARTED',
  'PIN_WINDOW_EXPIRED',
] as const;

export type HomepageEligibilityDiagnostic =
  (typeof HOMEPAGE_ELIGIBILITY_DIAGNOSTICS)[number];

export interface TopicAncestryNode {
  id: string;
  parentId: string | null;
  subjectId: string | null;
  curriculumVersionId: string | null;
  status: string | null;
}

export interface ResourceProjectionSnapshot {
  targetCountryId: string | null | undefined;
  evalTime: Date | null | undefined;
  resExists: boolean;
  resCountryId?: string | null;
  resStatus?: string | null;
  countryStatus?: string | null;
  rtStatus?: string | null;
  schoolId?: string | null;
  schoolCountryId?: string | null;
  schoolStatus?: string | null;
  pubVersionCount?: number | null;
  pubPublishedAt?: Date | null;
  availFileCount?: number | null;
  curriculumId?: string | null;
  curCountryId?: string | null;
  curStatus?: string | null;
  curriculumVersionId?: string | null;
  cvCountryId?: string | null;
  cvCurriculumId?: string | null;
  cvStatus?: string | null;
  educationLevelId?: string | null;
  elCvId?: string | null;
  elStatus?: string | null;
  gradeId?: string | null;
  gCvId?: string | null;
  gElId?: string | null;
  gStatus?: string | null;
  pathwayId?: string | null;
  pCvId?: string | null;
  pElId?: string | null;
  pGradeId?: string | null;
  pStatus?: string | null;
  subjectId?: string | null;
  sCvId?: string | null;
  sElId?: string | null;
  sGradeId?: string | null;
  sPathwayId?: string | null;
  sStatus?: string | null;
  topicId?: string | null;
  tCvId?: string | null;
  tSubjectId?: string | null;
  topicAncestryDiag?: HomepageEligibilityDiagnostic | null;
}

export interface SubjectProjectionSnapshot {
  targetCountryId: string | null | undefined;
  evalTime: Date | null | undefined;
  subExists: boolean;
  countryStatus?: string | null;
  curId?: string | null;
  curCountryId?: string | null;
  curStatus?: string | null;
  sCvId?: string | null;
  cvCountryId?: string | null;
  cvCurriculumId?: string | null;
  cvStatus?: string | null;
  sElId?: string | null;
  elCvId?: string | null;
  elStatus?: string | null;
  sGradeId?: string | null;
  gCvId?: string | null;
  gElId?: string | null;
  gStatus?: string | null;
  sPathwayId?: string | null;
  pCvId?: string | null;
  pElId?: string | null;
  pGradeId?: string | null;
  pStatus?: string | null;
  sStatus?: string | null;
}

export interface UpdateEligibilitySnapshot {
  targetCountryId: string | null | undefined;
  evalTime: Date | null | undefined;
  countryExists: boolean;
  countryStatus?: string | null;
  updateExists: boolean;
  updateCountryId?: string | null;
  categoryId?: string | null;
  categoryStatus?: string | null;
  publicationStatus?: string | null;
  publishedAt?: Date | null;
  hasCrossCountryCurriculum?: boolean;
  hasInactiveCurriculum?: boolean;
}

export interface CalendarEventEligibilitySnapshot {
  targetCountryId: string | null | undefined;
  evalTime: Date | null | undefined;
  countryExists: boolean;
  countryStatus?: string | null;
  eventExists: boolean;
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD | null
  sourceType?: string | null;
  visibility?: string | null;
  eventStatus?: string | null;
  calendarScope?: string | null;
  calCountryId?: string | null;
  calCurriculumId?: string | null;
  calElId?: string | null;
  calSchoolId?: string | null;
  calUserId?: string | null;
  calSessionId?: string | null;
  calStatus?: string | null;
  calExpiresAt?: Date | null;
  eventTypeStatus?: string | null;
  calCurCountryId?: string | null;
  calCurStatus?: string | null;
  calElStatus?: string | null;
  calElCvCountryId?: string | null;
  calElCvCurriculumId?: string | null;
  calElCvStatus?: string | null;
  calElCurStatus?: string | null;
}

export type EvaluationTimestampParseResult =
  | { ok: true; date: Date }
  | { ok: false; code: 'INVALID_EVALUATION_TIMESTAMP'; message: string };

/**
 * Fail-closed evaluation timestamp parser (C61):
 * - undefined (omitted): defaults to current wall clock (or fallbackNow)
 * - explicit null, non-string/non-Date, malformed ISO string, NaN, or non-finite time:
 *   fails closed with INVALID_EVALUATION_TIMESTAMP.
 */
export function parseEvaluationTimestamp(
  input: unknown,
  fallbackNow: () => Date = () => new Date(),
): EvaluationTimestampParseResult {
  if (input === undefined) {
    const d = fallbackNow();
    if (!(d instanceof Date) || !Number.isFinite(d.getTime())) {
      return {
        ok: false,
        code: 'INVALID_EVALUATION_TIMESTAMP',
        message: 'Fallback evaluation clock produced an invalid timestamp.',
      };
    }
    return { ok: true, date: d };
  }

  if (input === null) {
    return {
      ok: false,
      code: 'INVALID_EVALUATION_TIMESTAMP',
      message: 'Evaluation timestamp cannot be null.',
    };
  }

  if (input instanceof Date) {
    if (!Number.isFinite(input.getTime())) {
      return {
        ok: false,
        code: 'INVALID_EVALUATION_TIMESTAMP',
        message: 'Evaluation Date instance is invalid or non-finite.',
      };
    }
    return { ok: true, date: new Date(input.getTime()) };
  }

  if (typeof input === 'string') {
    const ISO_8601_WITH_TZ_REGEX =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
    if (!ISO_8601_WITH_TZ_REGEX.test(input)) {
      return {
        ok: false,
        code: 'INVALID_EVALUATION_TIMESTAMP',
        message: 'Evaluation timestamp must be a valid ISO-8601 UTC/offset string.',
      };
    }
    const ms = Date.parse(input);
    if (!Number.isFinite(ms)) {
      return {
        ok: false,
        code: 'INVALID_EVALUATION_TIMESTAMP',
        message: 'Evaluation timestamp could not be parsed into a finite date.',
      };
    }
    return { ok: true, date: new Date(ms) };
  }

  return {
    ok: false,
    code: 'INVALID_EVALUATION_TIMESTAMP',
    message: 'Evaluation timestamp must be omitted or an ISO-8601 string.',
  };
}

function isValidFiniteDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime());
}

function toUtcDateIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Exact TypeScript parity mirror of content.fn_diag_homepage_topic_ancestry (C52 / C54).
 * Depth convention: leaf topic = depth 1; max valid chain = 16 nodes (root at depth <= 16).
 */
export function evaluateTopicAncestry(
  leafTopicId: string | null | undefined,
  expectedSubjectId: string | null | undefined,
  expectedCvId: string | null | undefined,
  topicsById: ReadonlyMap<string, TopicAncestryNode>,
): HomepageEligibilityDiagnostic {
  if (!leafTopicId) {
    return 'ELIGIBLE';
  }

  let currId: string = leafTopicId;
  let depth = 1;
  const visited = new Set<string>();

  while (true) {
    const node = topicsById.get(currId);
    if (!node) {
      return 'TOPIC_ANCESTOR_MISSING';
    }

    if (
      !expectedSubjectId ||
      !expectedCvId ||
      node.subjectId !== expectedSubjectId ||
      node.curriculumVersionId !== expectedCvId
    ) {
      return depth === 1 ? 'TOPIC_TAXONOMY_MISMATCH' : 'TOPIC_ANCESTOR_MISMATCH';
    }

    if (node.status !== 'ACTIVE') {
      return depth === 1 ? 'TOPIC_INACTIVE' : 'TOPIC_ANCESTOR_INACTIVE';
    }

    if (node.parentId === null) {
      return 'ELIGIBLE';
    }

    visited.add(node.id);

    if (visited.has(node.parentId)) {
      return 'TOPIC_ANCESTRY_CYCLE';
    }

    if (!topicsById.has(node.parentId)) {
      return 'TOPIC_ANCESTOR_MISSING';
    }

    if (depth >= MAX_TOPIC_ANCESTRY_DEPTH) {
      return 'TOPIC_ANCESTRY_TOO_DEEP';
    }

    currId = node.parentId;
    depth += 1;
  }
}

/**
 * Exact TypeScript parity mirror of content.fn_diag_homepage_resource_projection (C52 / C60 / C65).
 */
export function evaluateResourceProjection(
  s: ResourceProjectionSnapshot,
): HomepageEligibilityDiagnostic {
  if (!s.targetCountryId || !isValidFiniteDate(s.evalTime)) {
    return 'INVALID_EVALUATION_INPUT';
  }
  if (s.resExists !== true) {
    return 'ENTITY_NOT_FOUND';
  }
  if (s.resCountryId !== s.targetCountryId) {
    return 'COUNTRY_MISMATCH';
  }
  if (s.countryStatus !== 'ACTIVE') {
    return 'COUNTRY_INACTIVE';
  }
  if (s.resStatus !== 'PUBLISHED') {
    return 'RESOURCE_NOT_PUBLISHED';
  }
  if (s.rtStatus !== 'ACTIVE') {
    return 'RESOURCE_TYPE_INACTIVE';
  }
  if (s.schoolId != null) {
    if (s.schoolCountryId !== s.targetCountryId) {
      return 'SCHOOL_COUNTRY_MISMATCH';
    }
    if (s.schoolStatus !== 'ACTIVE') {
      return 'SCHOOL_INACTIVE';
    }
  }

  const pubCount = s.pubVersionCount ?? 0;
  if (pubCount === 0) {
    return 'NO_PUBLISHED_VERSION';
  }
  if (pubCount > 1) {
    return 'MULTIPLE_PUBLISHED_VERSIONS';
  }
  if (
    !isValidFiniteDate(s.pubPublishedAt) ||
    !(s.pubPublishedAt.getTime() <= s.evalTime.getTime())
  ) {
    return 'PUBLISHED_VERSION_FUTURE_DATED';
  }
  if ((s.availFileCount ?? 0) < 1) {
    return 'NO_AVAILABLE_FILE';
  }

  if (
    (s.topicId != null && s.subjectId == null) ||
    (s.subjectId != null && s.gradeId == null) ||
    (s.pathwayId != null && s.gradeId == null) ||
    (s.gradeId != null && s.educationLevelId == null) ||
    (s.educationLevelId != null && s.curriculumVersionId == null) ||
    (s.curriculumVersionId != null && s.curriculumId == null)
  ) {
    return 'TAXONOMY_PARENT_MISSING';
  }

  if (s.curriculumId != null) {
    if (s.curCountryId !== s.targetCountryId) {
      return 'CURRICULUM_COUNTRY_MISMATCH';
    }
    if (s.curStatus !== 'ACTIVE') {
      return 'CURRICULUM_INACTIVE';
    }
  }

  if (s.curriculumVersionId != null) {
    if (
      s.cvCountryId !== s.targetCountryId ||
      s.cvCurriculumId !== s.curriculumId
    ) {
      return 'CURRICULUM_VERSION_MISMATCH';
    }
    if (s.cvStatus !== 'CURRENT') {
      return 'CURRICULUM_VERSION_NOT_CURRENT';
    }
  }

  if (s.educationLevelId != null) {
    if (s.elCvId !== s.curriculumVersionId) {
      return 'EDUCATION_LEVEL_MISMATCH';
    }
    if (s.elStatus !== 'ACTIVE') {
      return 'EDUCATION_LEVEL_INACTIVE';
    }
  }

  if (s.gradeId != null) {
    if (
      s.gCvId !== s.curriculumVersionId ||
      s.gElId !== s.educationLevelId
    ) {
      return 'GRADE_MISMATCH';
    }
    if (s.gStatus !== 'ACTIVE') {
      return 'GRADE_INACTIVE';
    }
  }

  if (s.pathwayId != null) {
    if (
      s.pCvId !== s.curriculumVersionId ||
      s.pElId !== s.educationLevelId ||
      s.pGradeId !== s.gradeId
    ) {
      return 'PATHWAY_MISMATCH';
    }
    if (s.pStatus !== 'ACTIVE') {
      return 'PATHWAY_INACTIVE';
    }
  }

  if (s.subjectId != null) {
    const normResPathway = s.pathwayId ?? null;
    const normSubPathway = s.sPathwayId ?? null;
    if (
      s.sCvId !== s.curriculumVersionId ||
      s.sElId !== s.educationLevelId ||
      s.sGradeId !== s.gradeId ||
      normSubPathway !== normResPathway
    ) {
      return 'SUBJECT_TAXONOMY_MISMATCH';
    }
    if (s.sStatus !== 'ACTIVE') {
      return 'SUBJECT_INACTIVE';
    }
  }

  if (s.topicId != null) {
    if (
      s.tCvId !== s.curriculumVersionId ||
      s.tSubjectId !== s.subjectId
    ) {
      return 'TOPIC_TAXONOMY_MISMATCH';
    }
    const diag = s.topicAncestryDiag ?? 'TOPIC_ANCESTOR_MISSING';
    if (diag !== 'ELIGIBLE') {
      return diag;
    }
  }

  return 'ELIGIBLE';
}

/**
 * Exact TypeScript parity mirror of content.fn_diag_homepage_subject_projection (C60 / C65).
 */
export function evaluateSubjectProjection(
  s: SubjectProjectionSnapshot,
): HomepageEligibilityDiagnostic {
  if (!s.targetCountryId || !isValidFiniteDate(s.evalTime)) {
    return 'INVALID_EVALUATION_INPUT';
  }
  if (s.subExists !== true) {
    return 'ENTITY_NOT_FOUND';
  }
  if (s.cvCountryId !== s.targetCountryId) {
    return 'COUNTRY_MISMATCH';
  }
  if (s.countryStatus !== 'ACTIVE') {
    return 'COUNTRY_INACTIVE';
  }
  if (s.curCountryId !== s.targetCountryId) {
    return 'CURRICULUM_COUNTRY_MISMATCH';
  }
  if (s.curStatus !== 'ACTIVE') {
    return 'CURRICULUM_INACTIVE';
  }
  if (!s.curId || s.cvCurriculumId !== s.curId) {
    return 'CURRICULUM_VERSION_MISMATCH';
  }
  if (s.cvStatus !== 'CURRENT') {
    return 'CURRICULUM_VERSION_NOT_CURRENT';
  }
  if (!s.sCvId || s.elCvId !== s.sCvId) {
    return 'EDUCATION_LEVEL_MISMATCH';
  }
  if (s.elStatus !== 'ACTIVE') {
    return 'EDUCATION_LEVEL_INACTIVE';
  }
  if (
    !s.sElId ||
    s.gCvId !== s.sCvId ||
    s.gElId !== s.sElId
  ) {
    return 'GRADE_MISMATCH';
  }
  if (s.gStatus !== 'ACTIVE') {
    return 'GRADE_INACTIVE';
  }
  if (s.sPathwayId != null) {
    if (
      s.pCvId !== s.sCvId ||
      s.pElId !== s.sElId ||
      s.pGradeId !== s.sGradeId
    ) {
      return 'PATHWAY_MISMATCH';
    }
    if (s.pStatus !== 'ACTIVE') {
      return 'PATHWAY_INACTIVE';
    }
  }
  if (s.sStatus !== 'ACTIVE') {
    return 'SUBJECT_INACTIVE';
  }
  return 'ELIGIBLE';
}

export function evaluateUpdateSnapshot(
  s: UpdateEligibilitySnapshot,
): HomepageEligibilityDiagnostic {
  if (!s.targetCountryId || !isValidFiniteDate(s.evalTime)) {
    return 'INVALID_EVALUATION_INPUT';
  }
  if (s.countryExists !== true) {
    return 'COUNTRY_NOT_FOUND';
  }
  if (s.updateExists !== true) {
    return 'ENTITY_NOT_FOUND';
  }
  if (s.updateCountryId == null) {
    return 'UPDATE_COUNTRY_MISSING';
  }
  if (s.updateCountryId !== s.targetCountryId) {
    return 'COUNTRY_MISMATCH';
  }
  if (s.countryStatus !== 'ACTIVE') {
    return 'COUNTRY_INACTIVE';
  }
  if (s.publicationStatus !== 'PUBLISHED') {
    return 'UPDATE_NOT_PUBLISHED';
  }
  if (!isValidFiniteDate(s.publishedAt)) {
    return 'UPDATE_PUBLISHED_AT_MISSING';
  }
  if (!(s.publishedAt.getTime() <= s.evalTime.getTime())) {
    return 'UPDATE_FUTURE_DATED';
  }
  if (s.categoryId != null && s.categoryStatus !== 'ACTIVE') {
    return 'UPDATE_CATEGORY_INACTIVE';
  }
  if (s.hasCrossCountryCurriculum === true) {
    return 'UPDATE_CURRICULUM_COUNTRY_MISMATCH';
  }
  if (s.hasInactiveCurriculum === true) {
    return 'UPDATE_CURRICULUM_INACTIVE';
  }
  return 'ELIGIBLE';
}

export function evaluateCalendarEventSnapshot(
  s: CalendarEventEligibilitySnapshot,
): HomepageEligibilityDiagnostic {
  if (!s.targetCountryId || !isValidFiniteDate(s.evalTime)) {
    return 'INVALID_EVALUATION_INPUT';
  }
  if (s.countryExists !== true) {
    return 'COUNTRY_NOT_FOUND';
  }
  if (s.eventExists !== true) {
    return 'ENTITY_NOT_FOUND';
  }
  if (s.calendarScope !== 'OFFICIAL') {
    return 'CALENDAR_NOT_OFFICIAL';
  }
  if (
    s.calSchoolId != null ||
    s.calUserId != null ||
    s.calSessionId != null
  ) {
    return 'CALENDAR_OWNER_CONTAMINATED';
  }
  if (s.calCountryId == null) {
    return 'CALENDAR_COUNTRY_MISSING';
  }
  if (s.calCountryId !== s.targetCountryId) {
    return 'COUNTRY_MISMATCH';
  }
  if (s.countryStatus !== 'ACTIVE') {
    return 'COUNTRY_INACTIVE';
  }
  if (s.calStatus !== 'ACTIVE') {
    return 'CALENDAR_INACTIVE';
  }
  if (
    s.calExpiresAt != null &&
    (!isValidFiniteDate(s.calExpiresAt) ||
      !(s.calExpiresAt.getTime() > s.evalTime.getTime()))
  ) {
    return 'CALENDAR_EXPIRED';
  }
  if (s.calCurriculumId != null) {
    if (s.calCurCountryId !== s.targetCountryId) {
      return 'CALENDAR_CURRICULUM_COUNTRY_MISMATCH';
    }
    if (s.calCurStatus !== 'ACTIVE') {
      return 'CALENDAR_CURRICULUM_INACTIVE';
    }
  }
  if (s.calElId != null) {
    if (
      s.calElCvCountryId !== s.targetCountryId ||
      (s.calCurriculumId != null &&
        s.calElCvCurriculumId !== s.calCurriculumId)
    ) {
      return 'CALENDAR_EDUCATION_LEVEL_MISMATCH';
    }
    if (s.calElStatus !== 'ACTIVE') {
      return 'CALENDAR_EDUCATION_LEVEL_INACTIVE';
    }
    if (s.calElCvStatus !== 'CURRENT') {
      return 'CALENDAR_CURRICULUM_VERSION_NOT_CURRENT';
    }
    if (s.calElCurStatus !== 'ACTIVE') {
      return 'CALENDAR_CURRICULUM_INACTIVE';
    }
  }
  if (s.eventTypeStatus !== 'ACTIVE') {
    return 'CALENDAR_EVENT_TYPE_INACTIVE';
  }
  if (s.visibility !== 'PUBLIC') {
    return 'CALENDAR_EVENT_NOT_PUBLIC';
  }
  if (s.eventStatus !== 'ACTIVE') {
    return 'CALENDAR_EVENT_NOT_ACTIVE';
  }
  if (s.sourceType !== 'OFFICIAL') {
    return 'CALENDAR_EVENT_SOURCE_NOT_OFFICIAL';
  }
  const effectiveEndDate = s.endDate ?? s.startDate;
  const evalDateIso = toUtcDateIso(s.evalTime);
  if (!effectiveEndDate || !(effectiveEndDate >= evalDateIso)) {
    return 'CALENDAR_EVENT_PAST';
  }

  return 'ELIGIBLE';
}

export function evaluatePinWindow(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
  evalTime: Date,
): HomepageEligibilityDiagnostic {
  if (!isValidFiniteDate(evalTime)) {
    return 'INVALID_EVALUATION_INPUT';
  }
  if (startsAt != null) {
    if (!isValidFiniteDate(startsAt) || !(startsAt.getTime() <= evalTime.getTime())) {
      return 'PIN_WINDOW_NOT_STARTED';
    }
  }
  if (endsAt != null) {
    if (!isValidFiniteDate(endsAt) || !(endsAt.getTime() > evalTime.getTime())) {
      return 'PIN_WINDOW_EXPIRED';
    }
  }
  return 'ELIGIBLE';
}

export function extractPinnedItemEntityId(item: {
  entityType: HomepageEntityType;
  resourceId?: string | null;
  updateId?: string | null;
  calendarEventId?: string | null;
  subjectId?: string | null;
}): string | null {
  switch (item.entityType) {
    case 'RESOURCE':
      return item.resourceId ?? null;
    case 'UPDATE':
      return item.updateId ?? null;
    case 'CALENDAR_EVENT':
      return item.calendarEventId ?? null;
    case 'SUBJECT':
      return item.subjectId ?? null;
    default:
      return null;
  }
}
