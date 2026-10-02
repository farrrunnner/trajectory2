import { defaultAdvancedAnalyticsTimeRange } from '@/lib/analytics/timeRange';
import { validateAdvancedAnalyticsDefinitions } from '@/lib/analytics/validation';
import type {
  AdvancedAnalyticsActivityCondition,
  AdvancedAnalyticsActivityConditionField,
  AdvancedAnalyticsActivityConditionGroup,
  AdvancedAnalyticsActivityConditionOperator,
  AdvancedAnalyticsBaseMeasure,
  AdvancedAnalyticsChartDefinition,
  AdvancedAnalyticsChartType,
  AdvancedAnalyticsConditionJoin,
  AdvancedAnalyticsFormulaOperator,
  AdvancedAnalyticsGranularity,
  AdvancedAnalyticsMetricDefinition,
  AdvancedAnalyticsPeriod,
  AdvancedAnalyticsSampleCondition,
  AdvancedAnalyticsSampleConditionField,
  AdvancedAnalyticsSampleConditionGroup,
  AdvancedAnalyticsSampleConditionOperator,
  AdvancedAnalyticsStreakDefinition,
  AdvancedAnalyticsThresholdOperator,
  AdvancedAnalyticsTimeRangeConfig,
  AdvancedAnalyticsTimeRangePreset
} from '@/types';

const ADVANCED_ANALYTICS_TRANSFER_FORMAT = 'trajectory-advanced-analytics';
export const ADVANCED_ANALYTICS_TRANSFER_SCHEMA_VERSION = 1;

const BASE_MEASURES: AdvancedAnalyticsBaseMeasure[] = [
  'activitiesCount',
  'activeDaysCount',
  'distanceSum',
  'durationSum',
  'movingTimeSum',
  'elevationGainSum',
  'sampleTime'
];
const FORMULA_OPERATORS: AdvancedAnalyticsFormulaOperator[] = [
  'add',
  'subtract',
  'divide',
  'percent'
];
const PERIODS: AdvancedAnalyticsPeriod[] = ['day', 'week'];
const THRESHOLD_OPERATORS: AdvancedAnalyticsThresholdOperator[] = [
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'equals'
];
const CHART_TYPES: AdvancedAnalyticsChartType[] = ['bar', 'line', 'stackedBar'];
const GRANULARITIES: AdvancedAnalyticsGranularity[] = ['day', 'week', 'month'];
const TIME_RANGE_PRESETS: AdvancedAnalyticsTimeRangePreset[] = [
  'all',
  '7d',
  '30d',
  '90d',
  '365d',
  'thisWeek',
  'thisMonth',
  'ytd',
  'custom'
];
const CONDITION_JOINS: AdvancedAnalyticsConditionJoin[] = ['and', 'or'];
const ACTIVITY_FIELDS: AdvancedAnalyticsActivityConditionField[] = [
  'title',
  'category',
  'sportType',
  'distanceM',
  'durationSeconds',
  'movingDurationSeconds',
  'elevationGainM',
  'avgHr',
  'maxHr',
  'hasGps',
  'weekday'
];
const ACTIVITY_OPERATORS: AdvancedAnalyticsActivityConditionOperator[] = [
  'contains',
  'containsAny',
  'containsAll',
  'equals',
  'startsWith',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'numberEquals',
  'notEquals',
  'is',
  'isNot'
];
const SAMPLE_FIELDS: AdvancedAnalyticsSampleConditionField[] = [
  'heartRate',
  'heartRateZone',
  'powerWatts',
  'cadence',
  'speedMps',
  'paceMinPerKm'
];
const SAMPLE_OPERATORS: AdvancedAnalyticsSampleConditionOperator[] = [
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'numberEquals',
  'notEquals',
  'is'
];

export interface AdvancedAnalyticsTransferData {
  metrics: AdvancedAnalyticsMetricDefinition[];
  streaks: AdvancedAnalyticsStreakDefinition[];
  charts: AdvancedAnalyticsChartDefinition[];
}

interface AdvancedAnalyticsTransferFile {
  format: typeof ADVANCED_ANALYTICS_TRANSFER_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  summary: {
    metrics: number;
    streaks: number;
    charts: number;
  };
  data: AdvancedAnalyticsTransferData;
}

interface ParseSuccess {
  ok: true;
  data: AdvancedAnalyticsTransferData;
}

interface ParseError {
  ok: false;
  error: string;
}

export type AdvancedAnalyticsTransferParseResult = ParseSuccess | ParseError;

export interface AdvancedAnalyticsTransferSelectionResult {
  selectedMetricIds: string[];
  selectedStreakIds: string[];
  selectedChartIds: string[];
  dependencyMetricIds: string[];
  requiredMetricReasonsById: Record<string, string[]>;
  data: AdvancedAnalyticsTransferData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function inSet<T extends string>(value: unknown, candidates: readonly T[]): value is T {
  return typeof value === 'string' && candidates.includes(value as T);
}

function parseTimeRangeConfig(value: unknown): AdvancedAnalyticsTimeRangeConfig | undefined {
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const next: AdvancedAnalyticsTimeRangeConfig = {};
  if (inSet(value.preset, TIME_RANGE_PRESETS)) {
    next.preset = value.preset;
  }
  if (typeof value.customStartDate === 'string') {
    next.customStartDate = value.customStartDate;
  }
  if (typeof value.customEndDate === 'string') {
    next.customEndDate = value.customEndDate;
  }
  return next;
}

function parseActivityCondition(value: unknown): AdvancedAnalyticsActivityCondition | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    !inSet(value.field, ACTIVITY_FIELDS) ||
    !inSet(value.operator, ACTIVITY_OPERATORS)
  ) {
    return null;
  }

  const next: AdvancedAnalyticsActivityCondition = {
    id: value.id,
    field: value.field,
    operator: value.operator
  };
  if (typeof value.value === 'string') {
    next.value = value.value;
  }
  if (isStringArray(value.values)) {
    next.values = value.values;
  }
  if (isFiniteNumber(value.numberValue)) {
    next.numberValue = value.numberValue;
  }
  if (typeof value.boolValue === 'boolean') {
    next.boolValue = value.boolValue;
  }
  return next;
}

function parseSampleCondition(value: unknown): AdvancedAnalyticsSampleCondition | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    !inSet(value.field, SAMPLE_FIELDS) ||
    !inSet(value.operator, SAMPLE_OPERATORS)
  ) {
    return null;
  }

  const next: AdvancedAnalyticsSampleCondition = {
    id: value.id,
    field: value.field,
    operator: value.operator
  };
  if (isFiniteNumber(value.numberValue)) {
    next.numberValue = value.numberValue;
  }
  if (isFiniteNumber(value.zone)) {
    next.zone = value.zone;
  }
  return next;
}

function parseActivityConditionGroups(value: unknown): AdvancedAnalyticsActivityConditionGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !Array.isArray(entry.conditions)) {
        return null;
      }
      const conditions = entry.conditions
        .map((condition) => parseActivityCondition(condition))
        .filter((condition): condition is AdvancedAnalyticsActivityCondition => condition != null);
      return {
        id: entry.id,
        conditions
      };
    })
    .filter((entry): entry is AdvancedAnalyticsActivityConditionGroup => entry != null);
}

function parseSampleConditionGroups(value: unknown): AdvancedAnalyticsSampleConditionGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !Array.isArray(entry.conditions)) {
        return null;
      }
      const conditions = entry.conditions
        .map((condition) => parseSampleCondition(condition))
        .filter((condition): condition is AdvancedAnalyticsSampleCondition => condition != null);
      return {
        id: entry.id,
        conditions
      };
    })
    .filter((entry): entry is AdvancedAnalyticsSampleConditionGroup => entry != null);
}

function parseMetricDefinition(value: unknown): AdvancedAnalyticsMetricDefinition | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    (value.kind !== 'base' && value.kind !== 'formula')
  ) {
    return null;
  }

  const next: AdvancedAnalyticsMetricDefinition = {
    id: value.id,
    name: value.name,
    kind: value.kind,
    showInView: typeof value.showInView === 'boolean' ? value.showInView : true,
    timeRange: parseTimeRangeConfig(value.timeRange) ?? defaultAdvancedAnalyticsTimeRange()
  };

  if (value.kind === 'base') {
    if (!isRecord(value.base) || !inSet(value.base.measure, BASE_MEASURES)) {
      return null;
    }

    const activityConditions = Array.isArray(value.base.activityConditions)
      ? value.base.activityConditions
          .map((condition) => parseActivityCondition(condition))
          .filter((condition): condition is AdvancedAnalyticsActivityCondition => condition != null)
      : [];
    const sampleConditions = Array.isArray(value.base.sampleConditions)
      ? value.base.sampleConditions
          .map((condition) => parseSampleCondition(condition))
          .filter((condition): condition is AdvancedAnalyticsSampleCondition => condition != null)
      : [];

    next.base = {
      measure: value.base.measure,
      activityConditions,
      sampleConditions,
      activityConditionGroups: parseActivityConditionGroups(value.base.activityConditionGroups),
      sampleConditionGroups: parseSampleConditionGroups(value.base.sampleConditionGroups),
      activityConditionJoin: inSet(value.base.activityConditionJoin, CONDITION_JOINS)
        ? value.base.activityConditionJoin
        : 'and',
      sampleConditionJoin: inSet(value.base.sampleConditionJoin, CONDITION_JOINS)
        ? value.base.sampleConditionJoin
        : 'and',
      minimumSampleMatchSeconds: isFiniteNumber(value.base.minimumSampleMatchSeconds)
        ? value.base.minimumSampleMatchSeconds
        : 0,
      defaultChartGranularity: inSet(value.base.defaultChartGranularity, GRANULARITIES)
        ? value.base.defaultChartGranularity
        : 'week',
      displayUnit: typeof value.base.displayUnit === 'string' ? value.base.displayUnit : 'auto'
    };
    return next;
  }

  if (
    !isRecord(value.formula) ||
    typeof value.formula.leftMetricId !== 'string' ||
    !inSet(value.formula.operator, FORMULA_OPERATORS) ||
    typeof value.formula.rightMetricId !== 'string'
  ) {
    return null;
  }

  next.formula = {
    leftMetricId: value.formula.leftMetricId,
    operator: value.formula.operator,
    rightMetricId: value.formula.rightMetricId,
    displayUnit: typeof value.formula.displayUnit === 'string' ? value.formula.displayUnit : 'auto'
  };
  return next;
}

function parseStreakDefinition(value: unknown): AdvancedAnalyticsStreakDefinition | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.metricId !== 'string' ||
    !inSet(value.period, PERIODS) ||
    !inSet(value.thresholdOperator, THRESHOLD_OPERATORS) ||
    !isFiniteNumber(value.thresholdValue)
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    timeRange: parseTimeRangeConfig(value.timeRange) ?? defaultAdvancedAnalyticsTimeRange(),
    metricId: value.metricId,
    additionalMetricIds: isStringArray(value.additionalMetricIds) ? value.additionalMetricIds : [],
    period: value.period,
    thresholdOperator: value.thresholdOperator,
    thresholdValue: value.thresholdValue
  };
}

function parseChartDefinition(value: unknown): AdvancedAnalyticsChartDefinition | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !inSet(value.chartType, CHART_TYPES) ||
    !isStringArray(value.metricIds) ||
    !inSet(value.granularity, GRANULARITIES)
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    timeRange: parseTimeRangeConfig(value.timeRange) ?? defaultAdvancedAnalyticsTimeRange(),
    chartType: value.chartType,
    metricIds: value.metricIds,
    granularity: value.granularity
  };
}

function parseObjectWithDefinitions(
  value: unknown
): { metrics: unknown[]; streaks: unknown[]; charts: unknown[] } | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!Array.isArray(value.metrics) || !Array.isArray(value.streaks) || !Array.isArray(value.charts)) {
    return null;
  }

  return {
    metrics: value.metrics,
    streaks: value.streaks,
    charts: value.charts
  };
}

export function buildAdvancedAnalyticsTransferFile(
  data: AdvancedAnalyticsTransferData
): AdvancedAnalyticsTransferFile {
  return {
    format: ADVANCED_ANALYTICS_TRANSFER_FORMAT,
    schemaVersion: ADVANCED_ANALYTICS_TRANSFER_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    summary: {
      metrics: data.metrics.length,
      streaks: data.streaks.length,
      charts: data.charts.length
    },
    data
  };
}

function ensureStringSet(value: readonly string[]): Set<string> {
  return new Set(value.filter((entry) => typeof entry === 'string' && entry.length > 0));
}

function addMetricReason(
  reasonsByMetricId: Map<string, Set<string>>,
  metricId: string,
  reason: string
) {
  const existing = reasonsByMetricId.get(metricId) ?? new Set<string>();
  existing.add(reason);
  reasonsByMetricId.set(metricId, existing);
}

function includeMetric(
  metricById: Map<string, AdvancedAnalyticsMetricDefinition>,
  selectedMetricIds: Set<string>,
  pendingMetricIds: string[],
  metricId: string
) {
  if (!metricById.has(metricId) || selectedMetricIds.has(metricId)) {
    return;
  }
  selectedMetricIds.add(metricId);
  pendingMetricIds.push(metricId);
}

export function resolveAdvancedAnalyticsTransferSelection(args: {
  metrics: AdvancedAnalyticsMetricDefinition[];
  streaks: AdvancedAnalyticsStreakDefinition[];
  charts: AdvancedAnalyticsChartDefinition[];
  selectedMetricIds: readonly string[];
  selectedStreakIds: readonly string[];
  selectedChartIds: readonly string[];
}): AdvancedAnalyticsTransferSelectionResult {
  const { metrics, streaks, charts } = args;
  const metricById = new Map(metrics.map((metric) => [metric.id, metric] as const));
  const streakById = new Map(streaks.map((streak) => [streak.id, streak] as const));
  const chartById = new Map(charts.map((chart) => [chart.id, chart] as const));

  const selectedMetricSet = ensureStringSet(args.selectedMetricIds);
  const selectedStreakSet = ensureStringSet(args.selectedStreakIds);
  const selectedChartSet = ensureStringSet(args.selectedChartIds);
  const pendingMetricIds = [...selectedMetricSet].filter((metricId) => metricById.has(metricId));
  const reasonsByMetricId = new Map<string, Set<string>>();

  for (const streakId of selectedStreakSet) {
    const streak = streakById.get(streakId);
    if (!streak) {
      continue;
    }
    const sourceLabel = `Streak "${streak.name || streak.id}"`;
    includeMetric(metricById, selectedMetricSet, pendingMetricIds, streak.metricId);
    addMetricReason(reasonsByMetricId, streak.metricId, sourceLabel);
    for (const metricId of streak.additionalMetricIds ?? []) {
      includeMetric(metricById, selectedMetricSet, pendingMetricIds, metricId);
      addMetricReason(reasonsByMetricId, metricId, sourceLabel);
    }
  }

  for (const chartId of selectedChartSet) {
    const chart = chartById.get(chartId);
    if (!chart) {
      continue;
    }
    const sourceLabel = `Chart "${chart.name || chart.id}"`;
    for (const metricId of chart.metricIds) {
      includeMetric(metricById, selectedMetricSet, pendingMetricIds, metricId);
      addMetricReason(reasonsByMetricId, metricId, sourceLabel);
    }
  }

  for (let index = 0; index < pendingMetricIds.length; index += 1) {
    const metricId = pendingMetricIds[index];
    const metric = metricById.get(metricId);
    if (!metric || metric.kind !== 'formula' || !metric.formula) {
      continue;
    }
    const sourceLabel = `Formula "${metric.name || metric.id}"`;
    includeMetric(metricById, selectedMetricSet, pendingMetricIds, metric.formula.leftMetricId);
    addMetricReason(reasonsByMetricId, metric.formula.leftMetricId, sourceLabel);
    includeMetric(metricById, selectedMetricSet, pendingMetricIds, metric.formula.rightMetricId);
    addMetricReason(reasonsByMetricId, metric.formula.rightMetricId, sourceLabel);
  }

  const selectedMetricIds = metrics
    .filter((metric) => selectedMetricSet.has(metric.id))
    .map((metric) => metric.id);
  const selectedStreakIds = streaks
    .filter((streak) => selectedStreakSet.has(streak.id))
    .map((streak) => streak.id);
  const selectedChartIds = charts
    .filter((chart) => selectedChartSet.has(chart.id))
    .map((chart) => chart.id);

  const manualMetricSet = ensureStringSet(args.selectedMetricIds);
  const dependencyMetricIds = selectedMetricIds.filter((metricId) => !manualMetricSet.has(metricId));
  const requiredMetricReasonsById = Object.fromEntries(
    selectedMetricIds.map((metricId) => [metricId, [...(reasonsByMetricId.get(metricId) ?? [])]])
  );

  return {
    selectedMetricIds,
    selectedStreakIds,
    selectedChartIds,
    dependencyMetricIds,
    requiredMetricReasonsById,
    data: {
      metrics: metrics.filter((metric) => selectedMetricSet.has(metric.id)),
      streaks: streaks.filter((streak) => selectedStreakSet.has(streak.id)),
      charts: charts.filter((chart) => selectedChartSet.has(chart.id))
    }
  };
}

function mergeById<T extends { id: string }>(base: T[], incoming: T[]): T[] {
  const incomingById = new Map(incoming.map((entry) => [entry.id, entry] as const));
  const next = base.map((entry) => incomingById.get(entry.id) ?? entry);
  const existingIds = new Set(base.map((entry) => entry.id));
  for (const entry of incoming) {
    if (!existingIds.has(entry.id)) {
      next.push(entry);
    }
  }
  return next;
}

export function mergeAdvancedAnalyticsTransferData(args: {
  base: AdvancedAnalyticsTransferData;
  incoming: AdvancedAnalyticsTransferData;
}): AdvancedAnalyticsTransferData {
  return {
    metrics: mergeById(args.base.metrics, args.incoming.metrics),
    streaks: mergeById(args.base.streaks, args.incoming.streaks),
    charts: mergeById(args.base.charts, args.incoming.charts)
  };
}

export function parseAdvancedAnalyticsTransferFile(text: string): AdvancedAnalyticsTransferParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }

  let source = parseObjectWithDefinitions(parsed);
  if (isRecord(parsed)) {
    if ('format' in parsed && parsed.format !== ADVANCED_ANALYTICS_TRANSFER_FORMAT) {
      return { ok: false, error: 'Unsupported analytics export format.' };
    }

    if (
      typeof parsed.schemaVersion === 'number' &&
      parsed.schemaVersion > ADVANCED_ANALYTICS_TRANSFER_SCHEMA_VERSION
    ) {
      return {
        ok: false,
        error: `This export uses schema version ${parsed.schemaVersion}, but this app supports up to ${ADVANCED_ANALYTICS_TRANSFER_SCHEMA_VERSION}.`
      };
    }

    source = source ?? parseObjectWithDefinitions(parsed.state) ?? parseObjectWithDefinitions(parsed.data);
  }

  if (!source) {
    return {
      ok: false,
      error: 'This file does not contain analytics definitions (metrics, streaks, charts).'
    };
  }

  const metrics = source.metrics.map((entry) => parseMetricDefinition(entry));
  if (metrics.some((entry) => entry == null)) {
    return { ok: false, error: 'One or more metric definitions are invalid.' };
  }

  const streaks = source.streaks.map((entry) => parseStreakDefinition(entry));
  if (streaks.some((entry) => entry == null)) {
    return { ok: false, error: 'One or more streak definitions are invalid.' };
  }

  const charts = source.charts.map((entry) => parseChartDefinition(entry));
  if (charts.some((entry) => entry == null)) {
    return { ok: false, error: 'One or more chart definitions are invalid.' };
  }

  const typedMetrics = metrics as AdvancedAnalyticsMetricDefinition[];
  const typedStreaks = streaks as AdvancedAnalyticsStreakDefinition[];
  const typedCharts = charts as AdvancedAnalyticsChartDefinition[];

  const issues = validateAdvancedAnalyticsDefinitions({
    metrics: typedMetrics,
    streaks: typedStreaks,
    charts: typedCharts
  });
  if (issues.length > 0) {
    return {
      ok: false,
      error: `Imported definitions failed validation: ${issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join(' ')}`
    };
  }

  return {
    ok: true,
    data: {
      metrics: typedMetrics,
      streaks: typedStreaks,
      charts: typedCharts
    }
  };
}
