import {
  createBlankActivityCondition,
  createBlankActivityConditionGroup,
  createBlankSampleCondition,
  createBlankSampleConditionGroup
} from '@/store/useAdvancedAnalyticsStore';
import { TimeRangeControl } from '@/components/analytics/TimeRangeControl';
import type {
  AdvancedAnalyticsActivityCondition,
  AdvancedAnalyticsActivityConditionField,
  AdvancedAnalyticsActivityConditionGroup,
  AdvancedAnalyticsActivityConditionOperator,
  AdvancedAnalyticsBaseMetricDefinition,
  AdvancedAnalyticsBaseMeasure,
  AdvancedAnalyticsConditionJoin,
  AdvancedAnalyticsMetricDefinition,
  AdvancedAnalyticsSampleCondition,
  AdvancedAnalyticsSampleConditionField,
  AdvancedAnalyticsSampleConditionGroup,
  AdvancedAnalyticsSampleConditionOperator
} from '@/types';

const BASE_MEASURE_OPTIONS: Array<{ value: AdvancedAnalyticsBaseMeasure; label: string }> = [
  { value: 'activitiesCount', label: 'Activities count' },
  { value: 'activeDaysCount', label: 'Active days count' },
  { value: 'distanceSum', label: 'Distance sum' },
  { value: 'durationSum', label: 'Duration sum' },
  { value: 'movingTimeSum', label: 'Moving time sum' },
  { value: 'elevationGainSum', label: 'Elevation gain sum' },
  { value: 'sampleTime', label: 'Sample time' }
];

const UNIT_DISPLAY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto (best unit)' },
  { value: 'count', label: 'Count' },
  { value: '%', label: 'Percent (%)' },
  { value: 's', label: 'Seconds (s)' },
  { value: 'min', label: 'Minutes (min)' },
  { value: 'h', label: 'Hours (h)' },
  { value: 'km', label: 'Kilometers (km)' },
  { value: 'm', label: 'Meters (m)' },
  { value: 'mi', label: 'Miles (mi)' },
  { value: 'km/h', label: 'Speed (km/h)' },
  { value: 'm/s', label: 'Speed (m/s)' },
  { value: 'bpm', label: 'Heart rate (bpm)' },
  { value: 'W', label: 'Power (W)' },
  { value: 'rpm', label: 'Cadence (rpm)' }
];

const ACTIVITY_FIELD_OPTIONS: Array<{ value: AdvancedAnalyticsActivityConditionField; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'category', label: 'Category' },
  { value: 'sportType', label: 'Sport Type' },
  { value: 'distanceM', label: 'Distance (m)' },
  { value: 'durationSeconds', label: 'Duration (s)' },
  { value: 'movingDurationSeconds', label: 'Moving Time (s)' },
  { value: 'elevationGainM', label: 'Elevation Gain (m)' },
  { value: 'avgHr', label: 'Avg HR' },
  { value: 'maxHr', label: 'Max HR' },
  { value: 'hasGps', label: 'Has GPS' },
  { value: 'weekday', label: 'Weekday' }
];

const SAMPLE_FIELD_OPTIONS: Array<{ value: AdvancedAnalyticsSampleConditionField; label: string }> = [
  { value: 'heartRateZone', label: 'Heart Rate Zone' },
  { value: 'heartRate', label: 'Heart Rate' },
  { value: 'powerWatts', label: 'Power (W)' },
  { value: 'cadence', label: 'Cadence' },
  { value: 'speedMps', label: 'Speed (km/h)' },
  { value: 'paceMinPerKm', label: 'Pace (min/km)' }
];

const TEXT_OPERATORS: AdvancedAnalyticsActivityConditionOperator[] = [
  'contains',
  'containsAny',
  'containsAll',
  'equals',
  'startsWith'
];
const NUM_OPERATORS: AdvancedAnalyticsActivityConditionOperator[] = [
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'numberEquals',
  'notEquals'
];
const BOOL_OPERATORS: AdvancedAnalyticsActivityConditionOperator[] = ['is', 'isNot'];

const SAMPLE_NUM_OPERATORS: AdvancedAnalyticsSampleConditionOperator[] = [
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'numberEquals',
  'notEquals'
];

function activityFieldKind(field: AdvancedAnalyticsActivityConditionField): 'text' | 'number' | 'bool' {
  if (field === 'hasGps') {
    return 'bool';
  }
  if (field === 'title' || field === 'category' || field === 'sportType' || field === 'weekday') {
    return 'text';
  }
  return 'number';
}

function activityOperatorsForField(
  field: AdvancedAnalyticsActivityConditionField
): AdvancedAnalyticsActivityConditionOperator[] {
  const kind = activityFieldKind(field);
  if (kind === 'text') {
    return field === 'weekday' ? ['equals', 'is', 'isNot'] : TEXT_OPERATORS;
  }
  if (kind === 'bool') {
    return BOOL_OPERATORS;
  }
  return NUM_OPERATORS;
}

function displayOperator(label: string) {
  return label
    .replace(/[A-Z]/g, (ch) => ` ${ch.toLowerCase()}`)
    .replace(/^./, (ch) => ch.toUpperCase());
}

const MPS_TO_KMH = 3.6;

function parseOptionalNumberInput(raw: string): number | undefined {
  if (raw.trim() === '') {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sampleConditionInputValue(condition: AdvancedAnalyticsSampleCondition): number | '' {
  if (condition.numberValue == null) {
    return '';
  }
  if (condition.field !== 'speedMps') {
    return condition.numberValue;
  }
  return condition.numberValue * MPS_TO_KMH;
}

function sampleConditionStoredValue(
  condition: AdvancedAnalyticsSampleCondition,
  inputValue: number | undefined
): number | undefined {
  if (inputValue == null) {
    return undefined;
  }
  if (condition.field !== 'speedMps') {
    return inputValue;
  }
  return inputValue / MPS_TO_KMH;
}

function unitDisplayOptionsForValue(value?: string | null): Array<{ value: string; label: string }> {
  const currentValue = normalizeUnitDisplaySelection(value);
  if (!currentValue || UNIT_DISPLAY_OPTIONS.some((option) => option.value === currentValue)) {
    return UNIT_DISPLAY_OPTIONS;
  }
  return [{ value: currentValue, label: `Custom (${currentValue})` }, ...UNIT_DISPLAY_OPTIONS];
}

function normalizeUnitDisplaySelection(value?: string | null): string {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : 'auto';
}

function normalizeActivityConditionGroups(
  base: AdvancedAnalyticsBaseMetricDefinition
): AdvancedAnalyticsActivityConditionGroup[] {
  if ((base.activityConditionGroups ?? []).length > 0) {
    return (base.activityConditionGroups ?? []).map((group, index) => ({
      id: group.id || `activity_group_${index}`,
      conditions: group.conditions ?? []
    }));
  }
  if (base.activityConditions.length === 0) {
    return [];
  }
  const join: AdvancedAnalyticsConditionJoin = base.activityConditionJoin ?? 'and';
  if (join === 'or') {
    return base.activityConditions.map((condition, index) => ({
      id: `legacy_activity_group_${index}`,
      conditions: [condition]
    }));
  }
  return [
    {
      id: 'legacy_activity_group_0',
      conditions: base.activityConditions
    }
  ];
}

function normalizeSampleConditionGroups(
  base: AdvancedAnalyticsBaseMetricDefinition
): AdvancedAnalyticsSampleConditionGroup[] {
  if ((base.sampleConditionGroups ?? []).length > 0) {
    return (base.sampleConditionGroups ?? []).map((group, index) => ({
      id: group.id || `sample_group_${index}`,
      conditions: group.conditions ?? []
    }));
  }
  if (base.sampleConditions.length === 0) {
    return [];
  }
  const join: AdvancedAnalyticsConditionJoin = base.sampleConditionJoin ?? 'and';
  if (join === 'or') {
    return base.sampleConditions.map((condition, index) => ({
      id: `legacy_sample_group_${index}`,
      conditions: [condition]
    }));
  }
  return [
    {
      id: 'legacy_sample_group_0',
      conditions: base.sampleConditions
    }
  ];
}

interface MetricBuilderProps {
  metric: AdvancedAnalyticsMetricDefinition;
  allMetrics: AdvancedAnalyticsMetricDefinition[];
  onChange: (metric: AdvancedAnalyticsMetricDefinition) => void;
  onDelete: () => void;
}

export function MetricBuilder({ metric, allMetrics, onChange, onDelete }: MetricBuilderProps) {
  const base: AdvancedAnalyticsBaseMetricDefinition = {
    measure: 'activitiesCount',
    activityConditions: [],
    sampleConditions: [],
    activityConditionGroups: [],
    sampleConditionGroups: [],
    activityConditionJoin: 'and',
    sampleConditionJoin: 'and',
    minimumSampleMatchSeconds: 0,
    defaultChartGranularity: 'week',
    displayUnit: 'auto',
    ...metric.base
  };
  const formula = metric.formula ?? {
    leftMetricId: allMetrics.find((candidate) => candidate.id !== metric.id)?.id ?? '',
    operator: 'divide',
    rightMetricId: allMetrics.find((candidate) => candidate.id !== metric.id)?.id ?? '',
    displayUnit: 'auto'
  };
  const baseDisplayUnitOptions = unitDisplayOptionsForValue(base.displayUnit);
  const formulaDisplayUnitOptions = unitDisplayOptionsForValue(formula.displayUnit);
  const activityConditionGroups = normalizeActivityConditionGroups(base);
  const sampleConditionGroups = normalizeSampleConditionGroups(base);
  const topGridClassName = 'grid gap-3 md:grid-cols-2';
  const topBaseGridClassName = 'grid gap-x-3 gap-y-3 md:grid-cols-2 xl:grid-cols-3';
  const topFieldRowClassName = 'grid min-h-7 grid-cols-[max-content_minmax(0,1fr)] items-center gap-2';
  const topFieldLabelClassName = 'text-sm text-muted whitespace-nowrap';
  const topControlClassName = 'h-7 w-full rounded-md border border-border bg-bg px-2 text-sm';
  const groupControlClassName = 'h-7 w-full rounded-md border border-border bg-bg px-2 text-sm';
  const groupActionButtonClassName =
    'h-7 rounded-md border border-border px-2 text-xs hover:bg-bg/60';
  const groupSecondaryButtonClassName =
    'h-7 rounded-md border border-border px-2 text-xs text-muted hover:text-foreground';

  const updateBase = (patch: Partial<AdvancedAnalyticsBaseMetricDefinition>) => {
    onChange({
      ...metric,
      kind: 'base',
      base: {
        ...base,
        ...patch
      }
    });
  };

  const updateActivityGroups = (groups: AdvancedAnalyticsActivityConditionGroup[]) => {
    updateBase({
      activityConditionGroups: groups,
      activityConditions: [],
      activityConditionJoin: 'and'
    });
  };

  const updateSampleGroups = (groups: AdvancedAnalyticsSampleConditionGroup[]) => {
    updateBase({
      sampleConditionGroups: groups,
      sampleConditions: [],
      sampleConditionJoin: 'and'
    });
  };

  const updateActivityCondition = (
    groupId: string,
    conditionId: string,
    updater: (condition: AdvancedAnalyticsActivityCondition) => AdvancedAnalyticsActivityCondition
  ) => {
    updateActivityGroups(
      activityConditionGroups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              conditions: group.conditions.map((condition) =>
                condition.id === conditionId ? updater(condition) : condition
              )
            }
          : group
      )
    );
  };

  const updateSampleCondition = (
    groupId: string,
    conditionId: string,
    updater: (condition: AdvancedAnalyticsSampleCondition) => AdvancedAnalyticsSampleCondition
  ) => {
    updateSampleGroups(
      sampleConditionGroups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              conditions: group.conditions.map((condition) =>
                condition.id === conditionId ? updater(condition) : condition
              )
            }
          : group
      )
    );
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Metric Builder</h3>
          <p className="text-sm text-muted">Define a base metric or combine two existing metrics.</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
        >
          Delete
        </button>
      </div>

      {metric.kind === 'base' ? (
        <div className={topBaseGridClassName}>
          <label className={`${topFieldRowClassName} xl:col-start-1 xl:row-start-1`}>
            <span className={topFieldLabelClassName}>Name</span>
            <input
              value={metric.name}
              onChange={(event) => onChange({ ...metric, name: event.target.value })}
              className={topControlClassName}
            />
          </label>
          <label className={`${topFieldRowClassName} xl:col-start-1 xl:row-start-2`}>
            <span className={topFieldLabelClassName}>Type</span>
            <select
              value={metric.kind}
              onChange={(event) => {
                const kind = event.target.value as 'base' | 'formula';
                onChange(
                  kind === 'base'
                    ? {
                        ...metric,
                        kind,
                        base,
                        formula: undefined
                      }
                    : {
                        ...metric,
                        kind,
                        formula,
                        base: undefined
                  }
                );
              }}
              className={topControlClassName}
            >
              <option value="base">Base metric</option>
              <option value="formula">Formula metric</option>
            </select>
          </label>

          <div className="xl:col-start-2 xl:row-start-1">
            <TimeRangeControl
              value={metric.timeRange}
              onChange={(timeRange) => onChange({ ...metric, timeRange })}
              label="Time range"
              inlineLabel
              labelWidthClassName={topFieldLabelClassName}
              controlClassName={topControlClassName}
            />
          </div>
          <label className={`${topFieldRowClassName} xl:col-start-2 xl:row-start-2`}>
            <span className={topFieldLabelClassName}>Show in View tab</span>
            <input
              type="checkbox"
              checked={metric.showInView !== false}
              onChange={(event) => onChange({ ...metric, showInView: event.target.checked })}
              className="justify-self-start"
            />
          </label>

          <label className={`${topFieldRowClassName} xl:col-start-3 xl:row-start-1`}>
            <span className={topFieldLabelClassName}>Measure</span>
            <select
              value={base.measure}
              onChange={(event) =>
                updateBase({
                  measure: event.target.value as AdvancedAnalyticsBaseMeasure
                })
              }
              className={topControlClassName}
            >
              {BASE_MEASURE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={`${topFieldRowClassName} xl:col-start-3 xl:row-start-2`}>
            <span className={topFieldLabelClassName}>Preview granularity</span>
            <select
              value={base.defaultChartGranularity ?? 'week'}
              onChange={(event) =>
                updateBase({
                  defaultChartGranularity: event.target.value as 'day' | 'week' | 'month'
                })
              }
              className={topControlClassName}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <label className={`${topFieldRowClassName} xl:col-start-3 xl:row-start-3`}>
            <span className={topFieldLabelClassName}>Unit display</span>
            <select
              value={normalizeUnitDisplaySelection(base.displayUnit)}
              onChange={(event) =>
                updateBase({
                  displayUnit: event.target.value
                })
              }
              className={topControlClassName}
            >
              {baseDisplayUnitOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className={topGridClassName}>
          <div className="space-y-3">
            <label className={topFieldRowClassName}>
              <span className={topFieldLabelClassName}>Name</span>
              <input
                value={metric.name}
                onChange={(event) => onChange({ ...metric, name: event.target.value })}
                className={topControlClassName}
              />
            </label>
            <label className={topFieldRowClassName}>
              <span className={topFieldLabelClassName}>Type</span>
              <select
                value={metric.kind}
                onChange={(event) => {
                  const kind = event.target.value as 'base' | 'formula';
                  onChange(
                    kind === 'base'
                      ? {
                          ...metric,
                          kind,
                          base,
                          formula: undefined
                        }
                      : {
                          ...metric,
                          kind,
                          formula,
                          base: undefined
                    }
                  );
                }}
                className={topControlClassName}
              >
                <option value="base">Base metric</option>
                <option value="formula">Formula metric</option>
              </select>
            </label>
          </div>

          <div className="space-y-3">
            <TimeRangeControl
              value={metric.timeRange}
              onChange={(timeRange) => onChange({ ...metric, timeRange })}
              label="Time range"
              inlineLabel
              labelWidthClassName={topFieldLabelClassName}
              controlClassName={topControlClassName}
            />
            <label className={topFieldRowClassName}>
              <span className={topFieldLabelClassName}>Show in View tab</span>
              <input
                type="checkbox"
                checked={metric.showInView !== false}
                onChange={(event) => onChange({ ...metric, showInView: event.target.checked })}
                className="justify-self-start"
              />
            </label>
          </div>
        </div>
      )}

      {metric.kind === 'base' ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Where groups (OR)</p>
                <p className="text-xs text-muted">
                  If any group matches, the activity is included. Conditions inside each group use
                  AND.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateActivityGroups([
                    ...activityConditionGroups,
                    createBlankActivityConditionGroup()
                  ])
                }
                className={`${groupActionButtonClassName} px-2.5 font-medium`}
              >
                + Group
              </button>
            </div>
            {activityConditionGroups.length === 0 ? (
              <p className="text-xs text-muted">No activity groups (matches all activities).</p>
            ) : (
              activityConditionGroups.map((group, groupIndex) => (
                <div
                  key={group.id}
                  className={`space-y-2 ${groupIndex > 0 ? 'border-t border-border/70 pt-3' : ''}`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-foreground">
                        Group {groupIndex + 1} (AND){' '}
                        <span className="text-muted">
                          {group.conditions.length} condition
                          {group.conditions.length === 1 ? '' : 's'}
                        </span>
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateActivityGroups(
                              activityConditionGroups.map((currentGroup) =>
                                currentGroup.id === group.id
                                  ? {
                                      ...currentGroup,
                                      conditions: [
                                        ...currentGroup.conditions,
                                        createBlankActivityCondition()
                                      ]
                                    }
                                  : currentGroup
                              )
                            )
                          }
                          className={groupActionButtonClassName}
                        >
                          + Condition
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateActivityGroups(
                              activityConditionGroups.filter(
                                (currentGroup) => currentGroup.id !== group.id
                              )
                            )
                          }
                          className={groupSecondaryButtonClassName}
                        >
                          Remove Group
                        </button>
                      </div>
                    </div>
                    {group.conditions.length === 0 ? (
                      <p className="text-xs text-muted">
                        Empty group (ignored until at least one condition is added).
                      </p>
                    ) : (
                      group.conditions.map((condition) => {
                        const kind = activityFieldKind(condition.field);
                        const operators = activityOperatorsForField(condition.field);
                        return (
                          <div
                            key={condition.id}
                            className="grid gap-2 md:grid-cols-12"
                          >
                            <select
                              value={condition.field}
                              onChange={(event) => {
                                const nextField =
                                  event.target.value as AdvancedAnalyticsActivityConditionField;
                                const nextOperator = activityOperatorsForField(nextField)[0];
                                updateActivityCondition(group.id, condition.id, (current) => ({
                                  ...current,
                                  field: nextField,
                                  operator: nextOperator,
                                  value:
                                    activityFieldKind(nextField) === 'text'
                                      ? current.value ?? ''
                                      : activityFieldKind(nextField) === 'bool'
                                        ? 'true'
                                        : '',
                                  numberValue:
                                    activityFieldKind(nextField) === 'number'
                                      ? Number.isFinite(current.numberValue)
                                        ? current.numberValue
                                        : 0
                                      : undefined,
                                  boolValue:
                                    activityFieldKind(nextField) === 'bool'
                                      ? current.boolValue ?? true
                                      : undefined
                                }));
                              }}
                              className={`${groupControlClassName} md:col-span-3`}
                            >
                              {ACTIVITY_FIELD_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <select
                              value={condition.operator}
                              onChange={(event) =>
                                updateActivityCondition(group.id, condition.id, (current) => ({
                                  ...current,
                                  operator:
                                    event.target
                                      .value as AdvancedAnalyticsActivityConditionOperator
                                }))
                              }
                              className={`${groupControlClassName} md:col-span-3`}
                            >
                              {operators.map((operator) => (
                                <option key={operator} value={operator}>
                                  {displayOperator(operator)}
                                </option>
                              ))}
                            </select>
                            {kind === 'text' ? (
                              <input
                                value={condition.value ?? ''}
                                onChange={(event) =>
                                  updateActivityCondition(group.id, condition.id, (current) => ({
                                    ...current,
                                    value: event.target.value
                                  }))
                                }
                                placeholder={
                                  condition.operator === 'containsAny' ||
                                  condition.operator === 'containsAll'
                                    ? 'comma-separated'
                                    : 'value'
                                }
                                className={`${groupControlClassName} md:col-span-5`}
                              />
                            ) : kind === 'bool' ? (
                              <select
                                value={String(condition.boolValue ?? true)}
                                onChange={(event) =>
                                  updateActivityCondition(group.id, condition.id, (current) => ({
                                    ...current,
                                    boolValue: event.target.value === 'true',
                                    value: event.target.value
                                  }))
                                }
                                className={`${groupControlClassName} md:col-span-5`}
                              >
                                <option value="true">True</option>
                                <option value="false">False</option>
                              </select>
                            ) : (
                              <input
                                type="number"
                                value={condition.numberValue ?? ''}
                                onChange={(event) =>
                                  updateActivityCondition(group.id, condition.id, (current) => ({
                                    ...current,
                                    numberValue: parseOptionalNumberInput(event.target.value)
                                  }))
                                }
                                className={`${groupControlClassName} md:col-span-5`}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                updateActivityGroups(
                                  activityConditionGroups.map((currentGroup) =>
                                    currentGroup.id === group.id
                                      ? {
                                          ...currentGroup,
                                          conditions: currentGroup.conditions.filter(
                                            (item) => item.id !== condition.id
                                          )
                                        }
                                      : currentGroup
                                  )
                                )
                              }
                              className={`${groupSecondaryButtonClassName} md:col-span-1`}
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {base.measure === 'sampleTime' ? (
            <div className="space-y-3">
              <label className="space-y-1 text-sm">
                <span className="text-muted">Minimum continuous match time (seconds)</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={
                    (base.minimumSampleMatchSeconds ?? 0) > 0
                      ? base.minimumSampleMatchSeconds
                      : ''
                  }
                  onChange={(event) => {
                    if (event.target.value === '') {
                      updateBase({ minimumSampleMatchSeconds: 0 });
                      return;
                    }
                    const parsed = Number(event.target.value);
                    updateBase({
                      minimumSampleMatchSeconds:
                        Number.isFinite(parsed) && parsed > 0 ? parsed : 0
                    });
                  }}
                  className={groupControlClassName}
                />
                <p className="text-xs text-muted">
                  Ignore short spikes. Only continuous matching intervals that last at least this
                  long are counted.
                </p>
              </label>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Sample groups (OR)</p>
                  <p className="text-xs text-muted">
                    Time is accumulated for intervals where any group matches. Conditions inside each
                    group use AND.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateSampleGroups([
                      ...sampleConditionGroups,
                      createBlankSampleConditionGroup()
                    ])
                  }
                  className={`${groupActionButtonClassName} px-2.5 font-medium`}
                >
                  + Group
                </button>
              </div>
              {sampleConditionGroups.length === 0 ? (
                <p className="text-xs text-muted">
                  No sample groups: all tracked sample intervals count.
                </p>
              ) : (
                sampleConditionGroups.map((group, groupIndex) => (
                  <div
                    key={group.id}
                    className={`space-y-2 ${groupIndex > 0 ? 'border-t border-border/70 pt-3' : ''}`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-foreground">
                          Group {groupIndex + 1} (AND){' '}
                          <span className="text-muted">
                            {group.conditions.length} condition
                            {group.conditions.length === 1 ? '' : 's'}
                          </span>
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateSampleGroups(
                                sampleConditionGroups.map((currentGroup) =>
                                  currentGroup.id === group.id
                                    ? {
                                        ...currentGroup,
                                        conditions: [
                                          ...currentGroup.conditions,
                                          createBlankSampleCondition()
                                        ]
                                      }
                                    : currentGroup
                                )
                              )
                            }
                            className={groupActionButtonClassName}
                          >
                            + Condition
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateSampleGroups(
                                sampleConditionGroups.filter(
                                  (currentGroup) => currentGroup.id !== group.id
                                )
                              )
                            }
                            className={groupSecondaryButtonClassName}
                          >
                            Remove Group
                          </button>
                        </div>
                      </div>
                      {group.conditions.length === 0 ? (
                        <p className="text-xs text-muted">
                          Empty group (ignored until at least one condition is added).
                        </p>
                      ) : (
                        group.conditions.map((condition) => {
                          const isZone = condition.field === 'heartRateZone';
                          const operators = isZone ? (['is'] as const) : SAMPLE_NUM_OPERATORS;
                          return (
                            <div
                              key={condition.id}
                              className="grid gap-2 md:grid-cols-12"
                            >
                              <select
                                value={condition.field}
                                onChange={(event) => {
                                  const field =
                                    event.target.value as AdvancedAnalyticsSampleConditionField;
                                  updateSampleCondition(group.id, condition.id, (current) => ({
                                    ...current,
                                    field,
                                    operator:
                                      field === 'heartRateZone'
                                        ? 'is'
                                        : 'greaterThanOrEqual',
                                    zone: field === 'heartRateZone' ? current.zone ?? 2 : undefined,
                                    numberValue:
                                      field === 'heartRateZone'
                                        ? undefined
                                        : current.numberValue ?? 0
                                  }));
                                }}
                                className={`${groupControlClassName} md:col-span-4`}
                              >
                                {SAMPLE_FIELD_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={condition.operator}
                                onChange={(event) =>
                                  updateSampleCondition(group.id, condition.id, (current) => ({
                                    ...current,
                                    operator:
                                      event.target
                                        .value as AdvancedAnalyticsSampleConditionOperator
                                  }))
                                }
                                className={`${groupControlClassName} md:col-span-3`}
                              >
                                {operators.map((operator) => (
                                  <option key={operator} value={operator}>
                                    {displayOperator(operator)}
                                  </option>
                                ))}
                              </select>
                              {isZone ? (
                                <select
                                  value={String(condition.zone ?? 2)}
                                  onChange={(event) =>
                                    updateSampleCondition(group.id, condition.id, (current) => ({
                                      ...current,
                                      zone: Number(event.target.value)
                                    }))
                                  }
                                  className={`${groupControlClassName} md:col-span-4`}
                                >
                                  {[1, 2, 3, 4, 5].map((zone) => (
                                    <option key={zone} value={zone}>
                                      Z{zone}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="number"
                                  value={sampleConditionInputValue(condition)}
                                  onChange={(event) =>
                                    updateSampleCondition(group.id, condition.id, (current) => ({
                                      ...current,
                                      numberValue: sampleConditionStoredValue(
                                        current,
                                        parseOptionalNumberInput(event.target.value)
                                      )
                                    }))
                                  }
                                  className={`${groupControlClassName} md:col-span-4`}
                                />
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  updateSampleGroups(
                                    sampleConditionGroups.map((currentGroup) =>
                                      currentGroup.id === group.id
                                        ? {
                                            ...currentGroup,
                                            conditions: currentGroup.conditions.filter(
                                              (item) => item.id !== condition.id
                                            )
                                          }
                                        : currentGroup
                                    )
                                  )
                                }
                                className={`${groupSecondaryButtonClassName} md:col-span-1`}
                              >
                                Remove
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className={topGridClassName}>
            <label className={topFieldRowClassName}>
              <span className={topFieldLabelClassName}>Metric A</span>
              <select
                value={formula.leftMetricId}
                onChange={(event) =>
                  onChange({
                    ...metric,
                    kind: 'formula',
                    formula: { ...formula, leftMetricId: event.target.value }
                  })
                }
                className={topControlClassName}
              >
                <option value="">Select metric</option>
                {allMetrics
                  .filter((candidate) => candidate.id !== metric.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={topFieldRowClassName}>
              <span className={topFieldLabelClassName}>Operator</span>
              <select
                value={formula.operator}
                onChange={(event) =>
                  onChange({
                    ...metric,
                    kind: 'formula',
                    formula: {
                      ...formula,
                      operator: event.target.value as 'add' | 'subtract' | 'divide' | 'percent'
                    }
                  })
                }
                className={topControlClassName}
              >
                <option value="add">+</option>
                <option value="subtract">-</option>
                <option value="divide">/</option>
                <option value="percent">%</option>
              </select>
            </label>
            <label className={topFieldRowClassName}>
              <span className={topFieldLabelClassName}>Metric B</span>
              <select
                value={formula.rightMetricId}
                onChange={(event) =>
                  onChange({
                    ...metric,
                    kind: 'formula',
                    formula: { ...formula, rightMetricId: event.target.value }
                  })
                }
                className={topControlClassName}
              >
                <option value="">Select metric</option>
                {allMetrics
                  .filter((candidate) => candidate.id !== metric.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={topFieldRowClassName}>
              <span className={topFieldLabelClassName}>Unit display</span>
              <select
                value={normalizeUnitDisplaySelection(formula.displayUnit)}
                onChange={(event) =>
                  onChange({
                    ...metric,
                    kind: 'formula',
                    formula: { ...formula, displayUnit: event.target.value }
                  })
                }
                className={topControlClassName}
              >
                {formulaDisplayUnitOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
