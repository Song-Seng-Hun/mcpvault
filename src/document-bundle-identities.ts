/** IDs come from a trusted bundle plan, never array order or a model label.
 * This syntax check alone proves neither ownership nor execution authority. */
export const isDocumentBundleId = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
